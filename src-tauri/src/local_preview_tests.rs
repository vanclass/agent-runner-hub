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
            let selected = classify(&path).unwrap();
            assert_eq!(selected.category, format.category, "{path}");
            assert_eq!(selected.mime, format.mime, "{path}");
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
        Preview::Image { path: identity, base64, mime: "image/png" } => {
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
    selected_images(&root);
}

fn selected_images(root: &std::path::Path) {
    let fixtures = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("test-fixtures/preview-images");
    for (name, source, expected_mime, size) in [
        ("sample.JPG", "sample.jpg", "image/jpeg", (16, 8)),
        ("sample.jpeg", "sample.jpg", "image/jpeg", (16, 8)),
        ("sample.webp", "sample.webp", "image/webp", (16, 8)),
        ("extended.webp", "extended.webp", "image/webp", (16, 8)),
        ("sample.bmp", "sample.bmp", "image/png", (16, 8)),
        ("sample.ico", "sample.ico", "image/png", (16, 8)),
        ("animated.gif", "animated.gif", "image/gif", (2, 1)),
        ("static.svg", "static.svg", "image/png", (16, 8)),
    ] {
        let original = fs::read(fixtures.join(source)).unwrap();
        let path = root.join(name);
        fs::write(&path, &original).unwrap();
        let Preview::Image { path: identity, base64, mime } = read(path.to_str().unwrap().into()) else {
            panic!("Failed to read {name}");
        };
        assert_eq!(path.to_str().unwrap(), identity);
        assert_eq!(expected_mime, mime);
        let preview = STANDARD.decode(base64).unwrap();
        if mime == "image/png" {
            let mut reader = png::Decoder::new(std::io::Cursor::new(preview)).read_info().unwrap();
            let mut pixels = vec![0; reader.output_buffer_size().unwrap()];
            let info = reader.next_frame(&mut pixels).unwrap();
            assert_eq!((info.width, info.height), size);
            if source.ends_with(".svg") { assert!(pixels.chunks_exact(4).all(|p| p == [255, 0, 0, 255])); }
        } else { assert_eq!(preview, original); }
        assert_eq!(fs::read(&path).unwrap(), original);
    }
    selected_image_failures(root, &fixtures);
}

fn selected_image_failures(root: &std::path::Path, fixtures: &std::path::Path) {
    let gif = fs::read(fixtures.join("animated.gif")).unwrap();
    let truncated = &gif[..gif.len() - 2];
    let mut large_bmp = fs::read(fixtures.join("sample.bmp")).unwrap();
    large_bmp[18..22].copy_from_slice(&8_192i32.to_le_bytes());
    large_bmp[22..26].copy_from_slice(&8_192i32.to_le_bytes());
    let oversized_svg = vec![b' '; 1024 * 1024];
    let mut mismatched_webp = fs::read(fixtures.join("extended.webp")).unwrap();
    mismatched_webp[24..27].copy_from_slice(&[1, 0, 0]); // Change only the VP8X canvas width.
    for (name, bytes, reason) in [
        ("truncated.gif", truncated, "decoding"),
        ("mismatched.jpg", &gif, "decoding"),
        ("mismatched.bmp", &gif, "decoding"),
        ("mismatched.webp", &gif, "decoding"),
        ("mismatched-canvas.webp", &mismatched_webp, "decoding"),
        ("broken.svg", b"<svg><rect></svg>", "decoding"),
        ("external-entity.svg", br#"<!DOCTYPE svg SYSTEM "https://example.invalid/test"><svg xmlns="http://www.w3.org/2000/svg"/>"#, "decoding"),
        ("large.svg", &oversized_svg, "oversize"),
        ("unqualified-filter.svg", br#"<svg width="16" height="8"><filter id="effect"/></svg>"#, "unsupported"),
        ("large.bmp", &large_bmp, "oversize"),
    ] {
        let path = root.join(name);
        fs::write(&path, bytes).unwrap();
        let result = read(path.to_str().unwrap().into());
        assert!(matches!(&result, Preview::Unavailable { reason: actual, .. } if *actual == reason),
            "{name}: {result:?}");
    }
}
