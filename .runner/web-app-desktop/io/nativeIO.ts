import { readImage } from '@tauri-apps/plugin-clipboard-manager';
import { open, type DialogFilter } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';

export async function clipboardImagePng(): Promise<Blob> {
  const image = await readImage();
  try {
    const { width, height } = await image.size();
    const rgba = new Uint8ClampedArray(await image.rgba());
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas image encoding is unavailable');
    context.putImageData(new ImageData(rgba, width, height), 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => {
      if (blob) resolve(blob); else reject(new Error('Clipboard PNG encoding failed'));
    }, 'image/png'));
  } finally { await image.close(); }
}

export function selectFiles(multiple = false, filters?: DialogFilter[]) {
  return open({ directory: false, multiple, filters });
}
export function selectFolder() { return open({ directory: true, multiple: false }); }

export function watchFileDrop(onDrop: (paths: string[], position: { x: number; y: number }) => void,
  onHover?: (position?: { x: number; y: number }) => void) {
  return getCurrentWindow().onDragDropEvent(event => {
    if (event.payload.type === 'drop') onDrop(event.payload.paths, event.payload.position);
    onHover?.(event.payload.type === 'enter' || event.payload.type === 'over' ? event.payload.position : undefined);
  });
}
