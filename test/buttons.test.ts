import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, type PDFDict } from 'pdf-lib';
import { analyzeDocument } from '../src/pdf/analyze';
import { newField } from '../src/pdf/detect';
import { exportPdf } from '../src/pdf/export';
import type { PageRef } from '../src/types';

describe('Button actions', () => {
  it('exports reset, email, print and save buttons with the right action', async () => {
    const { doc } = await analyzeDocument(new Uint8Array(readFileSync('src/assets/sample-tags.pdf')), 'sample-tags.pdf');
    const pages: PageRef[] = [{ id: 'p0', docId: doc.id, srcIndex: 0, rotation: 0 }];
    const mk = (name: string, action: 'reset' | 'email' | 'print' | 'save', x: number) =>
      Object.assign(newField('reset', 'p0', { x, y: 300, w: 100, h: 24 }, name), { buttonAction: action, mailTo: 'a@b.de', label: name });
    const fields = [mk('Reset', 'reset', 50), mk('Mail', 'email', 160), mk('Print', 'print', 270), mk('Save', 'save', 380)];
    const res = await exportPdf({ docs: [doc], pages, fields, customFonts: [], options: { hidePlaceholderLayers: false } });
    expect(res.warnings).toEqual([]);
    const form = (await PDFDocument.load(res.bytes)).getForm();
    const action = (n: string) => form.getButton(n).acroField.getWidgets()[0].dict.lookup(PDFName.of('A')) as PDFDict;
    const js = (n: string) => (action(n).lookup(PDFName.of('JS')) as { decodeText(): string }).decodeText();
    expect((action('Reset').lookup(PDFName.of('S')) as PDFName).decodeText()).toBe('ResetForm');
    expect(js('Mail')).toContain('mailDoc');
    expect(js('Print')).toContain('this.print');
    expect(js('Save')).toContain('app.execMenuItem("SaveAs")');
  });
});
