use super::*;
use std::{fs, time::{SystemTime, UNIX_EPOCH}};

#[test]
fn selected_originals_and_failures() {
    let root = std::env::temp_dir().join(format!("hub-local-preview-{}-{}", std::process::id(),
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
    fs::create_dir(&root).unwrap();
    struct Cleanup(std::path::PathBuf);
    impl Drop for Cleanup { fn drop(&mut self) { fs::remove_dir_all(&self.0).unwrap(); } }
    let _cleanup = Cleanup(root.clone());
    let original = "첫 줄\n  둘째 줄\t {\"value\": 42}\n";
    for extension in ["txt", "md", "json"] {
        let path = root.join(format!("original.{extension}"));
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
        ("binary.txt", vec![0,1], "decoding"), ("encoding.md", vec![0xff], "decoding"),
        ("large.json", vec![b'a'; MAX_TEXT_BYTES+1], "oversize"),
        ("large.png", vec![0; MAX_FILE_BYTES+1], "oversize"), ("other.pdf", vec![], "unsupported")] {
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
