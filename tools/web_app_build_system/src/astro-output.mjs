import fs from 'node:fs/promises';
import path from 'node:path';
import { treeHash, verifiedOutput } from './project.mjs';

// Astro emits complete documents and may emit no JavaScript at all.
export async function verifyAstroOutput(output) {
  if (await fs.realpath(output) !== path.resolve(output)) throw new Error('Indirect Astro output.');
  const files = new Map();
  async function visit(folder) {
    for (const name of await fs.readdir(folder)) {
      const file = path.join(folder, name), stat = await fs.lstat(file);
      if (stat.isSymbolicLink() || await fs.realpath(file) !== file) throw new Error('Indirect Astro asset.');
      if (stat.isDirectory()) await visit(file);
      else if (stat.isFile() && stat.nlink === 1) files.set(file, stat.size);
      else throw new Error('Unsupported Astro asset.');
    }
  }
  await visit(output);
  await verifiedOutput(output, 'AstroTS');
  function asset(reference, owner) {
    reference = reference.replaceAll('&amp;', '&').trim();
    if (!reference || reference.startsWith('#') || /^(https?:|data:|blob:|\/\/)/i.test(reference)) return;
    if (/^[a-z][a-z\d+.-]*:/i.test(reference)) throw new Error('Unsupported Astro asset URL.');
    const decoded = decodeURIComponent(reference.split(/[?#]/)[0]);
    if (decoded.includes('\\') || decoded.includes('\0')) throw new Error('Invalid Astro asset path.');
    const file = decoded.startsWith('/') ? path.resolve(output, '.' + decoded) : path.resolve(path.dirname(owner), decoded);
    const relative = path.relative(output, file);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Astro asset escapes output.');
    if (!files.get(file)) throw new Error('Missing or empty Astro asset: ' + reference);
  }
  function css(text, owner) {
    for (const match of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)/gi)) asset(match[1] ?? match[2] ?? match[3], owner);
    for (const match of text.matchAll(/@import\s+["']([^"']+)["']/gi)) asset(match[1], owner);
  }
  function srcset(value, owner) {
    let remaining = value;
    while ((remaining = remaining.replace(/^[\s,]+/, ''))) {
      const token = /^\S+/.exec(remaining)[0];
      remaining = remaining.slice(token.length);
      asset(token.replace(/,+$/, ''), owner);
      if (!token.endsWith(',')) {
        const separator = remaining.indexOf(',');
        remaining = separator < 0 ? '' : remaining.slice(separator + 1);
      }
    }
  }
  for (const file of files.keys()) {
    if (file.endsWith('.css')) css(await fs.readFile(file, 'utf8'), file);
    if (!file.endsWith('.html')) continue;
    const html = (await fs.readFile(file, 'utf8')).replace(/<!--[\s\S]*?-->/g, '');
    const document = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
    if (!['html', 'head', 'body'].every(tag => new RegExp('<' + tag + '(?:\\s|>)', 'i').test(document)
        && new RegExp('</' + tag + '\\s*>', 'i').test(document))) throw new Error('Astro output requires complete HTML documents.');
    if (/<base\b/i.test(document)) throw new Error('Astro output cannot override the static asset base.');
    const markup = html.replace(/<script\b([^>]*)>[\s\S]*?<\/script\s*>/gi, '<script$1></script>');
    for (const tag of markup.matchAll(/<(script|link|img|source|video|audio|track|iframe|embed|object|input)\b[^>]*>/gi)) {
      const attrs = new Map([...tag[0].matchAll(/\b([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
        .map(m => [m[1].toLowerCase(), m[2] ?? m[3] ?? m[4]]));
      for (const key of ['src', 'poster', 'data']) if (attrs.has(key)) asset(attrs.get(key), file);
      if (tag[1].toLowerCase() === 'link' && (attrs.get('rel') || '').split(/\s+/)
        .some(rel => /^(stylesheet|icon|preload|modulepreload|apple-touch-icon)$/i.test(rel))) asset(attrs.get('href') || '', file);
      if (attrs.has('srcset')) srcset(attrs.get('srcset'), file);
    }
    for (const style of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) css(style[1], file);
    for (const style of markup.matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) css(style[1] ?? style[2], file);
  }
  return treeHash(output);
}
