import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';

export type { PDFDocumentProxy };
export { pdfjs };

let ready: Promise<void> | null = null;

/** Richtet den pdf.js-Worker ein. Im Einzeldatei-Build (Vorschau) läuft pdf.js ohne separaten Worker. */
export function initPdfjs(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    if (typeof window === 'undefined') return; // Node/Tests: pdf.js nutzt automatisch den Fake-Worker
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
