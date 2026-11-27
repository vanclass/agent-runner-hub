import { useMemo, useState } from 'react';
import { t } from './i18n';

type Delimiter = ',' | '\t';

function parseTable(source: string, delimiter: Delimiter) {
  const rows: string[][] = [];
  let columnCount = 0;
  let offset = source.startsWith('\uFEFF') ? 1 : 0;
  let row: string[] = [];

  while (offset < source.length) {
    let value: string;
    if (source[offset] === '"') {
      const start = ++offset;
      let close = source.indexOf('"', offset);
      while (close !== -1 && source[close + 1] === '"') {
        close = source.indexOf('"', close + 2);
      }
      if (close === -1) return null;
      value = source.slice(start, close).replaceAll('""', '"');
      offset = close + 1;
    } else {
      const start = offset;
      while (offset < source.length && source[offset] !== delimiter
        && source[offset] !== '\r' && source[offset] !== '\n') {
        if (source[offset] === '"') return null;
        offset++;
      }
      value = source.slice(start, offset);
    }

    row.push(value);
    const separator = source[offset++];
    if (separator === delimiter) {
      if (offset < source.length) continue;
      row.push('');
    } else if (separator === '\r') {
      if (source[offset] === '\n') offset++;
    } else if (separator !== '\n' && separator !== undefined) {
      return null;
    }
    columnCount = Math.max(columnCount, row.length);
    rows.push(row);
    row = [];
  }
  return { rows, columnCount };
}

function columnLabel(index: number) {
  let label = '';
  for (let column = index + 1; column > 0; column = Math.floor((column - 1) / 26)) {
    label = String.fromCharCode(65 + (column - 1) % 26) + label;
  }
  return label;
}

// Bound mounted cells even for very wide or heavily ragged files.
const rowsPerPage = 100;
const columnsPerPage = 24;

export function DelimitedTextPreview({ text, delimiter }: { text: string; delimiter: Delimiter }) {
  const table = useMemo(() => parseTable(text, delimiter), [text, delimiter]);
  const [rowStart, setRowStart] = useState(0);
  const [columnStart, setColumnStart] = useState(0);
  const label = t('preview.tableView');
  if (!table || !table.rows.length) {
    return <div className="preview-table-scroll preview-table-message" role="status">
      {t(table ? 'preview.tableEmpty' : 'preview.tableInvalid')}
    </div>;
  }

  const { rows, columnCount } = table;
  const rowEnd = Math.min(rowStart + rowsPerPage, rows.length);
  const columnEnd = Math.min(columnStart + columnsPerPage, columnCount);
  const columns = Array.from({ length: columnEnd - columnStart }, (_, index) => columnStart + index);

  return <div className="preview-table-pane">
    {(rows.length > rowsPerPage || columnCount > columnsPerPage) &&
      <div className="preview-table-pages">
        {rows.length > rowsPerPage && <div role="group" aria-label={t('preview.tableRowRange', {
          start: rowStart + 1, end: rowEnd, total: rows.length,
        })}>
          <button type="button" disabled={rowStart === 0} onClick={() => setRowStart(rowStart - rowsPerPage)}>
            {t('preview.tablePreviousRows')}
          </button>
          <span>{t('preview.tableRowRange', { start: rowStart + 1, end: rowEnd, total: rows.length })}</span>
          <button type="button" disabled={rowEnd === rows.length} onClick={() => setRowStart(rowEnd)}>
            {t('preview.tableNextRows')}
          </button>
        </div>}
        {columnCount > columnsPerPage && <div role="group" aria-label={t('preview.tableColumnRange', {
          start: columnLabel(columnStart), end: columnLabel(columnEnd - 1), total: columnCount,
        })}>
          <button type="button" disabled={columnStart === 0}
            onClick={() => setColumnStart(columnStart - columnsPerPage)}>
            {t('preview.tablePreviousColumns')}
          </button>
          <span>{t('preview.tableColumnRange', {
            start: columnLabel(columnStart), end: columnLabel(columnEnd - 1), total: columnCount,
          })}</span>
          <button type="button" disabled={columnEnd === columnCount} onClick={() => setColumnStart(columnEnd)}>
            {t('preview.tableNextColumns')}
          </button>
        </div>}
      </div>}
    <div key={rowStart + ':' + columnStart} className="preview-table-scroll"
      role="region" aria-label={label} tabIndex={0}>
      <table aria-label={label}>
        <thead><tr><th scope="col">#</th>
          {columns.map(column => <th scope="col" key={column}>{columnLabel(column)}</th>)}
        </tr></thead>
        <tbody>{rows.slice(rowStart, rowEnd).map((row, index) => <tr key={rowStart + index}>
          <th scope="row">{rowStart + index + 1}</th>
          {columns.map(column => <td key={column}>{row[column]}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
