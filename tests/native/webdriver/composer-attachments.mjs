import { PreviewViewer } from './preview-viewer.mjs';

const composers = {
  'single-entry': '.composer-area:not(.runner-composer)',
  runner: '.runner-composer'
};

function composerSelector(surface) {
  const composer = composers[surface];
  if (!composer) throw new TypeError('Unknown composer surface: ' + surface);
  return composer;
}

export function instructionSelector(surface) {
  return composerSelector(surface) + ' textarea[data-instruction]';
}

function attachmentSelector(surface) {
  return composerSelector(surface) + ' .attachment-composer';
}

function chipSelector(surface, index) {
  return attachmentSelector(surface) + ' .attachment-chip:nth-child(' + (index + 1) + ')';
}

export class ComposerAttachments {
  constructor(dom) {
    this.dom = dom;
    this.viewer = new PreviewViewer(dom);
  }

  // Both files and folders enter the same native drop handler. Registration resolves their kinds.
  dropPaths(surface, paths) {
    return this.dom.browser.execute(({ selector, paths }) => {
      const node = document.querySelector(selector);
      if (!node) throw new Error('Composer unavailable: ' + selector);
      const rect = node.getBoundingClientRect();
      const position = { x: (rect.left + rect.width / 2) * devicePixelRatio,
        y: (rect.top + rect.height / 2) * devicePixelRatio };
      const label = window.__TAURI_INTERNALS__.metadata.currentWindow.label;
      return window.__TAURI_INTERNALS__.invoke('plugin:event|emit_to', {
        target: { kind: 'Window', label }, event: 'tauri://drag-drop', payload: { paths, position }
      });
    }, { selector: attachmentSelector(surface), paths });
  }

  pasteText(surface, text) {
    return this.dom.paste(instructionSelector(surface), text);
  }

  pasteImage(surface, { bytes, name, type }) {
    return this.dom.paste(instructionSelector(surface), { bytes: Array.from(bytes), name, type });
  }

  inventory(surface) {
    return this.dom.browser.execute(selector => {
      const composer = document.querySelector(selector);
      if (!composer) return null;
      const items = Array.from(composer.querySelectorAll('.attachment-chip'), (chip, index) => {
        const opener = chip.querySelector('.attachment-open');
        const image = opener.querySelector('img');
        return { index, name: opener.querySelector('span').textContent, path: opener.title || null,
          status: chip.querySelector('[role="status"]')?.textContent.trim() ?? null,
          removable: !chip.querySelector('.attachment-remove').disabled,
          thumbnail: image && { source: image.src, width: image.naturalWidth, height: image.naturalHeight } };
      });
      return { items, alerts: Array.from(composer.querySelectorAll('[role="alert"]'), alert => alert.textContent) };
    }, attachmentSelector(surface));
  }

  remove(surface, index) {
    return this.dom.click(chipSelector(surface, index) + ' .attachment-remove');
  }

  openPreview(surface, index) {
    return this.dom.click(chipSelector(surface, index) + ' .attachment-open');
  }
}
