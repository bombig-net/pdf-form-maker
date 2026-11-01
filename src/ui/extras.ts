import { store } from '../state';
import type { Field, FormatKind } from '../types';
import { newField } from '../pdf/detect';
import { suggestFields } from '../pdf/suggest';
import { toast } from './dom';
import { uniqueName, slugify, type Viewer } from './viewer';

interface Slot { name: string; placeholder: string; format: FormatKind; x: number; w: number; row: number }

/**
 * Inserts a ready-made address block (name, street, postal code, city, email, phone)
 * on the visible page and selects it, so it can be moved as a group.
 */
export function insertAddressBlock(viewer: Viewer) {
  const pageId = viewer.currentPageId();
  const page = pageId ? store.page(pageId) : undefined;
  if (!page) return;
  const v = store.analysis(page).view;
  const margin = 56, rowH = 22, gap = 10;
  const width = Math.min(340, v[2] - v[0] - margin * 2);
  const zipW = Math.round(width * 0.28);
  const slots: Slot[] = [
    { name: 'Name', placeholder: 'Full name', format: 'none', x: 0, w: width, row: 0 },
    { name: 'Street', placeholder: 'Street and number', format: 'none', x: 0, w: width, row: 1 },
    { name: 'PostalCode', placeholder: 'Postal code', format: 'zip', x: 0, w: zipW, row: 2 },
    { name: 'City', placeholder: 'City', format: 'none', x: zipW + gap, w: width - zipW - gap, row: 2 },
    { name: 'Email', placeholder: 'Email', format: 'email', x: 0, w: width, row: 3 },
    { name: 'Phone', placeholder: 'Phone', format: 'phone', x: 0, w: width, row: 4 },
  ];
  const top = v[3] - (v[3] - v[1]) * 0.25;
  const created: Field[] = [];
  store.commit(() => {
    for (const s of slots) {
      const rect = { x: v[0] + margin + s.x, y: top - s.row * (rowH + gap) - rowH, w: s.w, h: rowH };
      const f = newField('text', page.id, rect);
      let name = uniqueName(s.name);
      while (created.some((c) => c.name === name)) name = `${name}_2`;
      Object.assign(f, { name, placeholder: s.placeholder, tooltip: s.placeholder, format: s.format, fontSize: 10, bgColor: [1, 1, 1] });
      created.push(f);
      store.fields.push(f);
    }
  });
  store.setSelection(created.map((f) => f.id));
  viewer.scrollToField(created[0].id);
  toast('Address block added. Drag it into place as a group.');
}

/**
 * Looks for empty boxes, lines, underscores and checkbox glyphs on all pages and adds them as
 * suggested fields (named after their labels). Everything is one undo step. Returns the number found.
 */
export function suggestAllFields(scrollTo?: (id: string) => void): number {
  const created: Field[] = [];
  const base: Record<string, string> = { text: 'TextField', area: 'TextArea', check: 'Checkbox' };
  for (const p of store.pages) {
    for (const f of suggestFields(store.analysis(p), p.id, [...store.fields, ...created])) {
      let name = slugify(f.tooltip) || base[f.type] || 'Field';
      const taken = (n: string) => store.fields.some((x) => x.name === n) || created.some((x) => x.name === n);
      if (taken(name)) { let k = 2; while (taken(`${name}_${k}`)) k++; name = `${name}_${k}`; }
      f.name = uniqueName(name);
      created.push(f);
    }
  }
  if (!created.length) { toast('No further fields found. You can draw fields with the tools above.', 'info', 5000); return 0; }
  store.commit(() => { store.fields.push(...created); });
  store.setSelection(created.map((f) => f.id));
  scrollTo?.(created[0].id);
  toast(`${created.length} ${created.length === 1 ? 'field' : 'fields'} suggested. Check them and delete what you don\u2019t need, or undo with \u2318/Ctrl Z.`, 'info', 7000);
  return created.length;
}
