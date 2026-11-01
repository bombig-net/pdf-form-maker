import { store, DEFAULT_PADDING } from '../state';
import type { Field, FormFont, RGB } from '../types';

const sameColor = (a: RGB, b: RGB) => a.every((v, i) => Math.abs(v - b[i]) < 0.002);
/** Fields that show text and therefore follow the form font (checkboxes and radios only take the color). */
const hasText = (f: Field) => f.type !== 'check' && f.type !== 'radio';

/**
 * Applies the form font to every field without own settings. Returns true if anything changed.
 * Runs on every change, so new, pasted, detected or suggested fields follow it automatically.
 */
export function applyFormFont(fields: Field[], ff: FormFont): boolean {
  if (ff.mode !== 'uniform') return false;
  let changed = false;
  for (const f of fields) {
    if (f.fontLocked) continue;
    if (!sameColor(f.color, ff.color)) { f.color = [...ff.color] as RGB; changed = true; }
    if (!hasText(f)) continue;
    if (f.fontFamily !== ff.family || f.fontSize !== ff.size || f.bold !== ff.bold || f.italic !== ff.italic) {
      Object.assign(f, { fontFamily: ff.family, fontSize: ff.size, bold: ff.bold, italic: ff.italic });
      changed = true;
    }
  }
  return changed;
}

/** Form font that fits the layout: most common family and color, median size of the detected text fields. */
export function formFontFromFields(fields: Field[]): FormFont {
  const texty = fields.filter((f) => (f.type === 'text' || f.type === 'area') && f.fontSize > 0);
  const most = <T>(xs: T[], key: (x: T) => string) => {
    const n = new Map<string, { x: T; c: number }>();
    for (const x of xs) { const k = key(x); const e = n.get(k); if (e) e.c++; else n.set(k, { x, c: 1 }); }
    return [...n.values()].sort((a, b) => b.c - a.c)[0]?.x;
  };
  const sizes = texty.map((f) => f.fontSize).sort((a, b) => a - b);
  const size = sizes.length ? Math.round(sizes[Math.floor(sizes.length / 2)] * 2) / 2 : 10;
  const color = most(texty.map((f) => f.color), (c) => c.map((v) => Math.round(v * 20)).join(',')) ?? [0, 0, 0];
  return {
    mode: 'uniform',
    family: most(texty.map((f) => f.fontFamily), (x) => x) ?? 'Helvetica',
    size: Math.min(14, Math.max(7, size)),
    bold: false,
    italic: false,
    color: [...color] as RGB,
    padding: DEFAULT_PADDING,
  };
}

/** Keeps the fields in line with the form font whenever something changes. */
export function startFormFont() {
  store.subscribe((k) => {
    if (!(k.has('fields') || k.has('options') || k.has('doc') || k.has('pages'))) return;
    if (applyFormFont(store.fields, store.options.formFont)) store.emit('fields');
  });
}
