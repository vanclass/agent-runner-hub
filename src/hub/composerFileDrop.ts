import { getCurrentWindow } from '@tauri-apps/api/window';

export function watchFileDrop(onDrop: (paths: string[], position: { x: number; y: number }) => void,
  onHover?: (position?: { x: number; y: number }) => void) {
  return getCurrentWindow().onDragDropEvent(event => {
    if (event.payload.type === 'drop') onDrop(event.payload.paths, event.payload.position);
    onHover?.(event.payload.type === 'enter' || event.payload.type === 'over' ? event.payload.position : undefined);
  });
}
