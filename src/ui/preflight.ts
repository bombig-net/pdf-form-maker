import { store } from '../state';
import type { Field } from '../types';
import { h } from './dom';
import type { Viewer } from './viewer';
import { parseFormula } from '../pdf/logic';

export interface Issue { level: 'warn' | 'info'; text: string; fields: Field[] }

const area = (f: Field) => f.rect.w * f.rect.h;
function overlap(a: Field, b: Field) {
  const w = Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w) - Math.max(a.rect.x, b.rect.x);
  const hh = Math.min(a.rect.y + a.rect.h, b.rect.y + b.rect.h) - Math.max(a.rect.y, b.rect.y);
  return w > 0 && hh > 0 ? w * hh : 0;
}
const label = (f: Field) => (f.type === 'radio' ? `${f.name} · ${f.radioValue}` : f.type === 'reset' ? f.label || 'Reset' : f.name || 'unnamed');

/** Checklist before export – like a preflight in prepress. */
export function runChecks(): Issue[] {
  const issues: Issue[] = [];
  const fields = store.fields.filter((f) => store.page(f.pageId));

  // Overlaps
  for (const p of store.pages) {
    const fs = fields.filter((f) => f.pageId === p.id);
    for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) {
      const o = overlap(fs[i], fs[j]);
      if (o > Math.min(area(fs[i]), area(fs[j])) * 0.2) issues.push({ level: 'warn', text: `“${label(fs[i])}” and “${label(fs[j])}” overlap.`, fields: [fs[i], fs[j]] });
    }
  }
  for (const f of fields) {
    const v = store.analysis(store.page(f.pageId)!).view;
    if (f.rect.x < v[0] - 1 || f.rect.y < v[1] - 1 || f.rect.x + f.rect.w > v[2] + 1 || f.rect.y + f.rect.h > v[3] + 1)
      issues.push({ level: 'warn', text: `“${label(f)}” extends beyond the page edge.`, fields: [f] });
    if (f.rect.w < 6 || f.rect.h < 6) issues.push({ level: 'warn', text: `“${label(f)}” is very small and hard to tap on a phone.`, fields: [f] });
    if ((f.type === 'text' || f.type === 'area') && f.fontSize > 0 && f.fontSize < 6) issues.push({ level: 'warn', text: `“${label(f)}” uses a very small font (${f.fontSize} pt).`, fields: [f] });
    if (f.type === 'text' && f.fontSize > 0 && f.fontSize > f.rect.h * 0.9) issues.push({ level: 'warn', text: `The font in “${label(f)}” is taller than the field.`, fields: [f] });
    if (!f.name.trim() && f.type !== 'reset') issues.push({ level: 'warn', text: 'A field has no name.', fields: [f] });
    if (f.type === 'dropdown' && !(f.choices ?? []).some((c) => c.trim())) issues.push({ level: 'warn', text: `The dropdown \u201c${label(f)}\u201d has no options.`, fields: [f] });
    if (f.comb && f.type === 'text' && !(f.maxLength > 0)) issues.push({ level: 'warn', text: `\u201c${label(f)}\u201d is set to comb but has no max. length, so it stays a normal text field.`, fields: [f] });
    if (f.calc && f.type === 'text') {
      const names = new Set(fields.filter((x) => x.type === 'text' && x.name !== f.name).map((x) => x.name));
      if (f.calc.op === 'formula') {
        try { parseFormula(f.calc.formula ?? '', names); } catch (e) { issues.push({ level: 'warn', text: `The formula of \u201c${label(f)}\u201d is invalid: ${(e as Error).message}`, fields: [f] }); }
      } else if (!(f.calc.fields ?? []).some((n) => names.has(n))) issues.push({ level: 'warn', text: `\u201c${label(f)}\u201d has a calculation but no fields to calculate.`, fields: [f] });
    }
    if (f.showIf?.field && !fields.some((x) => x.name === f.showIf!.field && (x.type === 'check' || x.type === 'radio' || x.type === 'dropdown')))
      issues.push({ level: 'warn', text: `\u201c${label(f)}\u201d depends on \u201c${f.showIf.field}\u201d, which no longer exists. It would stay hidden.`, fields: [f] });
    if (f.type === 'reset' && f.buttonAction === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.mailTo ?? ''))
      issues.push({ level: 'warn', text: `The button \u201c${label(f)}\u201d has no valid email address.`, fields: [f] });
    if (f.maxLength > 0 && f.placeholder.length > f.maxLength) issues.push({ level: 'info', text: `The placeholder of “${label(f)}” is longer than the allowed ${f.maxLength} characters and will be cut off.`, fields: [f] });
  }
  // Names
  const byName = new Map<string, Field[]>();
  for (const f of fields) if (f.type !== 'reset') { const l = byName.get(f.name) ?? []; l.push(f); byName.set(f.name, l); }
  for (const [name, list] of byName) {
    const types = new Set(list.map((f) => f.type));
    if (types.size > 1) issues.push({ level: 'warn', text: `“${name}” is used for different field types and will be renamed on export.`, fields: list });
    if (list[0].type === 'radio' && list.length === 1) issues.push({ level: 'info', text: `The radio group “${name}” has only one option and cannot be deselected.`, fields: list });
  }
  if (!fields.length) issues.push({ level: 'info', text: 'The document has no form fields yet.', fields: [] });
  return issues;
}

/** Shows the checklist. true = export, false = back to editing. */
export function preflight(viewer: Viewer): Promise<boolean> {
  const issues = runChecks();
  if (!issues.length) return Promise.resolve(true);
  return new Promise((resolve) => {
    let result = false;
    const show = (fs: Field[]) => {
      result = false; dlg.close();
      if (!fs.length) return;
      store.setSelection(fs.map((f) => f.id));
      viewer.scrollToField(fs[0].id);
    };
    const list = h('ul.preflight-list', {}, ...issues.map((i) => h('li', { 'data-level': i.level },
      h('span.pf-dot', { 'aria-hidden': 'true' }),
      h('span.pf-text', {}, i.text, i.fields.length ? h('small', {}, ` Page ${[...new Set(i.fields.map((f) => store.pageNumber(f.pageId)))].join(', ')}`) : null),
      i.fields.length ? h('button.btn.secondary.small', { type: 'button', onclick: () => show(i.fields) }, 'Show') : null)));
    const warns = issues.filter((i) => i.level === 'warn').length;
    const dlg = h<HTMLDialogElement>('dialog.modal.preflight', { 'aria-labelledby': 'pf-title' },
      h('h2', { id: 'pf-title' }, warns ? `Preflight: ${warns} ${warns === 1 ? 'issue' : 'issues'} before export` : 'Preflight: minor notes'),
      h('p', {}, 'You can still export the form. “Show” takes you to the affected field.'),
      list,
      h('div.modal-actions', {},
        h('button.btn.secondary', { type: 'button', onclick: () => { result = false; dlg.close(); } }, 'Back to editing'),
        h('button.btn.primary', { type: 'button', onclick: () => { result = true; dlg.close(); } }, 'Export anyway')));
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    document.body.append(dlg);
    dlg.showModal();
  });
}
