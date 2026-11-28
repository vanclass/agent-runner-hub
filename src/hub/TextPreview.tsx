import { useState } from 'react';
import { t } from './i18n';
import { RawTextPreview } from './RawTextPreview';
import { JsonPreview, JsonlPreview } from './StructuredTextPreview';
import { MarkdownPreview } from './MarkdownPreview';
import { DelimitedTextPreview } from './DelimitedTextPreview';
import { DiffPreview } from './DiffPreview';
import type { StructuredTextMode } from './previewCatalog';
import './textPreview.css';

const structuredViews = {
  changes: { label: 'preview.changesView', View: DiffPreview },
  json: { label: 'preview.jsonView', View: JsonPreview },
  records: { label: 'preview.recordView', View: JsonlPreview },
  markdown: { label: 'preview.markdownView', View: MarkdownPreview },
  csv: { label: 'preview.tableView', View: ({ text }: { text: string }) =>
    <DelimitedTextPreview text={text} delimiter="," /> },
  tsv: { label: 'preview.tableView', View: ({ text }: { text: string }) =>
    <DelimitedTextPreview text={text} delimiter={'\t'} /> },
} as const;

export function TextPreview({ name, text, syntax, structuredMode, onDismiss }: {
  name: string; text: string; syntax?: string; structuredMode?: StructuredTextMode; onDismiss: () => void;
}) {
  const [mode, setMode] = useState<'raw' | 'structured'>();
  const [copyState, setCopyState] = useState<'copied' | 'copyFailed'>();
  const structured = mode === 'structured';
  const view = structuredMode && structuredViews[structuredMode];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
    } catch {
      setCopyState('copyFailed');
    }
  };

  return <>
    <RawTextPreview text={text} syntax={syntax} visible={!structured} renderHeader={rawControls => <>
      <header className="preview-text-toolbar">
        <strong title={name}>{name}</strong>
        <div className="preview-text-controls">
          {view && <div className="preview-text-modes" role="group" aria-label={t('preview.viewMode')}>
            <button type="button" aria-pressed={!structured} onClick={() => { if (structured) setMode('raw'); }}>
              {t('preview.rawView')}
            </button>
            <button type="button" aria-pressed={structured} onClick={() => setMode('structured')}>
              {t(view.label)}
            </button>
          </div>}
          {rawControls}
          <button type="button" onClick={() => void copy()}>{t('preview.copy')}</button>
          <button type="button" aria-label={t('menu.close')} title={t('menu.close')} onClick={onDismiss}>×</button>
        </div>
      </header>
      {copyState && <span className="preview-copy-status" role="status">{copyState === 'copied'
        ? t('preview.copied') : t('preview.copyFailed')}</span>}
    </>} />
    {mode && view && <div hidden={!structured}>
      <view.View text={text} />
    </div>}
  </>;
}
