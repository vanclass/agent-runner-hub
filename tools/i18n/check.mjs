import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../', import.meta.url));
export function flatten(value, prefix = '', result = {}) {
  for (const [key, item] of Object.entries(value)) {
    const name = prefix + key;
    if (typeof item === 'string') result[name] = item;
    else if (item && typeof item === 'object' && !Array.isArray(item)) flatten(item, name + '.', result);
    else throw new Error('Non-text catalog entry: ' + name);
  }
  return result;
}
export const variables = text => [...text.matchAll(/{{\s*([A-Za-z][A-Za-z0-9_]*)\s*}}/g)]
  .map(match => match[1]).filter((value, index, all) => all.indexOf(value) === index).sort();
export function checkCatalogs(english, korean, sources) {
  const en = flatten(english), ko = flatten(korean), errors = [], used = new Set();
  for (const key of new Set([...Object.keys(en), ...Object.keys(ko)])) {
    if (!(key in en) || !(key in ko)) { errors.push('Missing locale key: ' + key); continue; }
    if (!en[key].trim() || !ko[key].trim()) errors.push('Empty translation: ' + key);
    if (variables(en[key]).join() !== variables(ko[key]).join()) errors.push('Variable mismatch: ' + key);
    if (/[{}]/.test(en[key].replace(/{{\s*[A-Za-z][A-Za-z0-9_]*\s*}}/g, ''))
      || /[{}]/.test(ko[key].replace(/{{\s*[A-Za-z][A-Za-z0-9_]*\s*}}/g, ''))) errors.push('Invalid interpolation: ' + key);
  }
  for (const [filename, text] of Object.entries(sources)) {
    const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true,
      filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    function visit(node) {
      if (ts.isStringLiteralLike(node) && node.text in en) used.add(node.text);
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ['t', 'msg'].includes(node.expression.text)
        && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        const key = node.arguments[0].text;
        if (!(key in en)) errors.push(filename + ': Missing source key: ' + key);
        else {
          const options = node.arguments[1];
          const names = options && ts.isObjectLiteralExpression(options)
            ? options.properties.map(property => property.name?.getText(source).replace(/['"]/g, '')).sort() : [];
          if (names.join() !== variables(en[key]).join()) errors.push(filename + ': Interpolation arguments: ' + key);
        }
      }
      if (ts.isJsxAttribute(node) && ['title', 'aria-label', 'placeholder', 'alt'].includes(node.name.getText(source))
        && node.initializer && ts.isStringLiteral(node.initializer) && /[a-zA-Z가-힣]{2}/.test(node.initializer.text))
        errors.push(filename + ': Unlocalized attribute: ' + node.initializer.text);
      if (ts.isJsxText(node)) {
        const visible = node.text.replace(/\s+/g, ' ').trim();
        if (/[a-zA-Z가-힣]{2}/.test(visible) && !['AgentRunnerHub', 'English', '한국어'].includes(visible))
          errors.push(filename + ': Unlocalized JSX: ' + visible);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  for (const key of Object.keys(en)) if (!used.has(key)) errors.push('Unused key: ' + key);
  return { errors, count: Object.keys(en).length };
}
export function inspectCatalogs() {
  const directory = path.join(root, 'src/hub');
  const sources = Object.fromEntries(fs.readdirSync(directory).filter(name => /\.tsx?$/.test(name))
    .map(name => [name, fs.readFileSync(path.join(directory, name), 'utf8')]));
  return checkCatalogs(JSON.parse(fs.readFileSync(path.join(directory, 'locales/en.json'), 'utf8')),
    JSON.parse(fs.readFileSync(path.join(directory, 'locales/ko.json'), 'utf8')), sources);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = inspectCatalogs();
  if (result.errors.length) { console.error(result.errors.join('\n')); process.exitCode = 1; }
  else console.log('English/Korean catalog integrity passed: ' + result.count + ' semantic keys.');
}
