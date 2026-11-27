import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { t } from './i18n';
import { openPdf, PDF_ANNOTATION_MODE } from './pdfDocument';
import './pdfPreview.css';

type PdfState = { document: PDFDocumentProxy; aspectRatio: number } | 'unavailable' | undefined;
const ZOOM_LEVELS = [50, 75, 100, 125, 150, 200, 250, 300];

export function PdfPreview({ name, bytes, onDismiss, loading, unavailable }: {
  name: string; bytes: Uint8Array<ArrayBuffer>; onDismiss: () => void;
  loading: ReactNode; unavailable: ReactNode;
}) {
  const [state, setState] = useState<PdfState>();
  const markUnavailable = useCallback(() => setState('unavailable'), []);
  const failed = state === 'unavailable';
  useEffect(() => {
    if (failed) return;
    let cancelled = false;
    let destroy: (() => void) | undefined;
    const deadline = setTimeout(markUnavailable, 20_000);
    // Defer transfer until the effect is still current after React finishes mounting.
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      const task = openPdf(bytes);
      destroy = () => { void task.destroy().catch(() => {}); };
      const document = await task.promise;
      if (document.numPages < 1 || document.numPages > 300) throw new Error('Unsupported PDF page count');
      const firstPage = await document.getPage(1);
      const { width, height } = firstPage.getViewport({ scale: 1 });
      if (!Number.isFinite(width / height) || width <= 0 || height <= 0) throw new Error('Invalid PDF page dimensions');
      if (!cancelled) setState({ document, aspectRatio: width / height });
    }).catch(() => { if (!cancelled) markUnavailable(); }).finally(() => clearTimeout(deadline));
    return () => { cancelled = true; clearTimeout(deadline); destroy?.(); };
  }, [bytes, failed, markUnavailable]);

  if (state && state !== 'unavailable') {
    return <PdfPages {...state} name={name} onDismiss={onDismiss} onError={markUnavailable} />;
  }
  return <>
    <header className="pdf-toolbar">
      <strong title={name}>{name}</strong>
      <button type="button" onClick={onDismiss}>{t('menu.close')}</button>
    </header>
    {failed ? unavailable : loading}
  </>;
}

function PdfPages({ document, aspectRatio, name, onDismiss, onError }: {
  document: PDFDocumentProxy; aspectRatio: number; name: string; onDismiss: () => void; onError: () => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const pages = useRef<(HTMLDivElement | null)[]>([]);
  const zoomAnchor = useRef<{ page: number; fraction: number }>();
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState<string>();
  const [zoomIndex, setZoomIndex] = useState(ZOOM_LEVELS.indexOf(100));
  const [fitWidth, setFitWidth] = useState(0);
  const [visiblePages, setVisiblePages] = useState<ReadonlySet<number>>(() => new Set());
  const zoom = ZOOM_LEVELS[zoomIndex];
  const count = document.numPages;
  const width = Math.round(fitWidth * zoom / 100);
  const hasPageSlots = width > 0;

  useLayoutEffect(() => {
    if (!hasPageSlots) return;
    const root = viewport.current!;
    const observer = new IntersectionObserver(entries => {
      setVisiblePages(previous => {
        const visible = new Set(previous);
        for (const entry of entries) {
          const number = Number((entry.target as HTMLElement).dataset.page);
          if (entry.isIntersecting) visible.add(number);
          else visible.delete(number);
        }
        return visible;
      });
    }, { root });
    root.querySelectorAll('[data-page]').forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, [count, hasPageSlots]);

  useLayoutEffect(() => {
    const element = viewport.current!;
    const measure = () => setFitWidth(Math.min(840, element.clientWidth - 32));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const anchor = zoomAnchor.current;
    if (!anchor) return;
    zoomAnchor.current = undefined;
    const slot = pages.current[anchor.page - 1];
    if (slot && viewport.current) {
      viewport.current.scrollTop = slot.offsetTop + anchor.fraction * slot.offsetHeight;
    }
  }, [zoom]);

  function goTo(number: number) {
    setDraft(undefined);
    if (!Number.isInteger(number) || number < 1 || number > count) return;
    const slot = pages.current[number - 1];
    if (slot && viewport.current) viewport.current.scrollTop = slot.offsetTop;
    setPage(number);
  }

  function onScroll() {
    const top = viewport.current!.scrollTop;
    // Find the page at the leading edge without measuring every slot during scrolling.
    let first = 0, last = count - 1;
    while (first < last) {
      const middle = Math.ceil((first + last) / 2);
      if (pages.current[middle]!.offsetTop <= top + 1) first = middle;
      else last = middle - 1;
    }
    setPage(first + 1);
  }

  function changeZoom(step: number) {
    const slot = pages.current[page - 1];
    if (slot && viewport.current) {
      zoomAnchor.current = { page, fraction: (viewport.current.scrollTop - slot.offsetTop) / slot.offsetHeight };
    }
    setZoomIndex(zoomIndex + step);
  }

  return <>
    <header className="pdf-toolbar">
      <strong title={name}>{name}</strong>
      <form className="pdf-controls" onSubmit={event => {
        event.preventDefault(); goTo(Number(draft ?? page));
      }}>
        <button type="button" aria-label={t('preview.previousPage')} disabled={page === 1}
          onClick={() => goTo(page - 1)}>‹</button>
        <input type="text" inputMode="numeric" aria-label={t('preview.pageNumber')} value={draft ?? page}
          onChange={event => setDraft(event.target.value)} onBlur={() => { if (draft !== undefined) goTo(Number(draft)); }} />
        <span>{t('preview.pageCount', { total: count })}</span>
        <button type="button" aria-label={t('preview.nextPage')} disabled={page === count}
          onClick={() => goTo(page + 1)}>›</button>
      </form>
      <div className="pdf-controls">
        <button type="button" aria-label={t('preview.zoomOut')} disabled={zoomIndex === 0}
          onClick={() => changeZoom(-1)}>−</button>
        <output>{zoom}%</output>
        <button type="button" aria-label={t('preview.zoomIn')} disabled={zoomIndex === ZOOM_LEVELS.length - 1}
          onClick={() => changeZoom(1)}>+</button>
      </div>
      <button type="button" onClick={onDismiss}>{t('menu.close')}</button>
    </header>
    <div className="pdf-scroll" ref={viewport} onScroll={onScroll} tabIndex={0}>
      {hasPageSlots && Array.from({ length: count }, (_, index) => {
        const number = index + 1;
        return <PdfPage key={number} document={document} number={number} width={width} aspectRatio={aspectRatio}
          slotRef={element => { pages.current[index] = element; }} active={visiblePages.has(number)} onError={onError} />;
      })}
    </div>
  </>;
}

function PdfPage({ document, number, width, aspectRatio, slotRef, active, onError }: {
  document: PDFDocumentProxy; number: number; width: number; aspectRatio: number;
  slotRef: (element: HTMLDivElement | null) => void; active: boolean; onError: () => void;
}) {
  const [ratio, setRatio] = useState(aspectRatio);
  return <div ref={slotRef} className="pdf-page-slot">
    <div className="pdf-page" data-page={number} style={{ width, aspectRatio: ratio }}>
      {active && <PdfCanvas key={width} document={document} number={number} width={width}
        onRatio={setRatio} onError={onError} />}
    </div>
  </div>;
}

function PdfCanvas({ document, number, width, onRatio, onError }: {
  document: PDFDocumentProxy; number: number; width: number;
  onRatio: (ratio: number) => void; onError: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    let cancelled = false;
    let task: RenderTask | undefined;
    let cleanupPage: (() => unknown) | undefined;
    const deadline = setTimeout(onError, 15_000);
    void document.getPage(number).then(page => {
      if (cancelled) return;
      cleanupPage = () => page.cleanup();
      const base = page.getViewport({ scale: 1 });
      const view = page.getViewport({ scale: width / base.width });
      if (!Number.isFinite(view.height) || view.height < 1 || view.height > 16000) {
        throw new Error('Unsupported PDF page dimensions');
      }
      onRatio(base.width / base.height);
      // Bound the backing bitmap separately from CSS zoom and embedded-image decoding.
      const scale = Math.min(window.devicePixelRatio, 2, 4096 / view.width, 4096 / view.height,
        Math.sqrt(6_000_000 / (view.width * view.height)));
      canvas.width = Math.ceil(view.width * scale);
      canvas.height = Math.ceil(view.height * scale);
      task = page.render({ canvas, viewport: view, transform: [scale, 0, 0, scale, 0, 0],
        background: '#fff', annotationMode: PDF_ANNOTATION_MODE });
      return task.promise.then(() => { if (!cancelled) canvas.dataset.rendered = 'true'; });
    }).catch(() => { if (!cancelled) onError(); }).finally(() => clearTimeout(deadline));
    return () => {
      cancelled = true;
      clearTimeout(deadline);
      task?.cancel();
      cleanupPage?.();
      canvas.width = canvas.height = 0;
    };
  // Each canvas is keyed by its width and mounted for one page and one document.
  }, [document, number, width, onRatio, onError]);
  return <canvas ref={ref} aria-label={t('preview.pageLabel', { page: number })} />;
}
