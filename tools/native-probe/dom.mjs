// Execute inside the owned WebView. No WebDriver pointer/key actions or desktop input.
export class Dom {
  constructor(browser) {
    this.browser = browser;
  }

  state(selector) {
    return this.browser.execute(selector => {
      const node = document.querySelector(selector);
      if (!node) return null;
      return {
        value: node.value ?? null, checked: node.checked ?? null,
        disabled: node.matches(':disabled'), readOnly: !!node.readOnly,
        focused: document.activeElement === node, text: node.textContent,
        rect: node.getBoundingClientRect().toJSON(),
        scroll: { left: node.scrollLeft, top: node.scrollTop, width: node.scrollWidth, height: node.scrollHeight },
        options: node.options ? Array.from(node.options, option => ({
          value: option.value, label: option.label, disabled: option.matches(':disabled'), selected: option.selected
        })) : null
      };
    }, selector);
  }

  click(selector) {
    return this.browser.execute(selector => {
      const node = document.querySelector(selector);
      if (!node || node.matches(':disabled')) throw new Error('Control unavailable: ' + selector);
      node.click();
    }, selector);
  }

  doubleClick(selector) {
    return this.dispatch(selector, 'dblclick', { detail: 2, button: 0 }, 'MouseEvent');
  }

  rightClick(selector) {
    return this.dispatch(selector, 'contextmenu', { button: 2 }, 'MouseEvent');
  }

  async hover(selector) {
    await this.dispatch(selector, 'mouseover', {}, 'MouseEvent');
    await this.dispatch(selector, 'mouseenter', { bubbles: false }, 'MouseEvent');
  }

  changeValue(selector, value) {
    return this.browser.execute((selector, value) => {
      const node = document.querySelector(selector);
      if (!node || node.matches(':disabled') || node.readOnly) throw new Error('Control unavailable: ' + selector);
      const select = node instanceof HTMLSelectElement;
      if (select && !Array.from(node.options).some(option => option.value === value && !option.matches(':disabled'))) {
        throw new Error('Option unavailable: ' + selector);
      }
      // Bypass React's instance value tracker, then notify the ordinary controlled input handler.
      Object.getOwnPropertyDescriptor(node.constructor.prototype, 'value').set.call(node, value);
      node.dispatchEvent(new Event(select ? 'change' : 'input', { bubbles: true }));
    }, selector, value);
  }

  key(selector, key, modifiers = {}) {
    return this.browser.execute((selector, key, modifiers) => {
      const node = document.querySelector(selector);
      if (!node || node.matches(':disabled')) throw new Error('Control unavailable: ' + selector);
      node.focus({ preventScroll: true });
      const init = { key, bubbles: true, cancelable: true, composed: true, ...modifiers };
      const allowed = node.dispatchEvent(new KeyboardEvent('keydown', init));
      node.dispatchEvent(new KeyboardEvent('keyup', init));
      return allowed;
    }, selector, key, modifiers);
  }

  dispatch(selector, type, init = {}, eventClass = 'Event') {
    return this.browser.execute((selector, type, init, eventClass) => {
      const node = document.querySelector(selector);
      if (!node) throw new Error('Element unavailable: ' + selector);
      const constructors = { Event, CustomEvent, InputEvent, MouseEvent, PointerEvent, KeyboardEvent, WheelEvent };
      return node.dispatchEvent(new constructors[eventClass](type, {
        bubbles: true, cancelable: true, composed: true, ...init
      }));
    }, selector, type, init, eventClass);
  }

  scroll(selector, position) {
    return this.browser.execute((selector, position) => {
      const node = document.querySelector(selector);
      if (!node) throw new Error('Element unavailable: ' + selector);
      node.scrollTo({ ...position, behavior: 'instant' });
      return { left: node.scrollLeft, top: node.scrollTop };
    }, selector, position);
  }

  drag(source, destination, point = {}) {
    return this.browser.execute((source, destination, point) => {
      const from = document.querySelector(source), to = document.querySelector(destination);
      if (!from || !to) throw new Error('Drag source or destination unavailable');
      const dataTransfer = new DataTransfer();
      const emit = (node, type) => {
        const rect = node.getBoundingClientRect();
        return node.dispatchEvent(new DragEvent(type, {
          bubbles: true, cancelable: true, composed: true, dataTransfer,
          clientX: point.x ?? rect.x + rect.width / 2, clientY: point.y ?? rect.y + rect.height / 2
        }));
      };
      if (!emit(from, 'dragstart')) return false;
      try {
        emit(to, 'dragenter');
        if (emit(to, 'dragover')) return false;
        emit(to, 'drop');
        return true;
      } finally {
        emit(from, 'dragend');
      }
    }, source, destination, point);
  }
}
