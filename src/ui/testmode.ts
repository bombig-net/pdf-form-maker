import { store } from '../state';
import type { Field } from '../types';
import { h, toast } from './dom';
import { rectToScreen, type ViewGeom } from '../util/geom';
import { effectiveColor, toHex } from '../util/color';
import { sortForTabOrder } from '../util/tabOrder';
import { locale, datePattern, normalizeDate, parseNumber } from '../util/locale';
import { computeCalc, conditionMet } from '../pdf/logic';

/** Test mode input values, keyed by field name (fields with the same name share a value). */
const values = new Map<string, string | boolean>();

const FONT_STACK: Record<string, string> = {
  Helvetica: 'Helvetica, Arial, sans-serif',
  Times: '"Times New Roman", Times, serif',
  Courier: '"Courier New", Courier, monospace',
};

/** Tab order across all pages (same as in the export). */
function tabIndexMap(): Map<string, number> {
  const m = new Map<string, number>();
  let i = 1;
  for (const p of store.pages) {
    const a = store.analysis(p);
    const rot = (((a.baseRotate + p.rotation) % 360) + 360) % 360;
    for (const f of sortForTabOrder(store.fields.filter((x) => x.pageId === p.id), (x) => x.rect, rot)) m.set(f.id, i++);
  }
  return m;
}

export function renderTestOverlay(overlay: HTMLElement, fields: Field[], g: ViewGeom) {
  overlay.replaceChildren();
  const tabs = tabIndexMap();
  for (const f of fields) {
    const r = rectToScreen(g, f.rect);
    // Cover text that is hidden on export here as well (background color of the template)
    const cover = (f.hideText || f.extraHide.length) && f.bgColor ? `;--cover:${toHex(f.bgColor)}` : '';
    const box = h('div.test-field', { 'data-type': f.type, 'data-fid': f.id, class: cover ? 'covered' : undefined, style: `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px${cover}` });
    const color = toHex(f.type === 'reset' ? effectiveColor({ ...f, bgColor: f.buttonBg }) : effectiveColor(f));
    const autoSize = f.type === 'area' ? 10 * g.scale : Math.min(r.height * 0.62, 14 * g.scale);
    const size = f.fontSize ? f.fontSize * g.scale : autoSize;
    const font = `${f.italic ? 'italic ' : ''}${f.bold ? '700 ' : '400 '}${size}px ${FONT_STACK[f.fontFamily] ?? FONT_STACK.Helvetica}`;
    const tab = String(tabs.get(f.id) ?? 0);
    const label = f.tooltip || f.name;

    if (f.type === 'text' || f.type === 'area') {
      const el = f.type === 'area'
        ? h<HTMLTextAreaElement>('textarea', {})
        : h<HTMLInputElement>('input', { type: 'text', inputmode: f.format === 'number' || (f.format === 'zip' && store.options.locale !== 'uk') ? 'decimal' : f.format === 'phone' ? 'tel' : f.format === 'email' ? 'email' : undefined });
      el.value = String(values.get(f.name) ?? '');
      el.placeholder = f.placeholder;
      el.tabIndex = +tab;
      el.dataset.fname = f.name;
      el.setAttribute('aria-label', label);
      if (f.maxLength > 0) el.maxLength = f.maxLength;
      if (f.required) el.required = true;
      if (f.calc) { el.readOnly = true; el.classList.add('calc'); }
      Object.assign(el.style, { font, color, textAlign: f.align });
      if (f.type === 'text' && f.comb && f.maxLength > 0) {
        // One box per character: monospace font, spacing to the box width
        el.classList.add('comb');
        el.style.fontFamily = FONT_STACK.Courier;
        el.style.setProperty('--cell', `${r.width / f.maxLength}px`);
        el.style.setProperty('--cells', String(f.maxLength));
      }
      el.addEventListener('beforeinput', (e) => {
        const ev = e as InputEvent;
        if (!ev.data) return;
        const allowed = { phone: /^[0-9+()\/\-\s]*$/, zip: new RegExp(locale(store.options.locale).zipKeys), number: /^[0-9.,'\-\s]*$/, date: /^[0-9./-]*$/ }[f.format as 'phone'];
        if (allowed && !allowed.test(ev.data)) e.preventDefault();
      });
      el.addEventListener('input', () => sync(f.name, el.value, el));
      el.addEventListener('blur', () => validate(f, el));
      box.append(el);
    } else if (f.type === 'dropdown') {
      const el = h<HTMLSelectElement>('select', {}, h('option', { value: '' }, ''), ...(f.choices ?? []).filter((c) => c.trim()).map((c) => h('option', { value: c }, c)));
      el.value = String(values.get(f.name) ?? '');
      el.tabIndex = +tab;
      el.dataset.fname = f.name;
      el.setAttribute('aria-label', label);
      if (f.required) el.required = true;
      Object.assign(el.style, { font, color });
      el.addEventListener('change', () => sync(f.name, el.value, el));
      box.append(el);
    } else if (f.type === 'check' || f.type === 'radio') {
      const el = h<HTMLInputElement>('input', { type: f.type === 'check' ? 'checkbox' : 'radio' });
      el.name = f.type === 'radio' ? `t_${f.name}` : '';
      el.tabIndex = +tab;
      el.dataset.fname = f.name;
      el.setAttribute('aria-label', f.type === 'radio' ? `${label}: ${f.radioValue}` : label);
      el.checked = f.type === 'check' ? values.get(f.name) === true : values.get(f.name) === f.radioValue;
      el.style.setProperty('--tick', color);
      el.addEventListener('change', () => {
        if (f.type === 'check') sync(f.name, el.checked, el);
        else { values.set(f.name, f.radioValue); refreshLogic(); }
      });
      box.append(el);
    } else {
      const btn = h<HTMLButtonElement>('button', { type: 'button', style: `font:${font};color:${color};background:${toHex(f.buttonBg)}` }, f.label || 'Reset');
      btn.tabIndex = +tab;
      btn.addEventListener('click', () => {
        if (f.buttonAction === 'email') { toast(`In Acrobat this opens an email to ${f.mailTo || '(no address)'} with the filled form attached.`); return; }
        values.clear(); store.emit('mode');
      });
      box.append(btn);
    }
    overlay.append(box);
    // Tag text outside the field (e.g. next to a checkbox) is hidden on export, so cover it here too
    if (f.bgColor) for (const x of f.extraHide) {
      const inside = x.x >= f.rect.x && x.y >= f.rect.y && x.x + x.w <= f.rect.x + f.rect.w && x.y + x.h <= f.rect.y + f.rect.h;
      if (inside) continue;
      const c = rectToScreen(g, x);
      overlay.prepend(h('div.test-cover', { 'aria-hidden': 'true', style: `left:${c.left}px;top:${c.top}px;width:${c.width}px;height:${c.height}px;background:${toHex(f.bgColor)}` }));
    }
  }
  queueMicrotask(refreshLogic);
}

/** Recalculates calculated fields and shows/hides conditional fields, like Acrobat does. */
function refreshLogic() {
  if (!store.testMode) return;
  const loc = locale(store.options.locale);
  const num = (name: string) => { const n = parseNumber(String(values.get(name) ?? ''), loc); return isNaN(n) ? 0 : n; };
  const calcs = store.fields.filter((f) => f.calc && f.type === 'text');
  for (let pass = 0; pass < 3; pass++) for (const f of calcs) {
    const r = computeCalc(f, num);
    const text = r === null || !isFinite(r) ? '' : f.format === 'number'
      ? r.toLocaleString(loc.intl, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : String(Math.round(r * 100) / 100);
    values.set(f.name, text);
  }
  for (const f of calcs) document.querySelectorAll<HTMLInputElement>(`[data-fname="${CSS.escape(f.name)}"]`).forEach((el) => { el.value = String(values.get(f.name) ?? ''); });
  for (const f of store.fields) {
    const box = document.querySelector<HTMLElement>(`.test-field[data-fid="${CSS.escape(f.id)}"]`);
    if (box) box.hidden = !conditionMet(f, (n) => values.get(n));
  }
}

function sync(name: string, v: string | boolean, from: HTMLElement) {
  values.set(name, v);
  refreshLogic();
  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[data-fname="${CSS.escape(name)}"]`).forEach((el) => {
    if (el === from) return;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = v === true;
    else if (typeof v === 'string') el.value = v;
  });
}

const message = (format: string): string => ({
  email: 'Please enter a valid email address.',
  phone: 'Please enter a valid phone number.',
  zip: 'Please enter a valid postal code.',
  date: `Please enter a date as ${datePattern(locale(store.options.locale))}.`,
  number: 'Please enter a number.',
} as Record<string, string>)[format] ?? 'Invalid input.';

/** Validates and formats like the Acrobat scripts in the export. */
function validate(f: Field, el: HTMLInputElement | HTMLTextAreaElement) {
  let v = el.value.trim();
  let ok = true;
  const loc = locale(store.options.locale);
  if (v) {
    switch (f.format) {
      case 'email': ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); break;
      case 'phone': ok = /^[+]?[0-9()\/\-\s]{5,}$/.test(v); break;
      case 'zip': ok = new RegExp(loc.zip).test(v); break;
      case 'date': {
        const d = normalizeDate(v, loc);
        ok = d !== null;
        if (d) v = d;
        break;
      }
      case 'number': {
        const n = parseNumber(v, loc);
        ok = !isNaN(n);
        if (ok) v = n.toLocaleString(loc.intl, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        break;
      }
    }
  }
  if (ok && v !== el.value) { el.value = v; sync(f.name, v, el); }
  const box = el.parentElement!;
  box.classList.toggle('invalid', !ok);
  box.querySelector('.test-msg')?.remove();
  if (!ok) box.append(h('span.test-msg', { role: 'alert' }, message(f.format)));
}

/* ------------------------------------------------------------------ */
/* Panel in the properties area                                        */
/* ------------------------------------------------------------------ */

export function mountTestPanel(inspector: HTMLElement) {
  const panel = h('div.panel.side-panel.test-panel');
  inspector.prepend(panel);
  const render = () => {
    inspector.classList.toggle('mode-test', store.testMode);
    panel.hidden = !store.testMode;
    if (!store.testMode) return;
    const missing = store.fields.filter((f) => f.required && !values.get(f.name)).length;
    const clear = h('button.btn.secondary', { type: 'button', onclick: () => { values.clear(); store.emit('mode'); } }, 'Clear inputs');
    const done = h('button.btn.primary', { type: 'button', onclick: () => store.setTestMode(false) }, 'Back to editing');
    panel.replaceChildren(
      h('h2.panel-title', {}, 'Test the form'),
      h('p.panel-lead', {}, 'Fill in the form the way it will work in a PDF reader. Press Tab to move from field to field in the calculated order.'),
      h('ul.test-notes', {},
        h('li', {}, 'Formats like date, email or number are checked when you leave a field.'),
        h('li', {}, 'Fields with the same name show the same content.'),
        h('li', {}, missing ? `${missing} required ${missing === 1 ? 'field is' : 'fields are'} still empty.` : 'All required fields are filled in.')),
      h('p.hint', {}, 'Your inputs are not included in the exported PDF.'),
      h('div.panel-actions', {}, clear, done));
  };
  store.subscribe((k) => { if (k.has('mode') || k.has('doc')) render(); });
  document.addEventListener('change', () => { if (store.testMode) render(); });
  render();
}
