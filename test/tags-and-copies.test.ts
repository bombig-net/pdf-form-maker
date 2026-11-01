import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, StandardFonts, rgb, PDFButton } from 'pdf-lib';
import { analyzeDocument } from '../src/pdf/analyze';
import { detectPageFields, parseTag } from '../src/pdf/detect';
import { exportPdf } from '../src/pdf/export';
import type { PageRef } from '../src/types';

/** A small layout with a text field, a signature line and two buttons, all as text tags. */
async function layout() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([595, 842]);
  p.drawText('Name', { x: 56, y: 760, size: 9, font });
  p.drawRectangle({ x: 56, y: 730, width: 240, height: 24, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.75 });
  p.drawText('[Form_Text_Name]', { x: 62, y: 738, size: 10, font });
  p.drawText('Gift wrap', { x: 76, y: 702, size: 10, font });
  p.drawRectangle({ x: 56, y: 700, width: 12, height: 12, borderColor: rgb(0, 0, 0), borderWidth: 0.75 });
  p.drawText('[Form_Check_Gift]', { x: 140, y: 702, size: 9, font });
  p.drawText('Gift message', { x: 56, y: 680, size: 9, font });
  p.drawRectangle({ x: 56, y: 650, width: 240, height: 24, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.75 });
  p.drawText('[Form_Text_Message]', { x: 62, y: 658, size: 10, font });
  p.drawText('Signature', { x: 56, y: 600, size: 9, font });
  p.drawLine({ start: { x: 56, y: 570 }, end: { x: 296, y: 570 }, thickness: 0.75 });
  p.drawText('[Form_Signature_Applicant]', { x: 60, y: 574, size: 9, font });
  p.drawRectangle({ x: 56, y: 500, width: 140, height: 30, color: rgb(0.1, 0.45, 0.3) });
  p.drawText('[Form_Button_Send]', { x: 64, y: 511, size: 10, font, color: rgb(1, 1, 1) });
  p.drawRectangle({ x: 210, y: 500, width: 140, height: 30, color: rgb(0.9, 0.9, 0.9) });
  p.drawText('[Form_Button_Print_Print this form]', { x: 214, y: 511, size: 8, font });
  const { doc: src } = await analyzeDocument(await doc.save(), 'tags.pdf');
  const pages: PageRef[] = [{ id: 'p0', docId: src.id, srcIndex: 0, rotation: 0 }];
  const fields = detectPageFields(src.pages[0], 'p0');
  fields.find((f) => f.name === 'Message')!.showIf = { field: 'Gift' };
  return { src, pages, fields };
}

describe('Button and signature tags', () => {
  it('parses button tags with action and optional caption', () => {
    expect(parseTag('[Form_Button_Send]')).toMatchObject({ type: 'reset', buttonAction: 'email', label: 'Send form' });
    expect(parseTag('[Form_Button_Print_Print this form]')).toMatchObject({ type: 'reset', buttonAction: 'print', label: 'Print this form' });
    expect(parseTag('[Form_Button_Save]')).toMatchObject({ buttonAction: 'save', label: 'Save PDF' });
    expect(parseTag('Form_Button_Reset')).toMatchObject({ buttonAction: 'reset', label: 'Reset form' });
    expect(parseTag('[Form_Signature_Applicant]')).toMatchObject({ type: 'signature', name: 'Applicant' });
    expect(parseTag('[Form_Sign_Tenant]')).toMatchObject({ type: 'signature', name: 'Tenant' });
  });

  it('detects buttons with the box color and exports them with their actions, plus a signature field', async () => {
    const { src, pages, fields } = await layout();
    const send = fields.find((f) => f.buttonAction === 'email')!;
    expect(send.type).toBe('reset');
    expect(send.label).toBe('Send form');
    expect(send.buttonBg[1]).toBeCloseTo(0.45, 2);
    expect(send.rect.w).toBeCloseTo(140, 0);
    expect(fields.find((f) => f.buttonAction === 'print')!.label).toBe('Print this form');
    const sig = fields.find((f) => f.type === 'signature')!;
    expect(sig.name).toBe('Applicant');

    const res = await exportPdf({ docs: [src], pages, fields, customFonts: [], options: { hidePlaceholderLayers: false } });
    expect(res.warnings).toEqual([]);
    const form = (await PDFDocument.load(res.bytes)).getForm();
    const sigField = form.getField('Applicant');
    expect((sigField.acroField.dict.lookup(PDFName.of('FT')) as PDFName).decodeText()).toBe('Sig');
    expect(sigField.acroField.getWidgets()).toHaveLength(1);
    const js = (n: string) => {
      const a = form.getButton(n).acroField.getWidgets()[0].dict.lookup(PDFName.of('A')) as import('pdf-lib').PDFDict;
      return (a.lookup(PDFName.of('JS')) as { decodeText(): string }).decodeText();
    };
    expect(js('Button_Send')).toContain('mailDoc');
    expect(js('Button_Print')).toContain('this.print');
  });
});

describe('Filled-in copies', () => {
  it('fills in values, shows conditional fields whose condition is met, and keeps the form fillable', async () => {
    const { src, pages, fields } = await layout();
    const values = { Name: 'Anna Berg', Gift: true, Message: 'Happy birthday' };
    const res = await exportPdf({ docs: [src], pages, fields, customFonts: [], options: { hidePlaceholderLayers: false, values } });
    const form = (await PDFDocument.load(res.bytes)).getForm();
    expect(form.getTextField('Name').getText()).toBe('Anna Berg');
    expect(form.getCheckBox('Gift').isChecked()).toBe(true);
    const flags = (form.getTextField('Message').acroField.getWidgets()[0].dict.lookup(PDFName.of('F')) as import('pdf-lib').PDFNumber).asNumber();
    expect(flags & 2).toBe(0);
  });

  it('flattens the entries into the page and removes every field', async () => {
    const { src, pages, fields } = await layout();
    const res = await exportPdf({ docs: [src], pages, fields, customFonts: [], options: { hidePlaceholderLayers: false, values: { Name: 'Anna Berg' }, flatten: true } });
    const out = await PDFDocument.load(res.bytes);
    expect(out.getForm().getFields()).toHaveLength(0);
    expect(out.getForm().getFields().some((f) => f instanceof PDFButton)).toBe(false);
    // The typed name is now part of the page content
    const { openPdfjs } = await import('../src/pdf/pdfjs');
    const pj = await openPdfjs(res.bytes);
    const text = (await (await pj.getPage(1)).getTextContent()).items.map((i: { str?: string }) => i.str ?? '').join(' ');
    expect(text).toContain('Anna Berg');
    const annots = (await (await pj.getPage(1)).getAnnotations()).filter((a: { subtype: string }) => a.subtype === 'Widget');
    expect(annots).toHaveLength(0);
  });
});
