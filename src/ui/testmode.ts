import { store } from '../state';
import type { Field } from '../types';
import { h } from './dom';
import { rectToScreen, type ViewGeom } from '../util/geom';
import { effectiveColor, toHex } from '../util/color';
import { sortForTabOrder } from '../util/tabOrder';

/** Eingaben im Testmodus, je Feldname (gleichnamige Felder teilen sich den Wert). */
const values = new Map<string, string | boolean>();

const FONT_STACK: Record<string, string> = {
  Helvetica: 'Helvetica, Arial, sans-serif',
  Times: '"Times New Roman", Times, serif',
  Courier: '"Courier New", Courier, monospace',
};

/** Tab-Reihenfolge über alle Seiten (wie im Export). */
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
    // Text, der im Export ausgeblendet wird, auch hier abdecken (Hintergrundfarbe der Vorlage)
    const cover = (f.hideText || f.extraHide.length) && f.bgColor ? `;--cover:${toHex(f.bgColor)}` : '';
    const box = h('div.test-field', { 'data-type': f.type, class: cover ? 'covered' : undefined, style: `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px${cover}` });
    const color = toHex(f.type === 'reset' ? effectiveColor({ ...f, bgColor: f.buttonBg }) : effectiveColor(f));
    const autoSize = f.type === 'area' ? 10 * g.scale : Math.min(r.height * 0.62, 14 * g.scale);
    const size = f.fontSize ? f.fontSize * g.scale : autoSize;
    const font = `${f.italic ? 'italic ' : ''}${f.bold ? '700 ' : '400 '}${size}px ${FONT_STACK[f.fontFamily] ?? FONT_STACK.Helvetica}`;
    const tab = String(tabs.get(f.id) ?? 0);
    const label = f.tooltip || f.name;

    if (f.type === 'text' || f.type === 'area') {
      const el = f.type === 'area'
        ? h<HTMLTextAreaElement>('textarea', {})
        : h<HTMLInputElement>('input', { type: 'text', inputmode: f.format === 'number' || f.format === 'zip' ? 'decimal' : f.format === 'phone' ? 'tel' : f.format === 'email' ? 'email' : undefined });
      el.value = String(values.get(f.name) ?? '');
      el.placeholder = f.placeholder;
      el.tabIndex = +tab;
      el.dataset.fname = f.name;
      el.setAttribute('aria-label', label);
      if (f.maxLength > 0) el.maxLength = f.maxLength;
      if (f.required) el.required = true;
      Object.assign(el.style, { font, color, textAlign: f.align });
      el.addEventListener('beforeinput', (e) => {
        const ev = e as InputEvent;
        if (!ev.data) return;
        const allowed = { phone: /^[0-9+()\/\-\s]*$/, zip: /^[0-9]*$/, number: /^[0-9.,\-]*$/, date: /^[0-9.]*$/ }[f.format as 'phone'];
        if (allowed && !allowed.test(ev.data)) e.preventDefault();
      });
      el.addEventListener('input', () => sync(f.name, el.value, el));
      el.addEventListener('blur', () => validate(f, el));
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
        else { values.set(f.name, f.radioValue); }
      });
      box.append(el);
    } else {
      const btn = h<HTMLButtonElement>('button', { type: 'button', style: `font:${font};color:${color};background:${toHex(f.buttonBg)}` }, f.label || 'Zurücksetzen');
      btn.tabIndex = +tab;
      btn.addEventListener('click', () => { values.clear(); store.emit('mode'); });
      box.append(btn);
    }
    overlay.append(box);
  }
}

function sync(name: string, v: string | boolean, from: HTMLElement) {
  values.set(name, v);
  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(`[data-fname="${CSS.escape(name)}"]`).forEach((el) => {
    if (el === from) return;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = v === true;
    else if (typeof v === 'string') el.value = v;
  });
}

const MSG: Record<string, string> = {
  email: 'Bitte eine gültige E-Mail-Adresse eingeben.',
  phone: 'Bitte eine gültige Telefonnummer eingeben.',
  zip: 'Bitte eine gültige Postleitzahl eingeben.',
  date: 'Bitte ein Datum im Format TT.MM.JJJJ eingeben.',
  number: 'Bitte eine Zahl eingeben.',
};

/** Prüft und formatiert wie die Acrobat-Skripte im Export. */
function validate(f: Field, el: HTMLInputElement | HTMLTextAreaElement) {
  let v = el.value.trim();
  let ok = true;
  if (v) {
    switch (f.format) {
      case 'email': ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); break;
      case 'phone': ok = /^[+]?[0-9()\/\-\s]{5,}$/.test(v); break;
      case 'zip': ok = /^[0-9]{4,5}$/.test(v); break;
      case 'date': {
        const m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(v);
        if (m) {
          const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
          const d = new Date(y, +m[2] - 1, +m[1]);
          ok = d.getDate() === +m[1] && d.getMonth() === +m[2] - 1;
          if (ok) v = `${m[1].padStart(2, '0')}.${m[2].padStart(2, '0')}.${y}`;
        } else ok = false;
        break;
      }
      case 'number': {
        const n = Number(v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v);
        ok = !isNaN(n);
        if (ok) v = n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        break;
      }
    }
  }
  if (ok && v !== el.value) { el.value = v; sync(f.name, v, el); }
  const box = el.parentElement!;
  box.classList.toggle('invalid', !ok);
  box.querySelector('.test-msg')?.remove();
  if (!ok) box.append(h('span.test-msg', { role: 'alert' }, MSG[f.format] ?? 'Ungültige Eingabe.'));
}

/* ------------------------------------------------------------------ */
/* Panel im Eigenschaften-Bereich                                      */
/* ------------------------------------------------------------------ */

export function mountTestPanel(inspector: HTMLElement) {
  const panel = h('div.panel.side-panel.test-panel');
  inspector.prepend(panel);
  const render = () => {
    inspector.classList.toggle('mode-test', store.testMode);
    panel.hidden = !store.testMode;
    if (!store.testMode) return;
    const missing = store.fields.filter((f) => f.required && !values.get(f.name)).length;
    const clear = h('button.btn.secondary', { type: 'button', onclick: () => { values.clear(); store.emit('mode'); } }, 'Eingaben leeren');
    const done = h('button.btn.primary', { type: 'button', onclick: () => store.setTestMode(false) }, 'Zurück zum Bearbeiten');
    panel.replaceChildren(
      h('h2.panel-title', {}, 'Formular testen'),
      h('p.panel-lead', {}, 'Fülle das Formular so aus, wie es später im PDF-Reader funktioniert. Mit Tab springst du in der berechneten Reihenfolge von Feld zu Feld.'),
      h('ul.test-notes', {},
        h('li', {}, 'Formate wie Datum, E-Mail oder Zahl werden beim Verlassen eines Feldes geprüft.'),
        h('li', {}, 'Gleichnamige Felder zeigen denselben Inhalt.'),
        h('li', {}, missing ? `${missing} Pflichtfeld${missing === 1 ? '' : 'er'} noch leer.` : 'Alle Pflichtfelder sind ausgefüllt.')),
      h('p.hint', {}, 'Die Eingaben werden nicht in die exportierte PDF übernommen.'),
      h('div.panel-actions', {}, clear, done));
  };
  store.subscribe((k) => { if (k.has('mode') || k.has('doc')) render(); });
  document.addEventListener('change', () => { if (store.testMode) render(); });
  render();
}
