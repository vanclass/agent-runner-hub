type TokenKind = 'comment' | 'literal' | 'keyword' | 'tag' | 'added' | 'removed';
export type SyntaxSpan = { from: number; to: number; kind: TokenKind };
type Rules = Partial<Record<TokenKind, RegExp>>;

const strings = /"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'/;
const numbers = /\b(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/;
const literals = new RegExp(strings.source + '|' + numbers.source);
const cComments = /\/\/[^\r\n]*|\/\*[\s\S]*?(?:\*\/|(?![\s\S]))/;
const hashComment = /#[^\r\n]*/;
const control = 'if|else|for|while|return|break|continue';
const words = (extra: string) => new RegExp('\\b(?:' + control + '|' + extra + ')\\b');
const rules: Readonly<Record<string, Rules>> = {
  source: { comment: cComments, literal: literals,
    keyword: words('class|struct|enum|interface|namespace|using|public|private|protected|static|const|let|fn|impl|use|import|new|void|int|bool|string|true|false|null|match|switch|try|catch|throw') },
  javascript: { comment: cComments, literal: literals,
    keyword: words('async|await|import|from|export|const|let|var|function|class|extends|interface|type|new|throw|try|catch|switch|true|false|null|undefined') },
  python: { comment: hashComment, literal: literals,
    keyword: words('def|class|import|from|as|in|with|elif|lambda|yield|async|await|raise|try|except|finally|True|False|None|and|or|not') },
  json: { literal: /"(?:\\.|[^"\\\r\n])*"|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/, keyword: /\b(?:true|false|null)\b/ },
  sql: { comment: /--[^\r\n]*|\/\*[\s\S]*?(?:\*\/|(?![\s\S]))/, literal: literals,
    keyword: /\b(?:select|from|where|join|on|as|insert|into|values|update|set|delete|create|table|group|order|by|having|and|or|null|limit|union|with)\b/ },
  markup: { comment: /<!--[\s\S]*?(?:-->|(?![\s\S]))/, tag: /<\/?[a-z][\w:.-]*|\/?>|<!DOCTYPE\b/, literal: strings },
  config: { comment: /^[\t ]*[#;][^\r\n]*|#[^\r\n]*/, literal: literals,
    keyword: /^[\t ]*(?:\[[^\r\n\]]+\]|[\w.-]+(?=[\t ]*[:=]))|\b(?:true|false|null)\b/ },
  script: { comment: /#[^\r\n]*|^[\t ]*(?:rem\b|::)[^\r\n]*/, literal: literals,
    keyword: words('then|fi|do|done|case|esac|function|local|export|echo|set|param|foreach|try|catch|exit|call') },
  style: { comment: cComments, literal: literals,
    keyword: /[@$][\w-]+|[\w-]+(?=[\t ]*:)|#[\da-f]{3,8}\b/ },
  markdown: { tag: /^[\t ]{0,3}(?:#{1,6}[\t ]+[^\r\n]*|(?:\x60{3,}|~{3,})[^\r\n]*)/,
    literal: /\x60[^\x60\r\n]+\x60/ },
  diff: { tag: /^(?:@@|diff\b|index\b|---|\+\+\+)[^\r\n]*/, added: /^\+[^\r\n]*/, removed: /^-[^\r\n]*/ },
};

// Styling is optional. Bound lexer work and markup independently of the complete original text.
const MAX_HIGHLIGHT_CHARS = 128 * 1024;
const MAX_SPANS = 8_000;

export function syntaxSpans(text: string, syntax?: string): SyntaxSpan[] {
  const grammar = syntax && Object.hasOwn(rules, syntax) ? rules[syntax] : undefined;
  if (!grammar || text.length > MAX_HIGHLIGHT_CHARS) return [];
  const pattern = Object.entries(grammar).map(([kind, regex]) => '(?<' + kind + '>' + regex.source + ')').join('|');
  const spans: SyntaxSpan[] = [];
  for (const match of text.matchAll(new RegExp(pattern, syntax === 'sql' || syntax === 'script' || syntax === 'markup' ? 'gim' : 'gm'))) {
    if (spans.length === MAX_SPANS) return [];
    const kind = Object.keys(match.groups!).find(key => match.groups![key] !== undefined) as TokenKind;
    spans.push({ from: match.index, to: match.index + match[0].length, kind });
  }
  return spans;
}
