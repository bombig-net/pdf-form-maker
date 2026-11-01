import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';

export type { PDFDocumentProxy };
export { pdfjs };

let ready: Promise<void> | null = null;

/** Sets up the pdf.js worker. In the single-file build (preview) pdf.js runs without a separate worker. */
export function initPdfjs(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    if (typeof window === 'undefined') return; // Node/tests: pdf.js uses its fake worker automatically
    if (import.meta.env.MODE === 'single') {
      const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
      (globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = worker;
    } else {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).href;
    }
  })();
  return ready;
}

export async function openPdfjs(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  await initPdfjs();
  return pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise as Promise<PDFDocumentProxy>;
}
