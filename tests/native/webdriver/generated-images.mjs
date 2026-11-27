import { PreviewViewer } from './preview-viewer.mjs';

const section = '.generated-images';
const select = section + ' select';
const refresh = section + '-toolbar button';
const preview = '.generated-image-preview';

export class GeneratedImages {
  constructor(dom) {
    this.dom = dom;
    this.viewer = new PreviewViewer(dom);
  }

  state() {
    return this.dom.browser.execute(({ section, preview }) => {
      const node = document.querySelector(section);
      if (!node) return null;
      const select = node.querySelector('select');
      const image = node.querySelector(preview + ' img');
      return { status: node.dataset.state, text: node.textContent,
        items: Array.from(select?.options ?? [], option => ({ id: option.value, label: option.label })),
        selected: select?.value ?? null, refreshDisabled: node.querySelector('.generated-images-toolbar button').disabled,
        preview: image && { source: image.src, width: image.naturalWidth, height: image.naturalHeight } };
    }, { section, preview });
  }

  select(imageId) {
    return this.dom.changeValue(select, imageId);
  }

  refresh() {
    return this.dom.click(refresh);
  }

  openPreview() {
    return this.dom.click(preview);
  }

  // Read-only provenance observations for a caller-verified owning PTY.
  list(session) {
    return this.dom.browser.execute(id => window.__TAURI_INTERNALS__.invoke('runner_images_list', { id }), session);
  }

  read(session, imageId) {
    return this.dom.browser.execute(args => window.__TAURI_INTERNALS__.invoke('runner_image_read', args),
      { id: session, imageId });
  }
}
