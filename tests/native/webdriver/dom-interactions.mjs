import assert from 'node:assert/strict';
import { defineNativeCase } from '../../../tools/native-probe/case.mjs';
import { Dom } from '../../../tools/native-probe/dom.mjs';
import { readyHub } from './probe.mjs';

export const domInteractions = defineNativeCase({
  id: 'dom-interactions', presentation: 'background', ready: readyHub,
  async run(browser) {
    const dom = new Dom(browser);
    await browser.execute(() => {
      const fixture = document.createElement('div');
      fixture.id = 'dom-interactions';
      fixture.innerHTML = '<input><select><option>A</option><option>B</option><option disabled>C</option></select>'
        + '<button type="button" draggable="true">Source</button><div class="drop">Destination</div>'
        + '<div class="scroll" style="height:30px;overflow:auto"><div style="height:150px"></div></div>';
      const events = [];
      fixture.events = events;
      const button = fixture.querySelector('button');
      for (const type of ['click', 'dblclick', 'contextmenu', 'mouseover', 'mouseenter', 'keydown', 'keyup', 'probe']) {
        button.addEventListener(type, event => events.push([event.type, event.isTrusted,
          event.key ?? null, event.ctrlKey ?? false, event.button ?? null, event.detail?.value ?? null]));
      }
      for (const type of ['input', 'change']) {
        fixture.addEventListener(type, event => events.push([type, event.isTrusted, event.target.value]));
      }
      button.addEventListener('dragstart', event => event.dataTransfer.setData('text/plain', 'probe-data'));
      button.addEventListener('dragend', event => events.push([event.type, event.isTrusted]));
      fixture.querySelector('.drop').addEventListener('dragover', event => event.preventDefault());
      fixture.querySelector('.drop').addEventListener('drop', event => {
        events.push([event.type, event.isTrusted, event.dataTransfer.getData('text/plain')]);
      });
      (document.querySelector('dialog[open]') ?? document.body).append(fixture);
    });
    try {
      const prefix = '#dom-interactions ';
      const button = prefix + 'button', select = prefix + 'select', input = prefix + 'input';
      await dom.click(button);
      await dom.doubleClick(button);
      await dom.rightClick(button);
      await dom.hover(button);
      await dom.key(button, 'Enter', { code: 'Enter', ctrlKey: true });
      await dom.dispatch(button, 'probe', { detail: { value: 7 } }, 'CustomEvent');
      await dom.changeValue(input, 'draft');
      await dom.changeValue(select, 'B');
      await assert.rejects(dom.changeValue(select, 'C'), /Option unavailable/);
      assert.ok(await dom.drag(button, prefix + '.drop'));
      const { top: scrollTop } = await dom.scroll(prefix + '.scroll', { top: 50 });
      assert.ok(Math.abs(scrollTop - 50) < 1, 'Scroll offset agrees within one CSS pixel');
      assert.equal((await dom.state(input)).value, 'draft');
      assert.equal((await dom.state(select)).value, 'B');
      assert.ok((await dom.state(button)).rect.width > 0);
      const events = await browser.execute(() => document.querySelector('#dom-interactions').events);
      assert.deepEqual(events, [
        ['click', false, null, false, 0, null],
        ['dblclick', false, null, false, 0, null],
        ['contextmenu', false, null, false, 2, null],
        ['mouseover', false, null, false, 0, null],
        ['mouseenter', false, null, false, 0, null],
        ['keydown', false, 'Enter', true, null, null],
        ['keyup', false, 'Enter', true, null, null],
        ['probe', false, null, false, null, 7],
        ['input', false, 'draft'], ['change', false, 'B'],
        ['drop', false, 'probe-data'], ['dragend', false]
      ]);
      return { events, scrollTop };
    } finally {
      await browser.execute(() => document.querySelector('#dom-interactions').remove());
    }
  }
});
