import { AnnotationMode, getDocument, PDFWorker } from 'pdfjs-dist/legacy/build/pdf.mjs';

export const PDF_ANNOTATION_MODE = AnnotationMode.DISABLE;

export function openPdf(bytes: Uint8Array<ArrayBuffer>) {
  const assetRoot = new URL('./pdfjs/', document.baseURI);
  const workerUrl = new URL('legacy/build/pdf.worker.min.mjs', assetRoot);
  if (workerUrl.protocol !== location.protocol || workerUrl.host !== location.host) {
    throw new Error('PDF worker must use the application origin');
  }
  const port = new Worker(workerUrl, { type: 'module' });
  let worker: PDFWorker | undefined;
  try {
    worker = PDFWorker.create({ port });
    // Byte-only rendering. No document URLs, scripting manager, action handlers or interactive layers.
    const task = getDocument({
      data: bytes,
      worker,
      cMapUrl: new URL('cmaps/', assetRoot).href,
      cMapPacked: true,
      standardFontDataUrl: new URL('standard_fonts/', assetRoot).href,
      iccUrl: new URL('iccs/', assetRoot).href,
      wasmUrl: new URL('wasm/', assetRoot).href,
      useWorkerFetch: true,
      useSystemFonts: false,
      isEvalSupported: false,
      enableXfa: false,
      stopAtErrors: true,
      maxImageSize: 16_000_000,
      canvasMaxAreaInBytes: 32 * 1024 * 1024,
    });
    const workerFailed = new Promise<never>((_, reject) => {
      port.addEventListener('error', () => reject(new Error('PDF worker failed')), { once: true });
    });
    return {
      promise: Promise.race([task.promise, workerFailed]),
      async destroy() {
        // Give the document transport time to release its resources. A failed or hung worker cannot retain the port.
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([task.destroy(), new Promise<void>(resolve => { timeout = setTimeout(resolve, 1000); })]);
        } finally {
          clearTimeout(timeout);
          worker?.destroy();
          port.terminate();
        }
      },
    };
  } catch (error) {
    worker?.destroy();
    port.terminate();
    throw error;
  }
}
