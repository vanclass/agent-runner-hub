import { useMemo } from 'react';
import { t } from './i18n';
import type { ArchiveEntry } from './localPreviews';
import './archivePreview.css';

type Folder = { name: string; children: Map<string, Node> };
type Node = Folder | { name: string; size: string };

function archiveTree(entries: ArchiveEntry[]) {
  const root: Folder = { name: '', children: new Map() };
  entries.forEach(({ name, directory, size }, index) => {
    const parts = (directory ? name.replace(/[\\/]$/, '') : name).split('/');
    const leaf = parts.pop()!;
    let folder = root;
    if (directory) parts.push(leaf);
    for (const part of parts) {
      const key = 'folder:' + part;
      const existing = folder.children.get(key);
      const child = existing && 'children' in existing ? existing : { name: part, children: new Map() };
      folder.children.set(key, child);
      folder = child;
    }
    if (!directory) folder.children.set('file:' + index, { name: leaf, size });
  });
  return root;
}

function formatSize(size: string) {
  const bytes = BigInt(size);
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB'];
  let scale = 1n;
  let unit = 0;
  while (unit < units.length - 1 && bytes >= 1024n * scale) {
    scale *= 1024n;
    unit++;
  }
  return (Number(bytes) / Number(scale)).toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' ' + units[unit];
}

export function ArchivePreview({ name, entries, onDismiss }: {
  name: string; entries: ArchiveEntry[]; onDismiss: () => void;
}) {
  const root = useMemo(() => archiveTree(entries), [entries]);
  return <>
    <header className="archive-toolbar">
      <strong title={name}>{name}</strong>
      <button type="button" onClick={onDismiss}>{t('menu.close')}</button>
    </header>
    <div className="archive-scroll" tabIndex={0} role="region" aria-label={t('preview.archiveContents')}>
      {entries.length ? <ArchiveList folder={root} /> : <p>{t('preview.archiveEmpty')}</p>}
    </div>
  </>;
}

function ArchiveList({ folder }: { folder: Folder }) {
  return <ul>{Array.from(folder.children, ([key, node]) => {
    const label = <bdi className="archive-name" title={node.name}>{node.name || '/'}</bdi>;
    if ('size' in node) {
      return <li key={key} className="archive-file">
        <span className="archive-icon" aria-hidden="true" />
        {label}
        <span className="archive-size" title={node.size + ' B'}>{formatSize(node.size)}</span>
      </li>;
    }
    return <li key={key}>
      <details>
        <summary><span className="archive-icon" aria-hidden="true" />{label}</summary>
        {node.children.size ? <ArchiveList folder={node} /> : <p>{t('preview.archiveEmpty')}</p>}
      </details>
    </li>;
  })}</ul>;
}
