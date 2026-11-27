export type JsonValue =
  | { kind: 'object'; entries: { key: string; value: JsonValue }[] }
  | { kind: 'array'; items: JsonValue[] }
  | { kind: 'string' | 'number' | 'boolean' | 'null'; token: string };

type Collection = Extract<JsonValue, { kind: 'object' | 'array' }>;

// Keep source lexemes and ordered entries. An explicit stack handles deep documents
// without depending on the JavaScript call stack.
export function parsePreviewJson(text: string): JsonValue | undefined {
  const whitespace = /[ \t\r\n]*/y;
  const string = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y;
  const number = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  const literal = /true|false|null/y;
  const stack: { value: Collection; end: '}' | ']'; needsSeparator: boolean }[] = [];
  let offset = 0;

  function scan(pattern: RegExp) {
    pattern.lastIndex = offset;
    const match = pattern.exec(text);
    if (match) offset = pattern.lastIndex;
    return match?.[0];
  }

  function take(token: string) {
    scan(whitespace);
    if (text[offset] !== token) return false;
    offset++;
    return true;
  }

  function readValue(): JsonValue | undefined {
    scan(whitespace);
    const start = text[offset];
    if (start === '{' || start === '[') {
      offset++;
      const value: Collection = start === '{' ? { kind: 'object', entries: [] } : { kind: 'array', items: [] };
      const end = start === '{' ? '}' : ']';
      if (!take(end)) stack.push({ value, end, needsSeparator: false });
      return value;
    }

    if (start === '"') {
      const token = scan(string);
      return token === undefined ? undefined : { kind: 'string', token };
    }
    const token = scan(number);
    if (token !== undefined) return { kind: 'number', token };
    const keyword = scan(literal);
    return keyword === undefined ? undefined : { kind: keyword === 'null' ? 'null' : 'boolean', token: keyword };
  }

  const root = readValue();
  if (!root) return undefined;
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.needsSeparator) {
      if (take(frame.end)) {
        stack.pop();
        continue;
      }
      if (!take(',')) return undefined;
    }
    const collection = frame.value;
    if (collection.kind === 'object') {
      scan(whitespace);
      const key = scan(string);
      if (key === undefined || !take(':')) return undefined;
      const value = readValue();
      if (!value) return undefined;
      collection.entries.push({ key, value });
    } else {
      const value = readValue();
      if (!value) return undefined;
      collection.items.push(value);
    }
    frame.needsSeparator = true;
  }

  scan(whitespace);
  return offset === text.length ? root : undefined;
}
