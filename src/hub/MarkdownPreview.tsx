import { Fragment, useMemo, type ReactNode } from 'react';
import { Marked, type MarkedToken, type Token, type Tokens } from 'marked';
import { t } from './i18n';
import { previewFormat } from './previewCatalog';
import { syntaxSpans } from './textPreviewSyntax';

const markdown = new Marked({ gfm: true });
const headings = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;
const fenceAliases: Readonly<Record<string, string>> = {
  javascript: 'js', typescript: 'ts', python: 'py', rust: 'rs',
  'c++': 'cpp', 'c#': 'cs', bash: 'sh', shell: 'sh', powershell: 'ps1',
};

// The native text limit governs acquisition. Bound the optional parser and DOM work separately.
const MAX_SOURCE_CHARS = 256 * 1024;
const MAX_RENDER_ITEMS = 20_000;
const MAX_DEPTH = 64;

function renderDocument(source: string): ReactNode {
  if (source.length > MAX_SOURCE_CHARS) return null;

  let remaining = MAX_RENDER_ITEMS;
  const spend = (count = 1) => {
    remaining -= count;
    if (remaining < 0) throw new RangeError('Markdown render limit');
  };

  function renderCode(token: Tokens.Code) {
    const language = token.lang?.trim().split(/\s+/, 1)[0].toLowerCase();
    const extension = language && (Object.hasOwn(fenceAliases, language) ? fenceAliases[language] : language);
    const syntax = extension && /^[a-z0-9]+$/.test(extension) ? previewFormat('fence.' + extension)?.syntax : undefined;
    const spans = syntaxSpans(token.text, syntax);
    if (!spans.length) return token.text;
    spend(spans.length);
    let cursor = 0;
    return <>
      {spans.map(({ from, to, kind }) => {
        const prefix = token.text.slice(cursor, from);
        cursor = to;
        return <Fragment key={from}>
          {prefix}<span className={'preview-token-' + kind}>{token.text.slice(from, to)}</span>
        </Fragment>;
      })}
      {token.text.slice(cursor)}
    </>;
  }

  function renderTokens(tokens: Token[], depth: number): ReactNode {
    if (depth > MAX_DEPTH) throw new RangeError('Markdown nesting limit');
    spend(tokens.length);
    return tokens.map((token, index) =>
      <Fragment key={index}>{renderToken(token as MarkedToken, depth)}</Fragment>);
  }

  function renderToken(token: MarkedToken, depth: number): ReactNode {
    const children = (tokens: Token[]) => renderTokens(tokens, depth + 1);
    const cells = (row: Tokens.TableCell[]) => {
      spend(row.length);
      return row.map(({ header, align, tokens }, index) => {
        const Cell = header ? 'th' : 'td';
        return <Cell key={index} scope={header ? 'col' : undefined}
          style={{ textAlign: align ?? undefined }}>{children(tokens)}</Cell>;
      });
    };

    switch (token.type) {
      case 'heading': {
        const Heading = headings[token.depth - 1];
        return <Heading>{children(token.tokens)}</Heading>;
      }
      case 'paragraph': return <p>{children(token.tokens)}</p>;
      case 'strong': return <strong>{children(token.tokens)}</strong>;
      case 'em': return <em>{children(token.tokens)}</em>;
      case 'del': return <del>{children(token.tokens)}</del>;
      case 'blockquote': return <blockquote>{children(token.tokens)}</blockquote>;
      case 'hr': return <hr />;
      case 'br': return <br />;
      case 'codespan': return <code>{token.text}</code>;
      case 'code': return <pre><code>{renderCode(token)}</code></pre>;
      case 'list': {
        const Tag = token.ordered ? 'ol' : 'ul';
        spend(token.items.length);
        return <Tag start={token.start === '' ? undefined : token.start}>
          {token.items.map((item, index) =>
            <li key={index} className={item.task ? 'preview-markdown-task' : undefined}>{children(item.tokens)}</li>)}
        </Tag>;
      }
      case 'checkbox': return <input type="checkbox" disabled checked={token.checked} />;
      case 'table':
        spend(token.rows.length);
        return <div className="preview-markdown-table" tabIndex={0}>
          <table>
            <thead><tr>{cells(token.header)}</tr></thead>
            <tbody>{token.rows.map((row, index) => <tr key={index}>{cells(row)}</tr>)}</tbody>
          </table>
        </div>;
      case 'text': return token.tokens ? children(token.tokens) : token.text;
      case 'escape': return token.text;
      case 'link': return <span>{children(token.tokens)}</span>;
      case 'image': return <span>{token.raw}</span>;
      case 'html': {
        const Tag = token.block ? 'div' : 'span';
        return <Tag className="preview-markdown-embedded">{token.raw}</Tag>;
      }
      case 'space':
      case 'def': return null;
      default: return (token as Token).raw;
    }
  }

  try {
    // Work on a presentation copy. All token values reach the DOM as text or fixed element props.
    return renderTokens(markdown.lexer(source.replace(/^\uFEFF/, '')), 0);
  } catch {
    return null;
  }
}

export function MarkdownPreview({ text }: { text: string }) {
  const content = useMemo(() => renderDocument(text), [text]);
  return <section className="preview-markdown" aria-label={t('preview.markdownView')} tabIndex={0}>
    <article>{content ?? <p role="status">{t('preview.markdownUnavailable')}</p>}</article>
  </section>;
}
