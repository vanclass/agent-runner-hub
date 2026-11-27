use super::*;
use std::{fs, time::{SystemTime, UNIX_EPOCH}};

#[test]
fn catalog_dispatches_all_declared_names() {
    let formats: Vec<Format> = serde_json::from_str(include_str!("preview_formats.json")).unwrap();
    let mut names = std::collections::HashSet::new();
    for format in formats {
        for name in format.extensions.iter().map(|ext| format!("sample.{ext}"))
            .chain(format.filenames.iter().cloned()) {
            assert!(names.insert(name.to_ascii_lowercase()), "Duplicate selector: {name}");
            let path = format!("C:\\selected\\{}", name.to_ascii_uppercase());
            assert!(matches!((classify(&path), format.category),
                (Some(Category::Image), Category::Image) | (Some(Category::Text), Category::Text)), "{path}");
        }
    }
}

#[test]
fn selected_originals_and_failures() {
    let root = std::env::temp_dir().join(format!("hub-local-preview-{}-{}", std::process::id(),
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
    fs::create_dir(&root).unwrap();
    struct Cleanup(std::path::PathBuf);
    impl Drop for Cleanup { fn drop(&mut self) { fs::remove_dir_all(&self.0).unwrap(); } }
    let _cleanup = Cleanup(root.clone());
    for (name, original) in [
        ("original.txt", "첫 줄\n  둘째 줄\t {\"value\": 42}\n"),
        ("original.md", "# Markdown\n\n  원문\n"),
        ("original.json", "\u{feff}{\"value\": true}\n  "),
        ("source.CPP", "  int main() {\r\n\treturn 0;\r\n}\r\n"),
        ("config.yaml", "items:\n  - 한글\n"),
        ("data.jsonl", "{\"n\":1}\n{\"n\":2}\n"),
        ("deploy.ps1", "Write-Output '원문'\r\n"),
        ("page.html", "<script>Example()</script>\r\n"),
        ("build.log", "[INFO] build complete\r"),
        ("change.patch", "@@ -1 +1 @@\n-old\n+new\n"),
        ("Dockerfile", "FROM scratch\n"),
        ("Makefile", "build:\n\t@echo ok\n"),
        (".gitignore", "# Ignore outputs\n/dist/\n"),
    ] {
        let path = root.join(name);
        fs::write(&path, original).unwrap();
        let identity = path.to_str().unwrap().to_string();
        match read(identity.clone()) {
            Preview::Text { path, text } => { assert_eq!(path, identity); assert_eq!(text, original); }
            value => panic!("Unexpected {value:?}"),
        }
    }
    let path = root.join("actual.png");
    let mut bytes = Vec::new();
    { let mut encoder = png::Encoder::new(&mut bytes, 2, 1);
      encoder.set_color(png::ColorType::Rgba); encoder.set_depth(png::BitDepth::Eight);
      encoder.write_header().unwrap().write_image_data(&[31,87,201,255,255,0,0,255]).unwrap(); }
    fs::write(&path, &bytes).unwrap();
    match read(path.to_str().unwrap().into()) {
        Preview::Image { path: identity, base64 } => {
            assert_eq!(identity, path.to_str().unwrap()); assert_eq!(STANDARD.decode(base64).unwrap(), bytes);
        }
        value => panic!("Unexpected {value:?}"),
    }
    for (name, bytes, reason) in [("bad.png", vec![1,2,3], "decoding"),
        ("binary.txt", vec![0,1], "decoding"), ("encoding.rs", vec![0xff], "decoding"),
        ("large.jsonl", vec![b'a'; MAX_TEXT_BYTES+1], "oversize"),
        ("large.png", vec![0; MAX_FILE_BYTES+1], "oversize"), ("other.pdf", vec![], "unsupported"),
        (".json", vec![], "unsupported"), ("Dockerfile.pdf", vec![], "unsupported")] {
        let path = root.join(name); fs::write(&path, bytes).unwrap();
        match read(path.to_str().unwrap().into()) {
            Preview::Unavailable { reason: actual, .. } => assert_eq!(actual, reason),
            value => panic!("Unexpected {value:?}"),
        }
    }
    for (path, expected) in [(root.join("missing.txt"), "unreadable"), (root.join("folder.txt"), "unsupported")] {
        if expected == "unsupported" { fs::create_dir(&path).unwrap(); }
        assert!(matches!(read(path.to_str().unwrap().into()), Preview::Unavailable { reason, .. } if reason == expected));
    }
    bytes.truncate(bytes.len()-8); fs::write(&path, bytes).unwrap();
    assert!(matches!(read(path.to_str().unwrap().into()), Preview::Unavailable { reason: "decoding", .. }));
}
