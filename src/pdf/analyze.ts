import { PDFDocument } from 'pdf-lib';
import { openPdfjs, type PDFDocumentProxy } from './pdfjs';
import { interpretPage } from './interpreter';
import type { ExistingWidget, PageAnalysis, SourceDoc, TextItemLite } from '../types';
import { uid } from '../util/geom';

export class PdfLoadError extends Error {}

export async function analyzeDocument(bytes: Uint8Array, name: string): Promise<{ doc: SourceDoc; proxy: PDFDocumentProxy }> {
  if (!isPdf(bytes)) throw new PdfLoadError(`„${name}“ ist keine PDF-Datei.`);
  let lib: PDFDocument;
  try {
    lib = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  } catch {
    throw new PdfLoadError(`„${name}“ konnte nicht gelesen werden. Ist die Datei beschädigt?`);
  }
  if (lib.isEncrypted) throw new PdfLoadError(`„${name}“ ist verschlüsselt. Exportiere die PDF ohne Passwortschutz.`);
  let proxy: PDFDocumentProxy;
  try { proxy = await openPdfjs(bytes); } catch {
    throw new PdfLoadError(`„${name}“ konnte nicht dargestellt werden.`);
  }

  const pages: PageAnalysis[] = [];
  const count = Math.min(lib.getPageCount(), proxy.numPages);
  for (let i = 0; i < count; i++) {
    const pp = await proxy.getPage(i + 1);
    let interp;
    try { interp = interpretPage(lib.getPage(i)); } catch (e) {
      console.warn('Seite', i + 1, 'konnte nicht analysiert werden', e);
      interp = { textOps: [], paths: [], ocBoxes: {}, snap: { xs: [], ys: [] } };
    }
    const tc = await pp.getTextContent();
    const texts: TextItemLite[] = [];
    for (const it of tc.items as { str?: string; transform?: number[]; width?: number; height?: number }[]) {
      if (!it.str || !it.transform) continue;
      const t = it.transform;
      if (Math.abs(t[1]) > 0.01 || Math.abs(t[2]) > 0.01 || t[0] <= 0) continue; // nur waagerechter Text
      texts.push({ str: it.str, x: t[4], y: t[5], w: it.width ?? 0, h: it.height || Math.hypot(t[2], t[3]) });
    }
    const widgets: ExistingWidget[] = [];
    try {
      const annots = (await pp.getAnnotations()) as Record<string, unknown>[];
      for (const an of annots) {
        if (an.subtype !== 'Widget' || !an.fieldName) continue;
        const ft = an.fieldType as string;
        let kind: ExistingWidget['kind'] = 'other';
        if (ft === 'Tx') kind = an.multiLine ? 'area' : 'text';
        else if (ft === 'Btn') kind = an.checkBox ? 'check' : an.radioButton ? 'radio' : 'button';
        const r = an.rect as number[];
        widgets.push({
          name: String(an.fieldName), kind,
          rect: [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])],
          value: an.buttonValue != null ? String(an.buttonValue) : undefined,
          required: !!((an.fieldFlags as number) & 2),
        });
      }
    } catch { /* ignorieren */ }
    pages.push({
      view: pp.view as [number, number, number, number],
      baseRotate: pp.rotate || 0,
      ...interp,
      texts,
      widgets,
    });
  }
  return { doc: { id: uid('doc'), name, bytes, pages }, proxy };
}

export function isPdf(bytes: Uint8Array): boolean {
  const head = String.fromCharCode(...bytes.subarray(0, Math.min(1024, bytes.length)));
  return head.includes('%PDF-');
}
