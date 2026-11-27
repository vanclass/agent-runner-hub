const dialogSelector = '.focused-viewer[open]:not(.preview-help)';
const viewportSelector = dialogSelector + ' .focused-image-viewport';

export class PreviewViewer {
  constructor(dom) {
    this.dom = dom;
  }

  state() {
    return this.dom.browser.execute(selector => {
      const dialog = document.querySelector(selector);
      if (!dialog) return null;
      const host = dialog.querySelector('.focused-image-viewport');
      const image = host?.querySelector('img');
      const bounds = image?.getBoundingClientRect();
      const frame = dialog.getBoundingClientRect();
      return {
        name: dialog.querySelector('header')?.textContent ?? null,
        buttons: dialog.querySelectorAll('button').length,
        text: dialog.querySelector('.focused-text')?.textContent ?? null,
        status: dialog.querySelector('[role="status"]')?.textContent ?? null,
        image: bounds ? { source: image.src, width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y,
          naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
          contained: bounds.left >= frame.left && bounds.right <= frame.right
            && bounds.top >= frame.top && bounds.bottom <= frame.bottom,
          scale: Number(host.dataset.scale), panX: Number(host.dataset.x), panY: Number(host.dataset.y) } : null
      };
    }, dialogSelector);
  }

  zoom(deltaY) {
    return this.dom.dispatch(viewportSelector, 'wheel', { deltaY }, 'WheelEvent');
  }

  close() {
    return this.dom.browser.execute(selector => {
      const dialog = document.querySelector(selector);
      if (!dialog) throw new Error('Focused preview unavailable');
      dialog.close();
    }, dialogSelector);
  }
}
