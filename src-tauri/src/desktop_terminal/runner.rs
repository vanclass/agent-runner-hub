use super::OpenRequest;
use serde::Serialize;
use std::{path::Path, process::{Command, Stdio}, time::{Duration, Instant}};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installation { pub root: String, pub python: String }

fn clean_environment(command: &mut Command) {
    for (key, _) in std::env::vars_os() {
        if key.to_string_lossy().starts_with("AGENT_RUNNER_") { command.env_remove(key); }
    }
    command.env_remove("PYTHONPATH").env_remove("PYTHONHOME");
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

pub fn resolve(location: &str) -> Result<Installation, String> {
    let selected = Path::new(location.trim());
    if !selected.is_absolute() { return Err("Choose the absolute path to your AgentRunner installation or its workspace.".into()); }
    let selected = selected.canonicalize().map_err(|e| format!("AgentRunner location is unavailable: {e}. Choose an installed location."))?;
    let root = if selected.join("agent_runner/src/runner/__main__.py").is_file() { selected }
        else if selected.join("src/runner/__main__.py").is_file() && selected.file_name().is_some_and(|name| name == "agent_runner") {
            selected.parent().ok_or("AgentRunner workspace has no parent")?.to_path_buf()
        } else { return Err("This location has no agent_runner/src/runner/__main__.py. Choose the installed Runner workspace or agent_runner folder.".into()); };
    let python = root.join(if cfg!(windows) { "agent_runner/local/runtime/python-env/Scripts/python.exe" }
        else { "agent_runner/local/runtime/python-env/bin/python" });
    if !python.is_file() { return Err("Runner's managed Python is missing. Run this installation's native bootstrap, then choose the location again.".into()); }
    verify_python(&root, &python)?;
    // Runner compares paths returned by its App Server, which uses ordinary DOS/UNC spelling.
    Ok(Installation { root: installation_path(&root), python: installation_path(&python) })
}

fn verify_python(root: &Path, python: &Path) -> Result<(), String> {
    const PROBE: &str = "import os,sys,runner; from pathlib import Path; root=Path(sys.argv[1]); assert os.path.samefile(sys.prefix,root/'agent_runner/local/runtime/python-env'), 'wrong managed Python environment'; assert os.path.samefile(runner.__file__,root/'agent_runner/src/runner/__init__.py'), 'Runner source registration points to another installation'; print('HUB_RUNNER_RUNTIME_OK')";
    let mut command = Command::new(python);
    command.args(["-I", "-c", PROBE]).arg(root).current_dir(root).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    clean_environment(&mut command);
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|e| format!("Managed Runner Python cannot start: {e}. Rerun the installation's native bootstrap."))?;
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            result => {
                let _ = child.kill(); let _ = child.wait();
                return Err(format!("Managed Python verification did not settle: {result:?}. Check the installation and rerun its native bootstrap."));
            }
        }
    }
    let result = child.wait_with_output().map_err(|e| e.to_string())?;
    if !result.status.success() || result.stdout != b"HUB_RUNNER_RUNTIME_OK\r\n" && result.stdout != b"HUB_RUNNER_RUNTIME_OK\n" {
        return Err(format!("Managed Python does not resolve this installed Runner. Rerun its native bootstrap. {}",
            String::from_utf8_lossy(&result.stderr).chars().take(1600).collect::<String>()));
    }
    Ok(())
}

pub fn prepare(location: &str, cols: u16, rows: u16) -> Result<OpenRequest, String> {
    let installation = resolve(location)?;
    // Process groups do not contain Runner's detached App Server children on macOS.
    // Fail before spawning until a supported descendant shutdown boundary is available.
    if cfg!(target_os = "macos") {
        return Err("Runner launch on macOS is unavailable: this build cannot safely contain detached Runner children. Windows Runner sessions are supported.".into());
    }
    Ok(OpenRequest { program: Some(installation.python), args: vec!["-I".into(), "-m".into(), "runner".into(),
        "run".into(), "--repo-root".into(), installation.root.clone()], cwd: Some(installation.root),
        env: [("AGENT_RUNNER_INTERACTIVE_BACKEND".into(), "retained".into()), ("PYTHONIOENCODING".into(), "utf-8".into())].into(),
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
        assert!(resolve("").err().unwrap().contains("absolute path"));
        assert!(resolve("crp").err().unwrap().contains("absolute path"));
        let missing = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("no-runner-installation");
        assert!(resolve(&missing.to_string_lossy()).err().unwrap().contains("unavailable"));
    }
}
