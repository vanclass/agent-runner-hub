use super::*;
fn cap() -> Capability {
    Capability::read(&json!({"version":1,"operations":["generated_images.list","generated_images.read"],
        "mime_types":["image/png"],"max_image_bytes":MAX_BYTES,"max_chunk_bytes":17,"page_size":2,
        "lifetime":"owning_control_connection","read_only":true})).unwrap()
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
    images.list(|_| Ok(Reply::Page { images: vec![image.clone()], total: 1, next: None }), || true).unwrap();
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
    assert_eq!(verified.png, bytes); assert_eq!(offsets, (0..bytes.len() as u64).step_by(17).collect::<Vec<_>>());
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
    assert_eq!(actual, expected);
    for field in ["offset", "next_offset", "total_count"] {
        let mut packet = json!({"phase":"completed","offset":0,"total_count":3,"images":[wire(&expected[0]),wire(&expected[1])],"next_offset":2});
        packet[field] = json!(999);
        assert!(response(&Request::List { offset: 0 }, &cap(), &packet, "accepted").is_err());
    }
    assert!(images.list(|_| Ok(Reply::Page { images: vec![expected[0].clone(), expected[0].clone()], total: 2, next: None }), || true).is_err());
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