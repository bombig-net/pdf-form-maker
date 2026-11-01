import { store, type ChangeKind } from '../state';
import type { Field, FieldType, FormatKind, RGB } from '../types';
import { h, icons, toast } from './dom';
import { effectiveColor, fromHex, toHex } from '../util/color';
import { uid, round2 } from '../util/geom';
import type { Viewer } from './viewer';

const TYPES: { v: FieldType; label: string }[] = [
  { v: 'text', label: 'Textfeld' },
  { v: 'area', label: 'Textbereich (mehrzeilig)' },
  { v: 'check', label: 'Checkbox' },
  { v: 'radio', label: 'Radio-Button' },
  { v: 'reset', label: 'Zurücksetzen-Button' },
];
const FORMATS: { v: FormatKind; label: string; hint: string }[] = [
  { v: 'none', label: 'Freitext', hint: '' },
  { v: 'email', label: 'E-Mail', hint: 'Prüft beim Verlassen des Feldes auf eine gültige Adresse.' },
  { v: 'date', label: 'Datum', hint: 'Format TT.MM.JJJJ – Acrobat Reader zeigt auf Mobilgeräten einen Kalender.' },
  { v: 'phone', label: 'Telefon', hint: 'Erlaubt nur Ziffern, Leerzeichen und + ( ) / -.' },
  { v: 'number', label: 'Zahl', hint: 'Zahl mit zwei Nachkommastellen (1.234,56).' },
  { v: 'zip', label: 'Postleitzahl', hint: 'Nur Ziffern, 4–5 Stellen.' },
];

export class Inspector {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private shownId: string | null | undefined = undefined;

  constructor(host: HTMLElement, private viewer: Viewer) {
    this.el = host;
    this.body = h('div.inspector-body');
    host.append(this.body);
    store.subscribe((k) => this.onChange(k));
    document.addEventListener('focus-inspector', () => {
      this.el.classList.add('open');
      (this.body.querySelector('input[name="name"]') as HTMLInputElement | null)?.focus();
    });
  }

  private onChange(k: Set<ChangeKind>) {
    const id = store.selectedId;
    if (k.has('selection') || k.has('doc') || this.shownId !== id || (!id && (k.has('fields') || k.has('pages') || k.has('options')))) {
      this.render();
    } else if (k.has('fields') && id) {
      if (!store.selected) this.render(); else this.refreshValues();
    }
  }

  private render() {
    this.shownId = store.selectedId;
    const f = store.selected;
    this.body.replaceChildren(f ? this.fieldPanel(f) : this.docPanel());
    this.el.classList.toggle('has-selection', !!f);
  }

  /* ---------------- Dokument-Übersicht ---------------- */

  private docPanel(): HTMLElement {
    const wrap = h('div.panel');
    const counts: Record<string, number> = {};
    for (const f of store.fields) counts[f.type] = (counts[f.type] ?? 0) + 1;
    const total = store.fields.length;
    wrap.append(h('h2.panel-title', {}, 'Formular'));
    wrap.append(h('p.panel-lead', {}, total
      ? `${total} ${total === 1 ? 'Feld' : 'Felder'} auf ${store.pages.length} ${store.pages.length === 1 ? 'Seite' : 'Seiten'}.`
      : 'Noch keine Felder. Wähle oben ein Werkzeug und zieh ein Feld auf der Seite auf.'));

    // Liste nach Seiten
    if (total) {
      const list = h('div.field-list');
      store.pages.forEach((p, i) => {
        const fs = store.fields.filter((f) => f.pageId === p.id);
        if (!fs.length) return;
        list.append(h('div.field-list-page', {}, `Seite ${i + 1}`));
        for (const f of fs) {
          list.append(h('button.field-row', {
            type: 'button', 'data-type': f.type,
            onclick: () => { store.select(f.id); this.viewer.scrollToField(f.id); },
          }, h('span.dot'), h('span.field-row-name', {}, f.type === 'radio' ? `${f.name} · ${f.radioValue}` : f.type === 'reset' ? f.label : f.name),
          h('span.field-row-src', {}, f.source === 'layer' ? 'Ebene' : f.source === 'tag' ? 'Tag' : f.source === 'import' ? 'vorhanden' : '')));
        }
      });
      wrap.append(list);
    }

    wrap.append(h('h3.section-title', {}, 'Optionen'));
    wrap.append(this.toggle('Tab-Reihenfolge anzeigen', store.options.showTabOrder, (v) => { store.options.showTabOrder = v; store.emit('options'); },
      'Die Reihenfolge wird automatisch von links oben nach rechts unten berechnet.'));
    wrap.append(this.toggle('Einrasten an Linien und Feldern', store.options.snap, (v) => { store.options.snap = v; store.emit('options'); },
      'Beim Ziehen Alt gedrückt halten, um das Einrasten kurz zu umgehen.'));
    wrap.append(this.toggle('Platzhalter-Ebenen im Export ausblenden', store.options.hidePlaceholderLayers, (v) => { store.options.hidePlaceholderLayers = v; store.emit('options'); },
      'Schaltet Ebenen mit Namen wie [Form_Text_…] in der fertigen PDF unsichtbar.'));

    wrap.append(h('h3.section-title', {}, 'Kurzbefehle'));
    wrap.append(h('dl.shortcuts', {},
      ...[['V', 'Auswählen'], ['T / A', 'Textfeld / Textbereich'], ['C / R', 'Checkbox / Radio'], ['⇧ Klick', 'Mehrere Felder auswählen'], ['Ziehen', 'Auswahlrahmen auf leerer Fläche'], ['Entf', 'Auswahl löschen'], ['Pfeile', 'Verschieben (⇧ = 10 pt)'], ['⌘/Strg C / V', 'Kopieren und einfügen'], ['⌘/Strg A', 'Alle Felder der Seite'], ['⌘/Strg D', 'Feld duplizieren'], ['⌘/Strg Z', 'Rückgängig'], ['⌘/Strg E', 'Formular testen']]
        .flatMap(([k, v]) => [h('dt', {}, h('kbd', {}, k)), h('dd', {}, v)])));
    return wrap;
  }

  /* ---------------- Feld-Eigenschaften ---------------- */

  private fieldPanel(f: Field): HTMLElement {
    const wrap = h('div.panel', { 'data-type': f.type });
    const close = h('button.icon-btn', { type: 'button', 'aria-label': 'Auswahl aufheben', title: 'Schließen', onclick: () => store.select(null) });
    close.innerHTML = icons.close;
    wrap.append(h('div.panel-head', {}, h('span.type-dot'), h('h2.panel-title', {}, TYPES.find((t) => t.v === f.type)!.label), close));

    const set = <K extends keyof Field>(key: K, val: Field[K], kinds: ChangeKind[] = ['fields']) => {
      const fid = f.id;
      store.commit(() => {
        const ff = store.fields.find((x) => x.id === fid);
        if (ff) ff[key] = val;
      }, kinds, `${fid}:${String(key)}`);
    };
    /** Eigenschaften, die für alle gleichnamigen Felder gelten (ein PDF-Feld). */
    const setShared = <K extends keyof Field>(key: K, val: Field[K]) => {
      const fid = f.id;
      store.commit(() => {
        const ff = store.fields.find((x) => x.id === fid);
        if (!ff) return;
        for (const x of store.fields) if (x.name === ff.name && x.type === ff.type) x[key] = val;
      }, ['fields'], `${fid}:${String(key)}`);
    };

    // Typ
    const typeSel = h<HTMLSelectElement>('select', { name: 'type', onchange: (e: Event) => {
      const t = (e.target as HTMLSelectElement).value as FieldType;
      const fid = f.id;
      store.commit(() => {
        const ff = store.fields.find((x) => x.id === fid)!;
        ff.type = t;
        if (t === 'radio' && !ff.radioValue) ff.radioValue = 'Option1';
        if (t === 'reset' && !ff.label) ff.label = 'Formular zurücksetzen';
        if (t === 'area' && !ff.fontSize) ff.fontSize = 10;
      }, ['fields', 'selection']);
      this.render();
    } }, ...TYPES.map((t) => h('option', { value: t.v, selected: t.v === f.type }, t.label)));
    wrap.append(this.row('Typ', typeSel));

    // Name
    const nameLabel = f.type === 'radio' ? 'Gruppe' : 'Feldname';
    const nameIn = this.input('name', f.name, (v) => set('name', v.replace(/[.\s]+/g, '_')));
    wrap.append(this.row(nameLabel, nameIn));
    const syncInfo = h('p.hint.sync-info');
    wrap.append(syncInfo);
    if (f.type === 'radio') wrap.append(this.row('Wert', this.input('radioValue', f.radioValue, (v) => set('radioValue', v.replace(/[.\s]+/g, '_')))));
    if (f.type === 'reset') wrap.append(this.row('Beschriftung', this.input('label', f.label, (v) => set('label', v))));

    // Eingabe
    if (f.type === 'text' || f.type === 'area') {
      wrap.append(h('h3.section-title', {}, 'Eingabe'));
      if (f.type === 'text') {
        const chips = h('div.chips', { role: 'radiogroup', 'aria-label': 'Verwendungszweck' });
        const hint = h('p.hint', {}, FORMATS.find((x) => x.v === f.format)?.hint ?? '');
        for (const fm of FORMATS) {
          chips.append(h('button.chip', {
            type: 'button', role: 'radio', 'aria-checked': String(fm.v === f.format),
            onclick: () => { setShared('format', fm.v); this.render(); },
          }, fm.label));
        }
        wrap.append(this.row('Zweck', chips), hint);
      }
      wrap.append(this.row('Platzhalter', this.input('placeholder', f.placeholder, (v) => setShared('placeholder', v), 'Grauer Hinweistext, verschwindet beim Tippen')));
      const al = h('div.segmented', { role: 'radiogroup', 'aria-label': 'Ausrichtung' });
      for (const [v, l] of [['left', 'Links'], ['center', 'Mitte'], ['right', 'Rechts']] as const) {
        al.append(h('button', { type: 'button', role: 'radio', 'aria-checked': String(f.align === v), onclick: () => { setShared('align', v); this.render(); } }, l));
      }
      wrap.append(this.row('Ausrichtung', al));
      wrap.append(this.row('Max. Zeichen', this.number('maxLength', f.maxLength, (v) => setShared('maxLength', Math.max(0, Math.round(v))), 0, 1, '0 = unbegrenzt')));
    }
    if (f.type !== 'reset') {
      wrap.append(this.toggle('Pflichtfeld', f.required, (v) => setShared('required', v)));
    }
    wrap.append(this.toggle('Text darunter ausblenden', f.hideText, (v) => set('hideText', v),
      'Statischer Text aus der Vorlage im Feldbereich wird im Export unsichtbar.'));

    // Schrift
    if (f.type !== 'check' && f.type !== 'radio') {
      wrap.append(h('h3.section-title', {}, 'Schrift'));
      const fam = h<HTMLSelectElement>('select', { name: 'fontFamily', onchange: async (e: Event) => {
        const v = (e.target as HTMLSelectElement).value;
        if (v === '__upload') { (e.target as HTMLSelectElement).value = f.fontFamily; await this.uploadFont(f); return; }
        setShared('fontFamily', v);
      } },
        h('option', { value: 'Helvetica', selected: f.fontFamily === 'Helvetica' }, 'Helvetica (Sans)'),
        h('option', { value: 'Times', selected: f.fontFamily === 'Times' }, 'Times (Serif)'),
        h('option', { value: 'Courier', selected: f.fontFamily === 'Courier' }, 'Courier (Mono)'),
        ...store.customFonts.map((c) => h('option', { value: 'custom:' + c.id, selected: f.fontFamily === 'custom:' + c.id }, c.name)),
        h('option', { value: '__upload' }, 'Eigene Schrift laden …'),
      );
      wrap.append(this.row('Familie', fam));
      const style = h('div.segmented', {},
        h('button', { type: 'button', 'aria-pressed': String(f.bold), onclick: () => { setShared('bold', !f.bold); this.render(); }, style: 'font-weight:700' }, 'Fett'),
        h('button', { type: 'button', 'aria-pressed': String(f.italic), onclick: () => { setShared('italic', !f.italic); this.render(); }, style: 'font-style:italic' }, 'Kursiv'));
      if (!f.fontFamily.startsWith('custom:')) wrap.append(this.row('Stil', style));
      wrap.append(this.row('Größe', this.number('fontSize', f.fontSize || 0, (v) => setShared('fontSize', Math.max(0, Math.min(144, v))), 0, 0.5, '0 = automatisch'), 'pt'));
    }
    const colorIn = h<HTMLInputElement>('input', { type: 'color', name: 'color', value: toHex(f.color), oninput: (e: Event) => setShared('color', fromHex((e.target as HTMLInputElement).value)) });
    const eff = h('span.effective', { title: 'Tatsächlich verwendete Farbe' }, h('span.swatch'), h('span.eff-note'));
    wrap.append(this.row(f.type === 'check' || f.type === 'radio' ? 'Farbe Haken' : 'Textfarbe', h('div.color-row', {}, colorIn, eff)));
    if (f.type === 'reset') {
      wrap.append(this.row('Hintergrund', h<HTMLInputElement>('input', { type: 'color', name: 'buttonBg', value: toHex(f.buttonBg), oninput: (e: Event) => set('buttonBg', fromHex((e.target as HTMLInputElement).value)) })));
    }
    wrap.append(this.toggle('Smart Contrast', f.autoContrast, (v) => setShared('autoContrast', v),
      'Wählt automatisch Schwarz oder Weiß, wenn die Farbe auf dem Hintergrund schlecht lesbar wäre.'));

    // Position
    wrap.append(h('h3.section-title', {}, 'Position (pt)'));
    const grid = h('div.pos-grid');
    for (const [k, l] of [['x', 'X'], ['y', 'Y'], ['w', 'Breite'], ['h', 'Höhe']] as const) {
      grid.append(h('label.pos', {}, h('span', {}, l), this.number('rect.' + k, f.rect[k], (v) => {
        const fid = f.id;
        store.commit(() => { const ff = store.fields.find((x) => x.id === fid); if (ff) ff.rect = { ...ff.rect, [k]: k === 'w' || k === 'h' ? Math.max(2, v) : v }; }, ['fields'], `${fid}:rect.${k}`);
      }, undefined, 0.5)));
    }
    wrap.append(grid);
    wrap.append(this.row('Tooltip', this.input('tooltip', f.tooltip, (v) => set('tooltip', v), 'Hilfetext beim Überfahren')));

    // Aktionen
    const dup = h('button.btn.secondary', { type: 'button', onclick: () => duplicateField(f.id) }, 'Duplizieren');
    const del = h('button.btn.danger', { type: 'button', onclick: () => deleteField(f.id) });
    del.innerHTML = `${icons.trash}<span>Löschen</span>`;
    wrap.append(h('div.panel-actions', {}, dup, del));

    queueMicrotask(() => this.refreshValues());
    return wrap;
  }

  /** Werte aktualisieren ohne Neuaufbau (z. B. beim Verschieben), fokussierte Eingaben bleiben unberührt. */
  private refreshValues() {
    const f = store.selected;
    if (!f) return;
    const setVal = (name: string, v: string) => {
      const el = this.body.querySelector<HTMLInputElement>(`[name="${name}"]`);
      if (el && document.activeElement !== el && el.value !== v) el.value = v;
    };
    setVal('rect.x', String(round2(f.rect.x))); setVal('rect.y', String(round2(f.rect.y)));
    setVal('rect.w', String(round2(f.rect.w))); setVal('rect.h', String(round2(f.rect.h)));
    setVal('name', f.name);
    const eff = this.body.querySelector<HTMLElement>('.effective');
    if (eff) {
      const c: RGB = f.type === 'reset' ? effectiveColor({ ...f, bgColor: f.buttonBg }) : effectiveColor(f);
      const changed = toHex(c) !== toHex(f.color);
      const sw = eff.querySelector<HTMLElement>('.swatch')!;
      sw.style.background = toHex(c);
      sw.style.setProperty('--bg', f.type === 'reset' ? toHex(f.buttonBg) : f.bgColor ? toHex(f.bgColor) : '#fff');
      eff.querySelector<HTMLElement>('.eff-note')!.textContent = 'Smart Contrast aktiv';
      eff.hidden = !changed;
    }
    const sync = this.body.querySelector<HTMLElement>('.sync-info');
    if (sync) {
      const others = store.fields.filter((x) => x.id !== f.id && x.name === f.name && x.type === f.type);
      if (f.type === 'radio') sync.textContent = others.length ? `Gruppe mit ${others.length + 1} Optionen.` : 'Weitere Radio-Buttons mit gleicher Gruppe bilden eine Auswahl.';
      else if (others.length) {
        const pages = [...new Set(others.map((x) => store.pageNumber(x.pageId)))].sort((a, b) => a - b);
        sync.textContent = `Synchronisiert mit ${others.length} weiteren ${others.length === 1 ? 'Feld' : 'Feldern'} (Seite ${pages.join(', ')}). Eingaben erscheinen überall.`;
      } else sync.textContent = '';
      const clash = store.fields.some((x) => x.name === f.name && x.type !== f.type && f.type !== 'reset' && x.type !== 'reset');
      if (clash) sync.textContent = 'Dieser Name wird bereits für einen anderen Feldtyp verwendet und erhält beim Export ein Suffix.';
    }
  }

  private async uploadFont(f: Field) {
    const inp = h<HTMLInputElement>('input', { type: 'file', accept: '.ttf,.otf,font/ttf,font/otf' });
    inp.onchange = async () => {
      const file = inp.files?.[0];
      if (!file) return;
      if (!/\.(ttf|otf)$/i.test(file.name)) { toast('Bitte eine TTF- oder OTF-Datei wählen.', 'warn'); return; }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const cf = { id: uid('font'), name: file.name.replace(/\.(ttf|otf)$/i, ''), bytes };
      store.customFonts.push(cf);
      const fid = f.id;
      store.commit(() => {
        const ff = store.fields.find((x) => x.id === fid);
        if (ff) for (const x of store.fields) if (x.name === ff.name && x.type === ff.type) x.fontFamily = 'custom:' + cf.id;
      });
      this.render();
      toast(`Schrift „${cf.name}“ wird beim Export vollständig eingebettet.`);
    };
    inp.click();
  }

  /* ---------------- Formular-Bausteine ---------------- */

  private row(label: string, control: HTMLElement, suffix?: string): HTMLElement {
    const id = uid('in');
    const c = control.matches('input,select,textarea') ? control : control.querySelector('input,select,textarea');
    if (c && !c.id) c.id = id;
    return h('div.row', {}, h('label', { for: c?.id ?? id }, label), h('div.row-control', {}, control, suffix ? h('span.suffix', {}, suffix) : null));
  }
  private input(name: string, value: string, on: (v: string) => void, placeholder?: string): HTMLInputElement {
    return h<HTMLInputElement>('input', { type: 'text', name, value, placeholder, autocomplete: 'off', spellcheck: 'false', oninput: (e: Event) => on((e.target as HTMLInputElement).value) });
  }
  private number(name: string, value: number, on: (v: number) => void, min?: number, step = 1, title?: string): HTMLInputElement {
    return h<HTMLInputElement>('input', {
      type: 'number', name, value: (name === 'maxLength' || name === 'fontSize') && !value ? '' : String(round2(value)), min, step, title, inputmode: 'decimal',
      placeholder: name === 'maxLength' ? 'unbegrenzt' : name === 'fontSize' ? 'auto' : undefined,
      oninput: (e: Event) => { const raw = (e.target as HTMLInputElement).value.replace(',', '.'); const v = raw === '' ? 0 : parseFloat(raw); if (!isNaN(v)) on(v); },
    });
  }
  private toggle(label: string, value: boolean, on: (v: boolean) => void, hint?: string): HTMLElement {
    const id = uid('t');
    return h('div.toggle-row', {},
      h('input', { type: 'checkbox', id, role: 'switch', checked: value, onchange: (e: Event) => on((e.target as HTMLInputElement).checked) }),
      h('label', { for: id }, label),
      hint ? h('p.hint', {}, hint) : null);
  }
}

export function deleteField(id: string) {
  store.commit(() => { store.fields = store.fields.filter((f) => f.id !== id); store.selectedId = null; }, ['fields', 'selection']);
}

export function duplicateField(id: string) {
  const f = store.fields.find((x) => x.id === id);
  if (!f) return;
  const copy: Field = structuredClone(f);
  copy.id = uid('f');
  copy.rect = { ...f.rect, y: f.rect.y - f.rect.h - 8 };
  copy.extraHide = [];
  copy.source = 'manual';
  if (f.type === 'radio') {
    const n = store.fields.filter((x) => x.type === 'radio' && x.name === f.name).length + 1;
    copy.radioValue = `Option${n}`;
  } else if (f.type !== 'reset') {
    let n = 2;
    const base = f.name.replace(/_\d+$/, '');
    while (store.fields.some((x) => x.name === `${base}_${n}`)) n++;
    copy.name = `${base}_${n}`;
  }
  store.commit(() => { store.fields.push(copy); store.selectedId = copy.id; }, ['fields', 'selection']);
}
