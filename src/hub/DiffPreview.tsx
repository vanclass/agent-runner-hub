import { Fragment, useMemo, useState } from 'react';
import { t } from './i18n';
import { parseDiff } from './previewDiff';

// Bound mounted change rows for dense patches within the text-preview limit.
const rowsPerPage = 500;

export function DiffPreview({ text }: { text: string }) {
  const rows = useMemo(() => parseDiff(text)?.flatMap(file => file.hunks.flatMap(hunk =>
    hunk.lines.map(line => ({ file, hunk, line })))), [text]);
  const [start, setStart] = useState(0);
  if (!rows) return <div className="preview-table-scroll preview-table-message" role="status">
    {t('preview.changesInvalid')}
  </div>;

  const end = Math.min(start + rowsPerPage, rows.length);
  return <div className="preview-table-pane">
    {rows.length > rowsPerPage && <div className="preview-table-pages">
      <button type="button" disabled={!start} onClick={() => setStart(start - rowsPerPage)}>
        {t('preview.tablePreviousRows')}
      </button>
      <span>{t('preview.tableRowRange', { start: start + 1, end, total: rows.length })}</span>
      <button type="button" disabled={end === rows.length} onClick={() => setStart(end)}>
        {t('preview.tableNextRows')}
      </button>
    </div>}
    <div key={start} className="preview-table-scroll preview-diff" role="region"
      aria-label={t('preview.changesView')} tabIndex={0}>
      <table>
        <thead><tr>
          <th scope="col">{t('preview.changesOld')}</th>
          <th scope="col">{t('preview.changesNew')}</th>
          <th scope="col" colSpan={2}>{t('preview.changesView')}</th>
        </tr></thead>
        <tbody>{rows.slice(start, end).map(({ file, hunk, line }, index) => {
          const previous = index ? rows[start + index - 1] : undefined;
          return <Fragment key={start + index}>
            {file !== previous?.file && <DiffFileHeader file={file} />}
            {hunk !== previous?.hunk && <tr className="preview-diff-hunk"><td colSpan={4}>{hunk.header}</td></tr>}
            <tr className="preview-diff-line" data-change={line.marker}>
              <td>{line.old}</td><td>{line.next}</td><td>{line.marker}</td><td>{line.text}</td>
            </tr>
          </Fragment>;
        })}</tbody>
      </table>
    </div>
  </div>;
}

type FileChange = NonNullable<ReturnType<typeof parseDiff>>[number];

function DiffFileHeader({ file }: { file: FileChange }) {
  const path = file.oldPath === '/dev/null' || file.oldPath === file.newPath ? file.newPath
    : file.newPath === '/dev/null' ? file.oldPath : file.oldPath + ' → ' + file.newPath;
  return <tr className="preview-diff-file"><td colSpan={4}>
      <strong>{path}</strong>
      <span data-change="+">{t('preview.changesAdded', { count: file.additions })}</span>
      <span data-change="-">{t('preview.changesRemoved', { count: file.removals })}</span>
  </td></tr>;
}
