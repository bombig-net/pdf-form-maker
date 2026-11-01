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

describe('Regional formats', () => {
  it('parses and normalizes dates per region', async () => {
    const { locale, normalizeDate } = await import('../src/util/locale');
    expect(normalizeDate('1.2.26', locale('eu'))).toBe('01.02.2026');
    expect(normalizeDate('31/12/2026', locale('uk'))).toBe('31/12/2026');
    expect(normalizeDate('12/31/2026', locale('us'))).toBe('12/31/2026');
    expect(normalizeDate('31/12/2026', locale('us'))).toBeNull();
    expect(normalizeDate('30.02.2026', locale('eu'))).toBeNull();
  });
  it('parses numbers per region', async () => {
    const { locale, parseNumber } = await import('../src/util/locale');
    expect(parseNumber('1.234,56', locale('eu'))).toBeCloseTo(1234.56);
    expect(parseNumber("1'234.56", locale('ch'))).toBeCloseTo(1234.56);
    expect(parseNumber('1,234.56', locale('us'))).toBeCloseTo(1234.56);
    expect(parseNumber('abc', locale('eu'))).toBeNaN();
  });
  it('writes region-specific Acrobat scripts, Europe by default', async () => {
    const { buildScripts } = await import('../src/pdf/export');
    const { newField } = await import('../src/pdf/detect');
    const { locale } = await import('../src/util/locale');
    const f = newField('text', 'p', { x: 0, y: 0, w: 100, h: 20 }, 'X');
    f.format = 'date';
    expect(buildScripts(f, [0, 0, 0]).K).toContain('dd.mm.yyyy');
    expect(buildScripts(f, [0, 0, 0], locale('us')).K).toContain('mm/dd/yyyy');
    f.format = 'number';
    expect(buildScripts(f, [0, 0, 0]).K).toContain('AFNumber_Keystroke(2, 2,');
    expect(buildScripts(f, [0, 0, 0], locale('uk')).K).toContain('AFNumber_Keystroke(2, 0,');
    f.format = 'zip';
    expect(buildScripts(f, [0, 0, 0], locale('us')).V).toContain('[0-9]{5}(-[0-9]{4})?');
  });
});

describe('Dropdown and comb fields', () => {
  it('recognizes dropdown tags', () => {
    expect(parseTag('[Form_Dropdown_Country]')).toMatchObject({ type: 'dropdown', name: 'Country' });
    expect(parseTag('[Form_Select_Size]')).toMatchObject({ type: 'dropdown', name: 'Size' });
  });
  it('exports dropdowns with options and comb text fields', async () => {
    const { doc, pages, fields } = await prepare('sample-tags.pdf');
    const { newField } = await import('../src/pdf/detect');
    const dd = newField('dropdown', 'p0', { x: 300, y: 700, w: 150, h: 20 }, 'Country');
    dd.choices = ['Germany', 'Austria', '', 'Switzerland', 'Austria'];
    const comb = fields.find((f) => f.name === 'CustomerNumber')!;
    comb.comb = true; comb.maxLength = 8;
    const res = await exportPdf({ docs: [doc], pages, fields: [...fields, dd], customFonts: [], options: { hidePlaceholderLayers: false } });
    expect(res.warnings).toEqual([]);
    const form = (await PDFDocument.load(res.bytes)).getForm();
    expect(form.getDropdown('Country').getOptions()).toEqual(['Germany', 'Austria', 'Switzerland']);
    const tf = form.getTextField('CustomerNumber');
    expect(tf.isCombed()).toBe(true);
    expect(tf.getMaxLength()).toBe(8);
  });
});

describe('Calculations, conditions and buttons', () => {
  it('parses and evaluates formulas', async () => {
    const { parseFormula, evalFormula } = await import('../src/pdf/logic');
    const v: Record<string, number> = { Quantity: 3, Price: 2.5 };
    expect(evalFormula(parseFormula('Quantity * Price * 1,19'), (n) => v[n])).toBeCloseTo(8.925);
    expect(evalFormula(parseFormula('-(Quantity - 5) / 0'), (n) => v[n])).toBe(0);
    expect(() => parseFormula('Quantity * Unknown', new Set(['Quantity']))).toThrow(/Unknown/);
    expect(() => parseFormula('alert(1);')).toThrow();
  });
  it('exports calculations, visibility rules and an email button', async () => {
    const { doc, pages, fields } = await prepare('sample-tags.pdf');
    const { newField } = await import('../src/pdf/detect');
    const qty = newField('text', 'p0', { x: 300, y: 760, w: 60, h: 20 }, 'Qty');
    const total = newField('text', 'p0', { x: 380, y: 760, w: 80, h: 20 }, 'Total');
    total.calc = { op: 'formula', formula: 'Qty * 2' };
    const sum = newField('text', 'p0', { x: 470, y: 760, w: 80, h: 20 }, 'Sum');
    sum.calc = { op: 'sum', fields: ['Qty', 'Total'] };
    fields.find((f) => f.name === 'Notes')!.showIf = { field: 'Newsletter' };
    const send = newField('reset', 'p0', { x: 56, y: 380, w: 120, h: 24 }, 'Send');
    Object.assign(send, { buttonAction: 'email', mailTo: 'forms@example.com', mailSubject: 'Order', label: 'Send form' });
    const res = await exportPdf({ docs: [doc], pages, fields: [...fields, qty, total, sum, send], customFonts: [], options: { hidePlaceholderLayers: false } });
    expect(res.warnings).toEqual([]);
    const out = await PDFDocument.load(res.bytes);
    const form = out.getForm();
    const js = (d: import('pdf-lib').PDFDict, key: string) => {
      const aa = d.lookup(PDFName.of('AA')) as import('pdf-lib').PDFDict | undefined;
      const a = aa?.lookup(PDFName.of(key)) as import('pdf-lib').PDFDict | undefined;
      return (a?.lookup(PDFName.of('JS')) as { decodeText(): string } | undefined)?.decodeText() ?? '';
    };
    expect(js(form.getTextField('Total').acroField.dict, 'C')).toContain('AFMakeNumber(this.getField("Qty").value) * 2');
    expect(js(form.getTextField('Sum').acroField.dict, 'C')).toContain('AFSimple_Calculate("SUM", new Array("Qty", "Total"))');
    expect(form.getTextField('Total').isReadOnly()).toBe(true);
    const co = form.acroForm.dict.lookup(PDFName.of('CO')) as import('pdf-lib').PDFArray;
    expect(co.size()).toBe(2);
    const notesWidget = form.getTextField('Notes').acroField.getWidgets()[0];
    expect((notesWidget.dict.lookup(PDFName.of('F')) as import('pdf-lib').PDFNumber).asNumber() & 2).toBe(2);
    expect(js(form.getCheckBox('Newsletter').acroField.getWidgets()[0].dict, 'U')).toContain('this.getField("Notes").display');
    const btn = form.getButton('Send').acroField.getWidgets()[0].dict.lookup(PDFName.of('A')) as import('pdf-lib').PDFDict;
    expect((btn.lookup(PDFName.of('JS')) as { decodeText(): string }).decodeText()).toContain('mailDoc');
  });
});

describe('Field suggestions without tags', () => {
  it('finds boxes, checkboxes, underlines and underscores, but no panels, headings or tables', async () => {
    const { doc } = await analyzeDocument(load('sample-plain.pdf'), 'sample-plain.pdf');
    const a = doc.pages[0];
    expect(detectPageFields(a, 'p0')).toHaveLength(0);
    const { suggestFields } = await import('../src/pdf/suggest');
    const s = suggestFields(a, 'p0');
    const summary = s.map((f) => `${f.type}:${f.tooltip}`).sort();
    expect(summary).toEqual([
      'area:Message',
      'check:I accept the terms',
      'check:Send me the newsletter',
      'text:Company',
      'text:Email',
      'text:Full name',
      'text:Place, date',
      'text:Reference',
      'text:Signature',
    ]);
    const email = s.find((f) => f.tooltip === 'Email')!;
    expect(email.placeholder).toBe('name@example.com');
    expect(email.hideText).toBe(true);
    const ref = s.find((f) => f.tooltip === 'Reference')!;
    expect(ref.placeholder).toBe('');
    expect(ref.hideText).toBe(false);
    // Nothing is suggested twice
    expect(suggestFields(a, 'p0', s)).toHaveLength(0);
  });
});
