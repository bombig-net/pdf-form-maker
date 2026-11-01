import { store } from '../state';
import type { Field } from '../types';
import { h } from './dom';
import type { Viewer } from './viewer';

export interface Issue { level: 'warn' | 'info'; text: string; fields: Field[] }

const area = (f: Field) => f.rect.w * f.rect.h;
function overlap(a: Field, b: Field) {
  const w = Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w) - Math.max(a.rect.x, b.rect.x);
  const hh = Math.min(a.rect.y + a.rect.h, b.rect.y + b.rect.h) - Math.max(a.rect.y, b.rect.y);
  return w > 0 && hh > 0 ? w * hh : 0;
}
const label = (f: Field) => (f.type === 'radio' ? `${f.name} · ${f.radioValue}` : f.type === 'reset' ? f.label || 'Zurücksetzen' : f.name || 'ohne Namen');

/** Prüfliste vor dem Export – wie ein Preflight in der Druckvorstufe. */
export function runChecks(): Issue[] {
  const issues: Issue[] = [];
  const fields = store.fields.filter((f) => store.page(f.pageId));

  // Überlappungen
  for (const p of store.pages) {
    const fs = fields.filter((f) => f.pageId === p.id);
    for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) {
      const o = overlap(fs[i], fs[j]);
      if (o > Math.min(area(fs[i]), area(fs[j])) * 0.2) issues.push({ level: 'warn', text: `„${label(fs[i])}“ und „${label(fs[j])}“ überlappen sich.`, fields: [fs[i], fs[j]] });
    }
  }
  for (const f of fields) {
    const v = store.analysis(store.page(f.pageId)!).view;
    if (f.rect.x < v[0] - 1 || f.rect.y < v[1] - 1 || f.rect.x + f.rect.w > v[2] + 1 || f.rect.y + f.rect.h > v[3] + 1)
      issues.push({ level: 'warn', text: `„${label(f)}“ ragt über den Seitenrand.`, fields: [f] });
    if (f.rect.w < 6 || f.rect.h < 6) issues.push({ level: 'warn', text: `„${label(f)}“ ist sehr klein und auf dem Telefon kaum antippbar.`, fields: [f] });
    if ((f.type === 'text' || f.type === 'area') && f.fontSize > 0 && f.fontSize < 6) issues.push({ level: 'warn', text: `„${label(f)}“ hat eine sehr kleine Schrift (${f.fontSize} pt).`, fields: [f] });
    if (f.type === 'text' && f.fontSize > 0 && f.fontSize > f.rect.h * 0.9) issues.push({ level: 'warn', text: `Die Schrift in „${label(f)}“ ist höher als das Feld.`, fields: [f] });
    if (!f.name.trim() && f.type !== 'reset') issues.push({ level: 'warn', text: 'Ein Feld hat keinen Namen.', fields: [f] });
    if (f.maxLength > 0 && f.placeholder.length > f.maxLength) issues.push({ level: 'info', text: `Der Platzhalter von „${label(f)}“ ist länger als die erlaubten ${f.maxLength} Zeichen und wird gekürzt.`, fields: [f] });
  }
  // Namen
  const byName = new Map<string, Field[]>();
  for (const f of fields) if (f.type !== 'reset') { const l = byName.get(f.name) ?? []; l.push(f); byName.set(f.name, l); }
  for (const [name, list] of byName) {
    const types = new Set(list.map((f) => f.type));
    if (types.size > 1) issues.push({ level: 'warn', text: `„${name}“ wird für verschiedene Feldtypen verwendet und beim Export umbenannt.`, fields: list });
    if (list[0].type === 'radio' && list.length === 1) issues.push({ level: 'info', text: `Die Radio-Gruppe „${name}“ hat nur eine Option und lässt sich nicht abwählen.`, fields: list });
  }
  if (!fields.length) issues.push({ level: 'info', text: 'Das Dokument enthält noch keine Formularfelder.', fields: [] });
  return issues;
}

/** Zeigt die Prüfliste. true = exportieren, false = zurück zum Bearbeiten. */
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
      h('span.pf-text', {}, i.text, i.fields.length ? h('small', {}, ` Seite ${[...new Set(i.fields.map((f) => store.pageNumber(f.pageId)))].join(', ')}`) : null),
      i.fields.length ? h('button.btn.secondary.small', { type: 'button', onclick: () => show(i.fields) }, 'Zeigen') : null)));
    const warns = issues.filter((i) => i.level === 'warn').length;
    const dlg = h<HTMLDialogElement>('dialog.modal.preflight', { 'aria-labelledby': 'pf-title' },
      h('h2', { id: 'pf-title' }, warns ? `Preflight: ${warns} ${warns === 1 ? 'Hinweis' : 'Hinweise'} vor dem Export` : 'Preflight: kleine Anmerkungen'),
      h('p', {}, 'Das Formular lässt sich trotzdem exportieren. Mit „Zeigen“ springst du zum betroffenen Feld.'),
      list,
      h('div.modal-actions', {},
        h('button.btn.secondary', { type: 'button', onclick: () => { result = false; dlg.close(); } }, 'Zurück zum Bearbeiten'),
        h('button.btn.primary', { type: 'button', onclick: () => { result = true; dlg.close(); } }, 'Trotzdem exportieren')));
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    document.body.append(dlg);
    dlg.showModal();
  });
}
