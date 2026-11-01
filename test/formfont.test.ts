import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzeDocument } from '../src/pdf/analyze';
import { detectPageFields } from '../src/pdf/detect';
import { applyFormFont, formFontFromFields } from '../src/ui/formfont';

describe('Form font', () => {
  it('derives one font from the layout and applies it to all fields without own settings', async () => {
    const { doc } = await analyzeDocument(new Uint8Array(readFileSync('src/assets/sample-layers.pdf')), 'sample-layers.pdf');
    const fields = doc.pages.flatMap((a, i) => detectPageFields(a, `p${i}`));
    const sizes = new Set(fields.filter((f) => f.type === 'text' || f.type === 'area').map((f) => f.fontSize));
    expect(sizes.size).toBeGreaterThan(1);

    const ff = formFontFromFields(fields);
    expect(ff.mode).toBe('uniform');
    expect(ff.family).toBe('Helvetica');

    const own = fields.find((f) => f.name === 'Message')!;
    own.fontLocked = true; own.fontSize = 14;
    expect(applyFormFont(fields, ff)).toBe(true);
    const texty = fields.filter((f) => (f.type === 'text' || f.type === 'area') && !f.fontLocked);
    expect(new Set(texty.map((f) => f.fontSize))).toEqual(new Set([ff.size]));
    expect(own.fontSize).toBe(14);
    // Nothing left to change, and 'Match layout' leaves fields alone
    expect(applyFormFont(fields, ff)).toBe(false);
    expect(applyFormFont(fields, { ...ff, mode: 'layout', size: 30 })).toBe(false);
  });
});
