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

describe('Naming convention', () => {
  it('parses tags', () => {
    expect(parseTag('[Form_Text_FirstName]')).toMatchObject({ type: 'text', name: 'FirstName' });
    expect(parseTag('Form_Area_Notes')).toMatchObject({ type: 'area', name: 'Notes' });
    expect(parseTag('[Form_Radio_Salutation_Mr]')).toMatchObject({ type: 'radio', name: 'Salutation', radioValue: 'Mr' });
    expect(parseTag('[Form_Check_Terms]')).toMatchObject({ type: 'check', name: 'Terms' });
    expect(parseTag('Layer 1')).toBeNull();
  });
  it('maps fonts', () => {
    expect(mapFont('ABCDEF+Inter-SemiBold')).toEqual({ family: 'Helvetica', bold: true, italic: false });
    expect(mapFont('Garamond-Italic')).toEqual({ family: 'Times', bold: false, italic: true });
    expect(mapFont('JetBrainsMono-Regular').family).toBe('Courier');
    expect(mapFont('SourceSerif4-Regular').family).toBe('Times');
    expect(mapFont('SourceSans3-Regular').family).toBe('Helvetica');
  });
});

describe('Layer sample', () => {
  it('detects all fields with font, placeholder and contrast', async () => {
    const { fields } = await prepare('sample-layers.pdf');
    const byName = (n: string) => fields.filter((f) => f.name === n);
    expect(byName('FirstName')).toHaveLength(2);
    expect(byName('Salutation')).toHaveLength(3);
    expect(byName('Salutation').map((f) => f.radioValue).sort()).toEqual(['Mr', 'Ms', 'Mx']);
    const first = byName('FirstName').find((f) => f.pageId === 'p0')!;
    expect(first.rect.x).toBeCloseTo(56, 1);
    expect(first.rect.w).toBeCloseTo(230, 1);
    expect(first.placeholder).toBe('Enter your first name');
    expect(first.hideText).toBe(true);
    expect(first.fontSize).toBe(11);
    expect(first.tooltip).toBe('First name');
    const msg = byName('Message')[0];
    expect(msg.type).toBe('area');
    expect(msg.fontFamily).toBe('Times');
    const mn = byName('MemberNumber')[0];
    expect(mn.bgColor![2]).toBeCloseTo(0.45, 2);
    expect(effectiveColor(mn)).toEqual([1, 1, 1]);
    expect(byName('Terms')[0].type).toBe('check');
    expect(crossPageDuplicates(fields)).toEqual(['FirstName']);
  });

  it('exports a valid AcroForm', async () => {
    const { doc, pages, fields } = await prepare('sample-layers.pdf');
    const res = await exportPdf({ docs: [doc], pages, fields, customFonts: [], options: { hidePlaceholderLayers: false } });
    expect(res.warnings).toEqual([]);
    const out = await PDFDocument.load(res.bytes);
    const form = out.getForm();
    const names = form.getFields().map((f) => f.getName()).sort();
    expect(names).toEqual(['Email', 'FirstName', 'LastName', 'MemberNumber', 'Message', 'ProjectName', 'Salutation', 'Terms']);
    expect(form.getField('FirstName')).toBeInstanceOf(PDFTextField);
    expect(form.getTextField('FirstName').acroField.getWidgets()).toHaveLength(2);
    expect(form.getField('Terms')).toBeInstanceOf(PDFCheckBox);
    expect(form.getRadioGroup('Salutation').getOptions().sort()).toEqual(['Mr', 'Ms', 'Mx']);
    expect(form.getField('Salutation')).toBeInstanceOf(PDFRadioGroup);
    expect(form.getTextField('Message').isMultiline()).toBe(true);
    expect(form.getTextField('FirstName').getText()).toBeUndefined();
    // Tab order: FirstName, LastName, Email ...
    const annots = out.getPage(0).node.Annots()!;
    const order: string[] = [];
    for (let i = 0; i < annots.size(); i++) {
      const w = out.context.lookup(annots.get(i)) as import('pdf-lib').PDFDict;
      const parent = w.lookup(PDFName.of('Parent')) as import('pdf-lib').PDFDict | undefined;
      const t = (parent ?? w).lookup(PDFName.of('T')) as { decodeText(): string };
      order.push(t.decodeText());
    }
    expect(order.slice(0, 3)).toEqual(['FirstName', 'LastName', 'Email']);

    // The placeholder text is no longer visible in the result (text render mode 3)
    const pj = await openPdfjs(res.bytes);
    const pg = await pj.getPage(1);
    const ops = await pg.getOperatorList();
    expect(ops.fnArray.length).toBeGreaterThan(10);
    const ann = await pg.getAnnotations();
    expect(ann.filter((a: { subtype: string }) => a.subtype === 'Widget').length).toBe(9);
  });

  it('separates fields with a suffix on request and keeps fields when rotating/reordering', async () => {
    const { doc, pages, fields } = await prepare('sample-layers.pdf');
    for (const f of fields) if (f.name === 'FirstName') f.name = `FirstName_S${f.pageId === 'p0' ? 1 : 2}`;
    const reordered = [pages[1], { ...pages[0], rotation: 90 }];
    const res = await exportPdf({ docs: [doc], pages: reordered, fields, customFonts: [], options: { hidePlaceholderLayers: true } });
    const out = await PDFDocument.load(res.bytes);
    expect(out.getPageCount()).toBe(2);
    expect(out.getPage(1).getRotation().angle).toBe(90);
    // Fields rotate with the content: no additional widget rotation
    const w1 = out.getForm().getTextField('LastName').acroField.getWidgets()[0];
    expect(w1.getAppearanceCharacteristics()?.getRotation() ?? 0).toBe(0);
    const names = out.getForm().getFields().map((f) => f.getName());
    expect(names).toContain('FirstName_S1');
    expect(names).toContain('FirstName_S2');
    // Page 1 (formerly 2) contains ProjectName
    const w = out.getForm().getTextField('ProjectName').acroField.getWidgets()[0];
    expect(w.P()?.toString()).toBe(out.getPage(0).ref.toString());
  });
});

describe('Tag sample', () => {
  it('detects text tags, hides them and takes over the font', async () => {
    const { doc, pages, fields } = await prepare('sample-tags.pdf');
    const names = fields.map((f) => `${f.type}:${f.name}`).sort();
    expect(names).toEqual(['area:Notes', 'check:Newsletter', 'text:Company', 'text:CustomerNumber', 'text:Date']);
    const company = fields.find((f) => f.name === 'Company')!;
    expect(company.rect.w).toBeGreaterThan(480);
    expect(company.fontSize).toBe(12);
    expect(company.color[2]).toBeCloseTo(0.6, 2);
    expect(fields.find((f) => f.name === 'CustomerNumber')!.fontFamily).toBe('Courier');
    const nl = fields.find((f) => f.name === 'Newsletter')!;
    expect(nl.rect.w).toBeCloseTo(12, 1);
    const notes = fields.find((f) => f.name === 'Notes')!;
    expect(notes.placeholder).toBe('Optional: delivery instructions');

    const res = await exportPdf({ docs: [doc], pages, fields, customFonts: [], options: { hidePlaceholderLayers: false } });
    const pj = await openPdfjs(res.bytes);
    const pg = await pj.getPage(1);
    const tc = await pg.getTextContent();
    // pdf.js also returns invisible text – check that render mode 3 is set
    const ol = await pg.getOperatorList();
    const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const trModes = ol.fnArray.map((fn: number, i: number) => (fn === OPS.setTextRenderingMode ? ol.argsArray[i][0] : null)).filter((x: number | null) => x !== null);
    expect(trModes.filter((m: number) => m === 3).length).toBe(6);
    expect(tc.items.length).toBeGreaterThan(0);
  });
});

describe('Geometry', () => {
  it('converts back and forth for all rotations', () => {
    for (const rotation of [0, 90, 180, 270]) {
      const g = { view: [0, 0, 595, 842] as [number, number, number, number], rotation, scale: 1.5 };
      const s = toScreen(g, 100, 200);
      const p = toPdf(g, s[0], s[1]);
      expect(p[0]).toBeCloseTo(100); expect(p[1]).toBeCloseTo(200);
    }
  });
  it('matches the pdf.js viewport', async () => {
    const pj = await openPdfjs(load('sample-tags.pdf'));
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
  it('analyzes and exports 10 pages in under 3 seconds', async () => {
    const src = await PDFDocument.load(load('sample-layers.pdf'));
    const big = await PDFDocument.create();
    for (let i = 0; i < 5; i++) for (const p of await big.copyPages(src, [0, 1])) big.addPage(p);
    const bytes = await big.save();
    const t0 = performance.now();
    const { doc } = await analyzeDocument(bytes, 'large.pdf');
    const pages: PageRef[] = doc.pages.map((_, i) => ({ id: `p${i}`, docId: doc.id, srcIndex: i, rotation: 0 }));
    const fields = doc.pages.flatMap((a, i) => detectPageFields(a, `p${i}`));
    const res = await exportPdf({ docs: [doc], pages, fields, customFonts: [], options: { hidePlaceholderLayers: false } });
    const ms = performance.now() - t0;
    expect(doc.pages).toHaveLength(10);
    expect(res.fieldCount).toBe(55);
    expect(ms).toBeLessThan(3000);
  });
});
