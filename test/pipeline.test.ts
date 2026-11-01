import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFName } from 'pdf-lib';
import { analyzeDocument } from '../src/pdf/analyze';
import { detectPageFields, crossPageDuplicates, parseTag, mapFont } from '../src/pdf/detect';
import { exportPdf } from '../src/pdf/export';
import { openPdfjs } from '../src/pdf/pdfjs';
import { toPdf, toScreen } from '../src/util/geom';
import { effectiveColor } from '../src/util/color';
import type { PageRef } from '../src/types';

const load = (n: string) => new Uint8Array(readFileSync(`src/assets/${n}`));

async function prepare(name: string) {
  const { doc } = await analyzeDocument(load(name), name);
  const pages: PageRef[] = doc.pages.map((_, i) => ({ id: `p${i}`, docId: doc.id, srcIndex: i, rotation: 0 }));
  const fields = doc.pages.flatMap((a, i) => detectPageFields(a, `p${i}`));
  return { doc, pages, fields };
}

describe('Namenskonvention', () => {
  it('erkennt Tags', () => {
    expect(parseTag('[Form_Text_Vorname]')).toMatchObject({ type: 'text', name: 'Vorname' });
    expect(parseTag('Form_Area_Notiz')).toMatchObject({ type: 'area', name: 'Notiz' });
    expect(parseTag('[Form_Radio_Anrede_Herr]')).toMatchObject({ type: 'radio', name: 'Anrede', radioValue: 'Herr' });
    expect(parseTag('[Form_Check_AGB]')).toMatchObject({ type: 'check', name: 'AGB' });
    expect(parseTag('Ebene 1')).toBeNull();
  });
  it('ordnet Schriften zu', () => {
    expect(mapFont('ABCDEF+Inter-SemiBold')).toEqual({ family: 'Helvetica', bold: true, italic: false });
    expect(mapFont('Garamond-Italic')).toEqual({ family: 'Times', bold: false, italic: true });
    expect(mapFont('JetBrainsMono-Regular').family).toBe('Courier');
    expect(mapFont('SourceSerif4-Regular').family).toBe('Times');
    expect(mapFont('SourceSans3-Regular').family).toBe('Helvetica');
  });
});

describe('Ebenen-Beispiel', () => {
  it('erkennt alle Felder mit Schrift, Platzhalter und Kontrast', async () => {
    const { fields } = await prepare('beispiel-ebenen.pdf');
    const byName = (n: string) => fields.filter((f) => f.name === n);
    expect(byName('Vorname')).toHaveLength(2);
    expect(byName('Anrede')).toHaveLength(3);
    expect(byName('Anrede').map((f) => f.radioValue).sort()).toEqual(['Divers', 'Frau', 'Herr']);
    const vor = byName('Vorname').find((f) => f.pageId === 'p0')!;
    expect(vor.rect.x).toBeCloseTo(56, 1);
    expect(vor.rect.w).toBeCloseTo(230, 1);
    expect(vor.placeholder).toBe('Hier Vorname eintragen');
    expect(vor.hideText).toBe(true);
    expect(vor.fontSize).toBe(11);
    expect(vor.tooltip).toBe('Vorname');
    const msg = byName('Nachricht')[0];
    expect(msg.type).toBe('area');
    expect(msg.fontFamily).toBe('Times');
    const mn = byName('Mitgliedsnummer')[0];
    expect(mn.bgColor![2]).toBeCloseTo(0.45, 2);
    expect(effectiveColor(mn)).toEqual([1, 1, 1]);
    expect(byName('AGB')[0].type).toBe('check');
    expect(crossPageDuplicates(fields)).toEqual(['Vorname']);
  });

  it('exportiert ein gültiges AcroForm', async () => {
    const { doc, pages, fields } = await prepare('beispiel-ebenen.pdf');
    const res = await exportPdf({ docs: [doc], pages, fields, customFonts: [], options: { hidePlaceholderLayers: false } });
    expect(res.warnings).toEqual([]);
    const out = await PDFDocument.load(res.bytes);
    const form = out.getForm();
    const names = form.getFields().map((f) => f.getName()).sort();
    expect(names).toEqual(['AGB', 'Anrede', 'Email', 'Mitgliedsnummer', 'Nachname', 'Nachricht', 'Projektname', 'Vorname']);
    expect(form.getField('Vorname')).toBeInstanceOf(PDFTextField);
    expect(form.getTextField('Vorname').acroField.getWidgets()).toHaveLength(2);
    expect(form.getField('AGB')).toBeInstanceOf(PDFCheckBox);
    expect(form.getRadioGroup('Anrede').getOptions().sort()).toEqual(['Divers', 'Frau', 'Herr']);
    expect(form.getField('Anrede')).toBeInstanceOf(PDFRadioGroup);
    expect(form.getTextField('Nachricht').isMultiline()).toBe(true);
    expect(form.getTextField('Vorname').getText()).toBeUndefined();
    // Tab-Reihenfolge: Vorname, Nachname, Email ...
    const annots = out.getPage(0).node.Annots()!;
    const order: string[] = [];
    for (let i = 0; i < annots.size(); i++) {
      const w = out.context.lookup(annots.get(i)) as import('pdf-lib').PDFDict;
      const parent = w.lookup(PDFName.of('Parent')) as import('pdf-lib').PDFDict | undefined;
      const t = (parent ?? w).lookup(PDFName.of('T')) as { decodeText(): string };
      order.push(t.decodeText());
    }
    expect(order.slice(0, 3)).toEqual(['Vorname', 'Nachname', 'Email']);

    // Platzhaltertext ist im Ergebnis nicht mehr sichtbar (Textrender-Modus 3)
    const pj = await openPdfjs(res.bytes);
    const pg = await pj.getPage(1);
    const ops = await pg.getOperatorList();
    expect(ops.fnArray.length).toBeGreaterThan(10);
    const ann = await pg.getAnnotations();
    expect(ann.filter((a: { subtype: string }) => a.subtype === 'Widget').length).toBe(9);
  });

  it('trennt Felder auf Wunsch per Suffix und behält beim Drehen/Umsortieren die Felder', async () => {
    const { doc, pages, fields } = await prepare('beispiel-ebenen.pdf');
    for (const f of fields) if (f.name === 'Vorname') f.name = `Vorname_S${f.pageId === 'p0' ? 1 : 2}`;
    const reordered = [pages[1], { ...pages[0], rotation: 90 }];
    const res = await exportPdf({ docs: [doc], pages: reordered, fields, customFonts: [], options: { hidePlaceholderLayers: true } });
    const out = await PDFDocument.load(res.bytes);
    expect(out.getPageCount()).toBe(2);
    expect(out.getPage(1).getRotation().angle).toBe(90);
    // Felder drehen sich mit dem Inhalt: keine zusätzliche Widget-Drehung
    const w1 = out.getForm().getTextField('Nachname').acroField.getWidgets()[0];
    expect(w1.getAppearanceCharacteristics()?.getRotation() ?? 0).toBe(0);
    const names = out.getForm().getFields().map((f) => f.getName());
    expect(names).toContain('Vorname_S1');
    expect(names).toContain('Vorname_S2');
    // Seite 1 (vorher 2) enthält Projektname
    const w = out.getForm().getTextField('Projektname').acroField.getWidgets()[0];
    expect(w.P()?.toString()).toBe(out.getPage(0).ref.toString());
  });
});

describe('Tag-Beispiel', () => {
  it('erkennt Text-Tags, blendet sie aus und übernimmt Schrift', async () => {
    const { doc, pages, fields } = await prepare('beispiel-tags.pdf');
    const names = fields.map((f) => `${f.type}:${f.name}`).sort();
    expect(names).toEqual(['area:Bemerkungen', 'check:Newsletter', 'text:Datum', 'text:Firma', 'text:Kundennummer']);
    const firma = fields.find((f) => f.name === 'Firma')!;
    expect(firma.rect.w).toBeGreaterThan(480);
    expect(firma.fontSize).toBe(12);
    expect(firma.color[2]).toBeCloseTo(0.6, 2);
    expect(fields.find((f) => f.name === 'Kundennummer')!.fontFamily).toBe('Courier');
    const nl = fields.find((f) => f.name === 'Newsletter')!;
    expect(nl.rect.w).toBeCloseTo(12, 1);
    const bem = fields.find((f) => f.name === 'Bemerkungen')!;
    expect(bem.placeholder).toBe('Optional: Wünsche zur Lieferung');

    const res = await exportPdf({ docs: [doc], pages, fields, customFonts: [], options: { hidePlaceholderLayers: false } });
    const pj = await openPdfjs(res.bytes);
    const pg = await pj.getPage(1);
    const tc = await pg.getTextContent();
    // pdf.js liefert auch unsichtbaren Text – prüfen, dass Render-Modus 3 gesetzt ist
    const ol = await pg.getOperatorList();
    const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const trModes = ol.fnArray.map((fn: number, i: number) => (fn === OPS.setTextRenderingMode ? ol.argsArray[i][0] : null)).filter((x: number | null) => x !== null);
    expect(trModes.filter((m: number) => m === 3).length).toBe(6);
    expect(tc.items.length).toBeGreaterThan(0);
  });
});

describe('Geometrie', () => {
  it('rechnet in alle Drehungen hin und zurück', () => {
    for (const rotation of [0, 90, 180, 270]) {
      const g = { view: [0, 0, 595, 842] as [number, number, number, number], rotation, scale: 1.5 };
      const s = toScreen(g, 100, 200);
      const p = toPdf(g, s[0], s[1]);
      expect(p[0]).toBeCloseTo(100); expect(p[1]).toBeCloseTo(200);
    }
  });
  it('stimmt mit dem pdf.js-Viewport überein', async () => {
    const pj = await openPdfjs(load('beispiel-tags.pdf'));
    const pg = await pj.getPage(1);
    for (const rotation of [0, 90, 180, 270]) {
      const vp = pg.getViewport({ scale: 1.3, rotation });
      const [ex, ey] = vp.convertToViewportPoint(120, 300);
      const [x, y] = toScreen({ view: pg.view as [number, number, number, number], rotation, scale: 1.3 }, 120, 300);
      expect(x).toBeCloseTo(ex, 3); expect(y).toBeCloseTo(ey, 3);
    }
  });
});

describe('Performance', () => {
  it('analysiert und exportiert 10 Seiten in unter 3 Sekunden', async () => {
    const src = await PDFDocument.load(load('beispiel-ebenen.pdf'));
    const big = await PDFDocument.create();
    for (let i = 0; i < 5; i++) for (const p of await big.copyPages(src, [0, 1])) big.addPage(p);
    const bytes = await big.save();
    const t0 = performance.now();
    const { doc } = await analyzeDocument(bytes, 'gross.pdf');
    const pages: PageRef[] = doc.pages.map((_, i) => ({ id: `p${i}`, docId: doc.id, srcIndex: i, rotation: 0 }));
    const fields = doc.pages.flatMap((a, i) => detectPageFields(a, `p${i}`));
    const res = await exportPdf({ docs: [doc], pages, fields, customFonts: [], options: { hidePlaceholderLayers: false } });
    const ms = performance.now() - t0;
    expect(doc.pages).toHaveLength(10);
    expect(res.fieldCount).toBe(55);
    expect(ms).toBeLessThan(3000);
  });
});
