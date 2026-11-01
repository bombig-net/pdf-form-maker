import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { analyzeDocument } from '../src/pdf/analyze';
import { detectPageFields } from '../src/pdf/detect';
import { exportPdf } from '../src/pdf/export';
import type { PageRef } from '../src/types';

describe('Inner padding', () => {
  it('insets text fields on export, but not comb fields', async () => {
    const { doc } = await analyzeDocument(new Uint8Array(readFileSync('src/assets/sample-tags.pdf')), 'sample-tags.pdf');
    const pages: PageRef[] = doc.pages.map((_, i) => ({ id: `p${i}`, docId: doc.id, srcIndex: i, rotation: 0 }));
    const fields = doc.pages.flatMap((a, i) => detectPageFields(a, `p${i}`));
    const comb = fields.find((f) => f.name === 'CustomerNumber')!;
    comb.comb = true; comb.maxLength = 8;
    const res = await exportPdf({ docs: [doc], pages, fields, customFonts: [], options: { hidePlaceholderLayers: false, padding: 3 } });
    const form = (await PDFDocument.load(res.bytes)).getForm();
    const rect = (n: string) => form.getTextField(n).acroField.getWidgets()[0].getRectangle();
    const company = fields.find((f) => f.name === 'Company')!;
    expect(rect('Company').x).toBeCloseTo(company.rect.x + 3, 1);
    expect(rect('Company').width).toBeCloseTo(company.rect.w - 6, 1);
    expect(rect('Company').height).toBeCloseTo(company.rect.h, 1);
    const notes = fields.find((f) => f.name === 'Notes')!;
    expect(rect('Notes').height).toBeCloseTo(notes.rect.h - 6, 1);
    expect(rect('CustomerNumber').width).toBeCloseTo(comb.rect.w, 1);
  });
});
