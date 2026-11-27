import catalog from '../../src-tauri/src/preview_formats.json';

export type PreviewCategory = 'image' | 'text' | 'pdf' | 'archive';
export type StructuredTextMode = 'json' | 'records' | 'markdown';
type PreviewFormat = {
  category: PreviewCategory;
  extensions?: readonly string[];
  filenames?: readonly string[];
  syntax?: string;
  structuredMode?: StructuredTextMode;
  mime?: string;
  previewMime?: string;
};

export const previewFormats: readonly PreviewFormat[] = catalog as PreviewFormat[];
export const attachmentName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;

const asciiLower = (name: string) => name.replace(/[A-Z]/g, char => char.toLowerCase());
const extensions = new Map<string, PreviewFormat>();
const filenames = new Map<string, PreviewFormat>();
for (const format of previewFormats) {
  for (const extension of format.extensions ?? []) extensions.set(asciiLower(extension), format);
  for (const filename of format.filenames ?? []) filenames.set(asciiLower(filename), format);
}

export function previewFormat(path: string) {
  const name = asciiLower(attachmentName(path));
  const dot = name.lastIndexOf('.');
  return filenames.get(name) ?? (dot > 0 ? extensions.get(name.slice(dot + 1)) : undefined);
}
