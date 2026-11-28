type ChangeLine = { marker: ' ' | '+' | '-' | '\\'; text: string; old?: number; next?: number };
type ChangeHunk = { header: string; lines: ChangeLine[] };
type ChangeFile = { oldPath: string; newPath: string; additions: number; removals: number; hunks: ChangeHunk[] };

const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/;
const gitMetadata = /^(?:index |(?:old|new) mode |(?:new|deleted) file mode |(?:dis)?similarity index |(?:rename|copy) (?:from|to) )/;
const newlineMarker = '\\ No newline at end of file';

export function parseDiff(text: string): ChangeFile[] | null {
  const source = text.replace(/^\uFEFF/, '');
  const crlf = source[source.indexOf('\n') - 1] === '\r';
  const lines = source.split('\n');
  if (crlf) {
    for (let index = 0; index < lines.length; index++) lines[index] = lines[index].replace(/\r$/, '');
  }
  if (lines.at(-1) === '') lines.pop();

  const files: ChangeFile[] = [];
  let index = 0;
  // Format-patch email headers, commit messages and diffstats precede the first Git file.
  if (/^From [0-9a-f]+ /.test(lines[0] ?? '')) {
    while (index < lines.length && !lines[index].startsWith('diff --git ')) index++;
  }

  while (index < lines.length) {
    if (/^diff (?:--git |-[^\s]+ )/.test(lines[index])) {
      const git = lines[index++].startsWith('diff --git ');
      if (git) while (index < lines.length && gitMetadata.test(lines[index])) index++;
    }

    const oldHeader = lines[index++];
    const newHeader = lines[index++];
    if (!oldHeader?.startsWith('--- ') || !newHeader?.startsWith('+++ ')) return null;
    const oldPath = oldHeader.slice(4).split('\t', 1)[0];
    const newPath = newHeader.slice(4).split('\t', 1)[0];
    if (!oldPath || !newPath || (oldPath === '/dev/null' && newPath === '/dev/null')) return null;
    const file: ChangeFile = { oldPath, newPath, additions: 0, removals: 0, hunks: [] };
    let oldEnd = 0;
    let newEnd = 0;
    let oldAtEof = false;
    let newAtEof = false;

    while (lines[index]?.startsWith('@@')) {
      const header = lines[index++];
      const match = hunkHeader.exec(header);
      if (!match) return null;
      let old = Number(match[1]);
      let next = Number(match[3]);
      let oldLeft = Number(match[2] ?? 1);
      let newLeft = Number(match[4] ?? 1);
      if (![old, next, oldLeft, newLeft, old + oldLeft, next + newLeft].every(Number.isSafeInteger)
        || (oldLeft && (!old || oldPath === '/dev/null'))
        || (newLeft && (!next || newPath === '/dev/null'))
        || (!oldLeft && !newLeft)) return null;
      const oldBefore = old - Number(oldLeft > 0);
      const newBefore = next - Number(newLeft > 0);
      if (oldBefore < oldEnd || newBefore < newEnd) return null;
      oldEnd = oldBefore + oldLeft;
      newEnd = newBefore + newLeft;

      const hunk: ChangeHunk = { header, lines: [] };
      while (oldLeft || newLeft) {
        const line = lines[index++];
        const marker = line?.[0];
        if (marker !== ' ' && marker !== '+' && marker !== '-') return null;
        const change: ChangeLine = { marker, text: line.slice(1) };
        if (marker !== '+') {
          if (oldAtEof || oldLeft-- === 0) return null;
          change.old = old++;
        }
        if (marker !== '-') {
          if (newAtEof || newLeft-- === 0) return null;
          change.next = next++;
        }
        if (marker === '+') file.additions++;
        if (marker === '-') file.removals++;
        hunk.lines.push(change);
        if (lines[index] === newlineMarker) {
          if ((marker !== '+' && oldLeft) || (marker !== '-' && newLeft)) return null;
          if (marker !== '+') oldAtEof = true;
          if (marker !== '-') newAtEof = true;
          hunk.lines.push({ marker: '\\', text: lines[index++].slice(1) });
        }
      }
      file.hunks.push(hunk);
    }
    if (!file.hunks.length || (!file.additions && !file.removals)) return null;
    files.push(file);

    // Git's optional format-patch signature follows the final file.
    if (lines[index] === '-- ' && /^(\d+\.)+\d+[\w.+-]*$/.test(lines[index + 1] ?? '')
      && lines.slice(index + 2).every(line => line === '')) break;
  }

  return files.length ? files : null;
}
