import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCatalogs, inspectCatalogs } from '../../tools/i18n/check.mjs';

test('the complete English/Korean catalogs and source interpolation agree', () => {
  const result = inspectCatalogs();
  assert.deepEqual(result.errors, []);
  assert.ok(result.count > 0);
});
test('catalog validation rejects missing translations and missing source keys', () => {
  const result = checkCatalogs({ label: 'Label' }, {}, { 'view.tsx': "t('label'); t('missing')" });
  assert.ok(result.errors.some(value => value.includes('Missing locale key: label')));
  assert.ok(result.errors.some(value => value.includes('Missing source key: missing')));
});
test('catalog validation rejects variable drift, incorrect call arguments and unused keys', () => {
  const result = checkCatalogs({ greeting: 'Hello {{name}}', unused: 'Unused' },
    { greeting: '안녕 {{person}}', unused: '미사용' },
    { 'view.tsx': "t('greeting', { person: value })" });
  assert.ok(result.errors.some(value => value.includes('Variable mismatch: greeting')));
  assert.ok(result.errors.some(value => value.includes('Interpolation arguments: greeting')));
  assert.ok(result.errors.some(value => value.includes('Unused key: unused')));
});
test('catalog validation rejects untranslated JSX, empty values and malformed interpolation', () => {
  const result = checkCatalogs({ empty: '', broken: 'Hi {{0}}' }, { empty: '', broken: '안녕 {{0}}' },
    { 'view.tsx': "t('empty'); t('broken'); const view = <button>Untranslated action</button>" });
  assert.ok(result.errors.some(value => value.includes('Unlocalized JSX')));
  assert.ok(result.errors.some(value => value.includes('Empty translation')));
  assert.ok(result.errors.some(value => value.includes('Invalid interpolation')));
});
