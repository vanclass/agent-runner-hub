use super::*;
fn gif_fixture() -> (Metadata, Vec<u8>) {
    // Hand-authored GIF89a: two full 2x1 red/blue frames, 200ms each, infinite loop.
    let bytes = STANDARD.decode("R0lGODlhAgABAIAAAP8AAAAA/yH/C05FVFNDQVBFMi4wAwEAAAAh+QQAFAAAACwAAAAAAgABAAACAgQKACH5BAAUAAAALAAAAAACAAEAAAICTAoAOw==").unwrap();
    let (mut image, _) = fixture();
    image.mime_type = "image/gif".into();
    image.byte_length = bytes.len() as u64;
    image.sha256 = format!("{:x}", Sha256::digest(&bytes));
    (image, bytes)
}
#[test]
fn capability_shapes_and_advertised_metadata_are_exact() {
    let old = cap();
    let mut value = json!({"version":1,"operations":old.operations,"mime_types":["image/png","image/gif"],
        "max_image_bytes":MAX_BYTES,"max_chunk_bytes":17,"page_size":2,"lifetime":"owning_control_connection","read_only":true});
    let new = Capability::read(&value).unwrap();
    let (gif, _) = gif_fixture();
    assert!(Metadata::read(&wire(&gif), &old).is_err());
    assert_eq!(Metadata::read(&wire(&gif), &new).unwrap(), gif);
    for mime in [json!([]), json!(["image/gif"]), json!(["image/gif","image/png"]),
        json!(["image/png","image/png"]), json!(["image/png","image/webp"]), json!(["image/png",null]), json!("image/png")] {
        value["mime_types"] = mime; assert!(Capability::read(&value).is_none());
    }
}
#[test]
fn complete_gif_preserves_frames_bytes_and_owned_resource_cleanup() {
    let (image, bytes) = gif_fixture();
    verify(&image, &bytes).unwrap();
    let mut options = gif::DecodeOptions::new(); options.set_color_output(gif::ColorOutput::Indexed);
    let mut decoder = options.read_info(Cursor::new(&bytes)).unwrap();
    let mut frames = Vec::new();
    while let Some(frame) = decoder.read_next_frame().unwrap() { frames.push(frame.buffer.to_vec()); }
    assert_eq!(frames, [vec![0,0], vec![1,1]]);
    let images = Images::default(); catalog(&images, &image);
    let result = images.read(&image.image_id, |request| {
        let Request::Read { offset, .. } = request else { panic!() };
        let mut capability = cap(); capability.mime_types.push("image/gif".into());
        response(&Request::Read { image: image.clone(), offset, length: 17 },
            &capability, &chunk(&image, &bytes, offset, 17), "accepted")
    }, || true).unwrap();
    assert_eq!(result.bytes, bytes); assert_eq!(result.image, image);
    images.clear(); assert!(images.read(&image.image_id, |_| panic!(), || true).is_err());
}
fn cap() -> Capability {
    Capability::read(&json!({"version":1,"operations":["generated_images.list","generated_images.read"],
        "mime_types":["image/png"],"max_image_bytes":MAX_BYTES,"max_chunk_bytes":17,"page_size":2,
        "lifetime":"owning_control_connection","read_only":true})).unwrap()
}
#[test]
fn malformed_gif_structure_and_metadata_fail_even_with_matching_transport_hash() {
    let (image, bytes) = gif_fixture();
    for index in 0..bytes.len() {
        let truncated = &bytes[..index]; let mut item = image.clone();
        item.byte_length = truncated.len() as u64; item.sha256 = format!("{:x}", Sha256::digest(truncated));
        assert!(verify(&item, truncated).is_err(), "truncation at {index}");
    }
    for (offset, value) in [(6, 3), (6, 255), (7, 255), (8, 0), (48, 3), (74, 255), (78, 0x94)] {
        let mut corrupt = bytes.clone(); corrupt[offset] = value;
        let mut item = image.clone(); item.sha256 = format!("{:x}", Sha256::digest(&corrupt));
        assert!(verify(&item, &corrupt).is_err(), "corruption at {offset}");
    }
    let mut trailing = bytes.clone(); trailing.push(0);
    let mut item = image.clone(); item.byte_length += 1; item.sha256 = format!("{:x}", Sha256::digest(&trailing));
    assert!(verify(&item, &trailing).is_err());
    for (field, value) in [("width", json!(3)), ("height", json!(0)), ("mime_type", json!("image/webp")),
        ("byte_length", json!(MAX_BYTES+1)), ("source_sequence", json!(0)), ("output_index", json!(1))] {
        let mut packet = wire(&image); packet[field] = value;
        let mut supported = cap(); supported.mime_types.push("image/gif".into());
        let parsed = Metadata::read(&packet, &supported);
        assert!(parsed.is_err() || verify(&parsed.unwrap(), &bytes).is_err());
    }
}
#[test]
fn gif_lzw_termination_palette_and_excess_pixels_are_verified() {
    let (image, bytes) = gif_fixture();
    for raster in [[0x04, 0x00], [0x04, 0x50], [0x94, 0x0a], [0x44, 0x01]] {
        let mut corrupt = bytes.clone(); corrupt[58..60].copy_from_slice(&raster);
        let mut item = image.clone(); item.sha256 = format!("{:x}", Sha256::digest(&corrupt));
        assert!(verify(&item, &corrupt).is_err(), "raster {raster:?}");
    }
    let mut split = bytes.clone(); split.splice(57..60, [1, 0x04, 1, 0x0a]);
    let mut item = image.clone(); item.byte_length = split.len() as u64;
    item.sha256 = format!("{:x}", Sha256::digest(&split)); verify(&item, &split).unwrap();
    let mut huge = bytes.clone(); huge[6..10].copy_from_slice(&[255;4]);
    item = image.clone(); item.width = 65535; item.height = 65535;
    item.sha256 = format!("{:x}", Sha256::digest(&huge)); assert!(verify(&item, &huge).is_err());
    item = image.clone(); item.sha256 = "0".repeat(64); assert!(verify(&item, &bytes).is_err());
    item = image.clone(); item.byte_length += 1; assert!(verify(&item, &bytes).is_err());
    item = image.clone(); item.mime_type = "image/png".into(); assert!(verify(&item, &bytes).is_err());
    let (mut png, png_bytes) = fixture(); png.mime_type = "image/gif".into();
    assert!(verify(&png, &png_bytes).is_err());
}
#[test]
fn gif_chunks_retain_identity_boundaries_and_session_lifetime() {
    let (image, bytes) = gif_fixture(); let mut supported = cap();
    supported.mime_types.push("image/gif".into());
    let request = Request::Read { image: image.clone(), offset: 0, length: 17 };
    for (field, value) in [("mime_type", json!("image/png")), ("source_sequence", json!(2)),
        ("output_index", json!(1)), ("byte_length", json!(84)), ("offset", json!(1)),
        ("next_offset", json!(18)), ("data_base64", json!(STANDARD.encode(&bytes[..16])))] {
        let mut packet = chunk(&image, &bytes, 0, 17); packet[field] = value;
        assert!(response(&request, &supported, &packet, "accepted").is_err(), "{field}");
    }
    let a = Images::default(); let b = Images::default(); catalog(&a, &image);
    assert!(b.read(&image.image_id, |_| panic!("foreign catalog"), || true).is_err());
    let alive = std::cell::Cell::new(true);
    assert!(a.read(&image.image_id, |_| { alive.set(false);
        Ok(Reply::Chunk { bytes: bytes.clone(), next: None }) }, || alive.get()).is_err());
}
fn fixture() -> (Metadata, Vec<u8>) {
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, 2, 1);
        encoder.set_color(png::ColorType::Rgb); encoder.set_depth(png::BitDepth::Eight);
        encoder.write_header().unwrap().write_image_data(&[255, 0, 0, 0, 255, 0]).unwrap();
    }
    let image = Metadata { image_id: "a".repeat(32), source_sequence: 1, output_index: 0,
        source: "codex.imageGeneration".into(), mime_type: "image/png".into(), byte_length: bytes.len() as u64,
        sha256: format!("{:x}", Sha256::digest(&bytes)), width: 2, height: 1 };
    (image, bytes)
}
fn wire(image: &Metadata) -> Value {
    json!({"image_id":image.image_id,"source_sequence":image.source_sequence,"output_index":image.output_index,
        "source":image.source,"mime_type":image.mime_type,"byte_length":image.byte_length,"sha256":image.sha256,
        "width":image.width,"height":image.height})
}
fn chunk(image: &Metadata, bytes: &[u8], offset: u64, length: u64) -> Value {
    let end = (offset + length).min(bytes.len() as u64);
    let mut packet = wire(image);
    packet["phase"] = json!("completed"); packet["offset"] = json!(offset);
    packet["data_base64"] = json!(STANDARD.encode(&bytes[offset as usize..end as usize]));
    packet["next_offset"] = json!((end < bytes.len() as u64).then_some(end));
    packet
}
fn catalog(images: &Images, image: &Metadata) {
    images.list(|_| Ok(Reply::Page { images: vec![image.clone()], total: 1, next: None, incomplete: None }), || true).unwrap();
}
#[test]
fn complete_ordered_chunks_produce_verified_png_only_after_sha_and_decode() {
    let images = Images::default(); let (image, bytes) = fixture(); catalog(&images, &image);
    let mut offsets = Vec::new();
    let verified = images.read(&image.image_id, |request| {
        let Request::Read { image, offset, .. } = request else { panic!() };
        offsets.push(offset);
        response(&Request::Read { image: image.clone(), offset, length: 17 }, &cap(), &chunk(&image, &bytes, offset, 17), "accepted")
    }, || true).unwrap();
    assert_eq!(verified.bytes, bytes); assert_eq!(offsets, (0..bytes.len() as u64).step_by(17).collect::<Vec<_>>());
    assert_eq!(verified.image, image);
}
#[test]
fn malformed_changed_missing_oversized_and_unsupported_chunks_are_rejected() {
    let (image, bytes) = fixture();
    let request = Request::Read { image: image.clone(), offset: 0, length: 17 };
    for (field, value) in [("image_id", json!("b".repeat(32))), ("offset", json!(1)),
        ("sha256", json!("0".repeat(64))), ("width", json!(3)), ("source_sequence", json!(2)),
        ("next_offset", Value::Null), ("data_base64", json!("!invalid!")),
        ("byte_length", json!(MAX_BYTES + 1)), ("mime_type", json!("image/jpeg")),
        ("data_base64", json!(STANDARD.encode(vec![1; 18])))] {
        let mut packet = chunk(&image, &bytes, 0, 17); packet[field] = value;
        assert!(response(&request, &cap(), &packet, "accepted").is_err(), "{field}");
    }
    let mut packet = chunk(&image, &bytes, 0, 17); packet.as_object_mut().unwrap().remove("next_offset");
    assert!(response(&request, &cap(), &packet, "accepted").is_err());
    assert_eq!(response(&request, &cap(), &json!({"code":"GENERATED_IMAGE_UNAVAILABLE"}), "rejected").err().unwrap().state, "unavailable");
}
#[test]
fn discovery_preserves_source_order_and_rejects_invalid_pagination() {
    let images = Images::default(); let (first, _) = fixture();
    let mut second = first.clone(); second.image_id = "b".repeat(32); second.source_sequence = 5;
    let mut third = first.clone(); third.image_id = "c".repeat(32); third.source_sequence = 2;
    let expected = vec![first, second, third];
    let actual = images.list(|request| {
        let Request::List { offset } = request else { panic!() };
        let packet = json!({"phase":"completed","offset":offset,"total_count":3,
            "images":expected.iter().skip(offset as usize).take(2).map(wire).collect::<Vec<_>>(),
            "next_offset":if offset == 0 {Some(2)} else {None}});
        response(&Request::List { offset }, &cap(), &packet, "accepted")
    }, || true).unwrap();
    assert_eq!(actual.images, expected);
    assert!(actual.incomplete.is_none());
    for field in ["offset", "next_offset", "total_count"] {
        let mut packet = json!({"phase":"completed","offset":0,"total_count":3,"images":[wire(&expected[0]),wire(&expected[1])],"next_offset":2});
        packet[field] = json!(999);
        assert!(response(&Request::List { offset: 0 }, &cap(), &packet, "accepted").is_err());
    }
    assert!(images.list(|_| Ok(Reply::Page { images: vec![expected[0].clone(), expected[0].clone()], total: 2, next: None, incomplete: None }), || true).is_err());
}
#[test]
fn final_length_hash_png_and_session_lifetime_gate_publication() {
    let (image, bytes) = fixture();
    for corrupt in [bytes[..bytes.len() - 1].to_vec(), vec![0; bytes.len()]] { assert!(verify(&image, &corrupt).is_err()); }
    let mut wrong = image.clone(); wrong.sha256 = "0".repeat(64); assert!(verify(&wrong, &bytes).is_err());
    let mut trailing = bytes.clone(); trailing.push(0); wrong = image.clone();
    wrong.byte_length = trailing.len() as u64; wrong.sha256 = format!("{:x}", Sha256::digest(&trailing));
    assert!(verify(&wrong, &trailing).is_err());
    let a = Images::default(); let b = Images::default(); catalog(&a, &image);
    assert!(b.read(&image.image_id, |_| panic!("foreign image read"), || true).is_err());
    let alive = std::cell::Cell::new(true);
    assert!(a.read(&image.image_id, |_| { alive.set(false); Ok(Reply::Chunk { bytes: bytes.clone(), next: None }) }, || alive.get()).is_err());
    assert!(a.read(&image.image_id, |_| Ok(Reply::Chunk { bytes: bytes[..17].to_vec(), next: None }), || true).is_err());
    a.clear(); assert!(a.read(&image.image_id, |_| panic!(), || true).is_err());
    catalog(&b, &image); a.clear(); assert_eq!(b.catalog.lock().unwrap().len(), 1);
}

#[test]
fn rejected_partial_inventories_retain_verified_images_and_safe_actionable_failures() {
    let (image, bytes) = fixture();
    for code in ["GENERATED_IMAGE_RESOLVER_UNAVAILABLE", "GENERATED_IMAGE_CONTRACT_INVALID",
        "GENERATED_IMAGE_CAPACITY_EXCEEDED", "GENERATED_IMAGE_SOURCE_UNVERIFIED", "GENERATED_IMAGE_UNAVAILABLE"] {
        let images = Images::default();
        let inventory = images.list(|request| response(&request, &cap(), &json!({"phase":"completed",
            "code":code,"remedy":"PRIVATE PAYLOAD", "offset":0,"next_offset":null,"total_count":1,"images":[wire(&image)]}), "rejected"), || true).unwrap();
        assert_eq!(inventory.images, [image.clone()]);
        let warning = inventory.incomplete.unwrap();
        assert_eq!(warning.state, "incomplete");
        assert!(warning.detail.contains(code));
        assert!(!warning.detail.contains("PRIVATE"));
        assert_eq!(images.read(&image.image_id, |_| Ok(Reply::Chunk { bytes: bytes.clone(), next: None }), || true).unwrap().bytes, bytes);
    }
}

#[test]
fn malformed_independent_metadata_does_not_hide_valid_images_but_pagination_stays_strict() {
    let (image, _) = fixture(); let images = Images::default();
    let mut packet = json!({"phase":"completed","offset":0,"next_offset":null,"total_count":2,
        "images":[wire(&image),{"fileId":"opaque-private"}]});
    let inventory = images.list(|request| response(&request, &cap(), &packet, "accepted"), || true).unwrap();
    assert_eq!(inventory.images, [image.clone()]); assert!(inventory.incomplete.is_some());
    packet["next_offset"] = json!(1);
    assert!(response(&Request::List { offset:0 }, &cap(), &packet, "rejected").is_err());
    assert!(images.list(|_| panic!("expired session must not send"), || false).is_err());
    assert!(images.catalog.lock().unwrap().is_empty());
}

#[test]
fn corrupt_png_is_rejected_even_when_transport_digest_matches() {
    let (mut image, mut bytes) = fixture();
    bytes[29] ^= 1; // IHDR checksum, independently of transport SHA-256.
    image.sha256 = format!("{:x}", Sha256::digest(&bytes));
    assert!(verify(&image, &bytes).is_err());
}
