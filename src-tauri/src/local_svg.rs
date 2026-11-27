//! Render a bounded subset of static SVG without a browser or resource access.
use resvg::{tiny_skia, usvg};

const MAX_SVG_BYTES: usize = 256 * 1024;
const MAX_XML_NODES: u32 = 4096;
const MAX_DEPTH: usize = 64;
const MAX_RENDERED_NODES: usize = 8192;
const MAX_EDGE: f32 = 512.0;
const MAX_NESTED_LAYERS: usize = 4;

pub fn rasterize(bytes: &[u8]) -> Result<Vec<u8>, &'static str> {
    if bytes.len() > MAX_SVG_BYTES { return Err("oversize"); }
    let xml = std::str::from_utf8(bytes).map_err(|_| "decoding")?;
    let document = roxmltree::Document::parse_with_options(xml.trim_start_matches('\u{feff}'),
        roxmltree::ParsingOptions { nodes_limit: MAX_XML_NODES, ..Default::default() })
        .map_err(|error| if error == roxmltree::Error::NodesLimitReached { "oversize" } else { "decoding" })?;
    for node in document.descendants().filter(roxmltree::Node::is_element) {
        if node.ancestors().take(MAX_DEPTH + 1).count() > MAX_DEPTH {
            return Err("oversize");
        }
        // These effects can allocate additional surfaces outside the main canvas budget.
        if matches!(node.tag_name().name(), "filter" | "pattern" | "mask") {
            return Err("unsupported");
        }
    }
    let options = usvg::Options {
        image_href_resolver: usvg::ImageHrefResolver {
            resolve_data: Box::new(|_, _, _| None),
            resolve_string: Box::new(|_, _| None),
        },
        ..Default::default()
    };
    let tree = usvg::Tree::from_xmltree(&document, &options).map_err(|_| "decoding")?;
    let mut remaining = MAX_RENDERED_NODES;
    check_groups(tree.root(), 0, 0, &mut remaining)?;

    let size = tree.size();
    let scale = (MAX_EDGE / size.width().max(size.height())).min(1.0);
    let width = (size.width() * scale).ceil() as u32;
    let height = (size.height() * scale).ceil() as u32;
    let mut pixmap = tiny_skia::Pixmap::new(width, height).ok_or("oversize")?;
    resvg::render(&tree, tiny_skia::Transform::from_scale(scale, scale), &mut pixmap.as_mut());
    pixmap.encode_png().map_err(|_| "decoding")
}

fn check_groups(group: &usvg::Group, depth: usize, layers: usize, remaining: &mut usize) -> Result<(), &'static str> {
    let layers = layers + usize::from(group.should_isolate());
    if depth > MAX_DEPTH || layers > MAX_NESTED_LAYERS { return Err("oversize"); }
    *remaining = remaining.checked_sub(group.children().len()).ok_or("oversize")?;
    for node in group.children() {
        if let usvg::Node::Group(child) = node {
            check_groups(child, depth + 1, layers, remaining)?;
        }
    }
    Ok(())
}
