use super::OpenRequest;
use serde::Serialize;
use std::{path::Path, process::{Command, Stdio}, time::{Duration, Instant}};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installation {
    pub root: String, pub python: String,
    #[serde(skip)] pub interpreter: String,
}

#[derive(Debug, Serialize)]
pub struct LaunchFailure {
    pub code: &'static str,
    pub detail: String,
}

impl LaunchFailure {
    pub fn new(code: &'static str, detail: impl Into<String>) -> Self {
        Self { code, detail: detail.into() }
    }
}

impl From<String> for LaunchFailure {
    fn from(detail: String) -> Self { Self::new("process-launch", detail) }
}

fn path_failure(error: std::io::Error, fallback: &'static str) -> LaunchFailure {
    use std::io::ErrorKind;
    let code = match error.kind() {
        ErrorKind::PermissionDenied => "permission",
        ErrorKind::NotFound => fallback,
        _ => "installation-unavailable",
    };
    LaunchFailure::new(code, error.to_string())
}

fn clean_environment(command: &mut Command) {
    for (key, _) in std::env::vars_os() {
        if key.to_string_lossy().starts_with("AGENT_RUNNER_") { command.env_remove(key); }
    }
    command.env_remove("PYTHONPATH").env_remove("PYTHONHOME").env_remove("__PYVENV_LAUNCHER__");
}

fn installation_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    #[cfg(windows)] {
        use std::path::{Component, Prefix};
        if let Some(Component::Prefix(prefix)) = path.components().next() {
            match prefix.kind() {
                Prefix::VerbatimDisk(_) => return text[4..].into(),
                Prefix::VerbatimUNC(_, _) => return format!("\\\\{}", &text[8..]),
                _ => {}
            }
        }
    }
    text.into_owned()
}

pub fn resolve(location: &str) -> Result<Installation, LaunchFailure> {
    let selected = Path::new(location.trim());
    if !selected.is_absolute() {
        return Err(LaunchFailure::new("invalid-installation", "Choose the absolute path to the installed Runner Workspace root."));
    }
    let root = selected.canonicalize().map_err(|e| path_failure(e, "missing-installation"))?;
    if !root.is_dir() {
        return Err(LaunchFailure::new("invalid-installation", "The Runner Workspace path is not a directory."));
    }
    let entry = root.join("src/runner/__main__.py");
    if !entry.metadata().map_err(|e| path_failure(e, "invalid-installation"))?.is_file() {
        return Err(LaunchFailure::new("invalid-installation", "Expected src/runner/__main__.py to be a file."));
    }
    let python = root.join("local/runtime/python-env").join(if cfg!(windows) { "Scripts/python.exe" }
        else { "bin/python" });
    if !python.metadata().map_err(|e| path_failure(e, "managed-python"))?.is_file() {
        return Err(LaunchFailure::new("managed-python", "The managed Python path is not a file."));
    }
    let interpreter = verify_python(&root, &python)?;
    // Runner compares paths returned by its App Server, which uses ordinary DOS/UNC spelling.
    Ok(Installation { root: installation_path(&root), python: installation_path(&python), interpreter })
}

fn verify_python(root: &Path, python: &Path) -> Result<String, LaunchFailure> {
    const PROBE: &str = "import os,sys,runner; from pathlib import Path; root=Path(sys.argv[1]); assert os.path.samefile(sys.prefix,root/'local/runtime/python-env'), 'wrong managed Python environment'; assert os.path.samefile(runner.__file__,root/'src/runner/__init__.py'), 'Runner source registration points to another installation'; print('HUB_RUNNER_RUNTIME_OK'); print(sys._base_executable)";
    let mut command = Command::new(python);
    command.args(["-I", "-c", PROBE]).arg(root).current_dir(root).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    clean_environment(&mut command);
    command.env("PYTHONIOENCODING", "utf-8");
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|e| {
        let code = if e.kind() == std::io::ErrorKind::PermissionDenied { "permission" } else { "managed-python" };
        LaunchFailure::new(code, e.to_string())
    })?;
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            result => {
                let _ = child.kill(); let _ = child.wait();
                return Err(LaunchFailure::new("managed-python", format!("Managed Python verification did not settle: {result:?}")));
            }
        }
    }
    let result = child.wait_with_output().map_err(|e| LaunchFailure::new("managed-python", e.to_string()))?;
    let output = String::from_utf8(result.stdout)
        .map_err(|_| LaunchFailure::new("managed-python", "Managed Python returned invalid runtime identification"))?;
    let mut lines = output.lines();
    let marker = lines.next();
    let interpreter = lines.next().unwrap_or_default();
    if !result.status.success() || marker != Some("HUB_RUNNER_RUNTIME_OK") || lines.next().is_some()
        || !Path::new(interpreter).is_absolute() || !Path::new(interpreter).is_file() {
        return Err(LaunchFailure::new("managed-python", format!("Managed Python does not resolve this installed Runner. {}",
            String::from_utf8_lossy(&result.stderr).chars().take(1600).collect::<String>())));
    }
    Ok(interpreter.into())
}

pub fn prepare(location: &str, cols: u16, rows: u16) -> Result<OpenRequest, LaunchFailure> {
    let installation = resolve(location)?;
    // Process groups do not contain Runner's detached App Server children on macOS.
    // Fail before spawning until a supported descendant shutdown boundary is available.
    if cfg!(target_os = "macos") {
        return Err(LaunchFailure::new("process-launch", "This macOS build cannot safely contain detached Runner children."));
    }
    // Windows venv python.exe is a redirector. Launch its interpreter in the same
    // managed environment so authenticated hello can bind to our exact process handle.
    let mut env: std::collections::BTreeMap<String, String> = [("AGENT_RUNNER_INTERACTIVE_BACKEND".into(), "retained".into()), ("PYTHONIOENCODING".into(), "utf-8".into())].into();
    #[cfg(windows)]
    { env.insert("__PYVENV_LAUNCHER__".into(), installation.python.clone()); }
    let program = if cfg!(windows) { installation.interpreter } else { installation.python };
    Ok(OpenRequest { program: Some(program), args: vec!["-I".into(), "-m".into(), "runner".into(),
        "run".into(), "--repo-root".into(), installation.root.clone(), "--hub-presentation".into()], cwd: Some(installation.root),
        env,
        cols, rows, ..Default::default() })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(windows)]
    #[test]
    fn installation_arguments_match_external_windows_path_spelling() {
        assert_eq!(installation_path(Path::new(r"\\?\D:\Runner install")), r"D:\Runner install");
        assert_eq!(installation_path(Path::new(r"\\?\UNC\server\share\Runner")), r"\\server\share\Runner");
        let unicode = "D:\\Runner \u{c124}\u{ce58}";
        assert_eq!(installation_path(Path::new(&format!("\\\\?\\{unicode}"))), unicode);
        assert_eq!(installation_path(Path::new(unicode)), unicode);
        let device = r"\\?\Volume{123}\Runner";
        assert_eq!(installation_path(Path::new(device)), device);
    }
    #[test]
    fn unavailable_installations_are_actionable() {
        assert_eq!(resolve("").err().unwrap().code, "invalid-installation");
        assert_eq!(resolve("crp").err().unwrap().code, "invalid-installation");
        let missing = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("no-runner-installation");
        assert_eq!(resolve(&missing.to_string_lossy()).err().unwrap().code, "missing-installation");
    }

    #[test]
    fn incomplete_workspace_is_rejected() {
        let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("hub-resolver-{}-{unique}", std::process::id()));
        std::fs::create_dir(&root).unwrap();
        let missing_source = resolve(&root.to_string_lossy());
        let result = (|| {
            let source = root.join("src/runner");
            std::fs::create_dir_all(&source)?;
            std::fs::write(source.join("__main__.py"), [])?;
            Ok::<_, std::io::Error>(resolve(&root.to_string_lossy()))
        })();
        std::fs::remove_dir_all(root).unwrap();
        assert_eq!(missing_source.err().unwrap().code, "invalid-installation");
        assert_eq!(result.unwrap().err().unwrap().code, "managed-python");
    }

    #[test]
    #[ignore = "Requires the normally installed Runner at HUB_RUNNER_ACCEPTANCE_ROOT"]
    fn canonical_installation_verifies_matching_python_and_source() {
        let location = std::env::var("HUB_RUNNER_ACCEPTANCE_ROOT").expect("installed Runner Workspace root");
        let root = Path::new(&location).canonicalize().unwrap();
        let resolved = resolve(&location).unwrap();
        assert_eq!(resolved.root, installation_path(&root));
        assert_eq!(resolved.python, installation_path(&root.join(if cfg!(windows) {
            "local/runtime/python-env/Scripts/python.exe"
        } else { "local/runtime/python-env/bin/python" })));
    }
}
