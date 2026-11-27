import { useEffect, useRef, useState } from 'react';

export function ImageViewport({ url, name }: { url: string; name: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const drag = useRef<{ id: number; x: number; y: number }>();
  useEffect(() => {
    const element = host.current!;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      // 휠 확대 속도다. 늘리면 더 빠르게 확대되고, 줄이면 더 세밀하게 조절된다.
      const sensitivity = 0.0015;
      setView(current => ({ ...current, scale: Math.max(0.25, Math.min(8, current.scale * Math.exp(-event.deltaY * sensitivity))) }));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  return <div ref={host} className="focused-image-viewport" data-scale={view.scale} data-x={view.x} data-y={view.y}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    }} onPointerMove={event => {
      const previous = drag.current;
      if (!previous || previous.id !== event.pointerId) return;
      const dx = event.clientX - previous.x, dy = event.clientY - previous.y;
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      setView(current => ({ ...current, x: current.x + dx, y: current.y + dy }));
    }} onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }}
    onLostPointerCapture={() => { drag.current = undefined; }}>
    <img src={url} alt={name} draggable={false}
      style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} />
  </div>;
}

