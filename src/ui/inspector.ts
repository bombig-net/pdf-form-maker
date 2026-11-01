import { store, type ChangeKind } from '../state';
import type { Field, FieldType, FormatKind, RGB } from '../types';
import { h, icons, toast } from './dom';
import { effectiveColor, fromHex, toHex } from '../util/color';
import { uid, round2 } from '../util/geom';
import type { Viewer } from './viewer';
import { LOCALES, locale, datePattern, type LocaleId } from '../util/locale';
import { insertAddressBlock } from './extras';
import { saveProjectFile } from './recent';

const TYPES: { v: FieldType; label: string }[] = [
  { v: 'text', label: 'Text field' },
  { v: 'area', label: 'Text area (multi-line)' },
  { v: 'check', label: 'Checkbox' },
  { v: 'radio', label: 'Radio button' },
  { v: 'dropdown', label: 'Dropdown' },
  { v: 'reset', label: 'Reset button' },
];
const FORMATS: { v: FormatKind; label: string }[] = [
  { v: 'none', label: 'Free text' },
  { v: 'email', label: 'Email' },
  { v: 'date', label: 'Date' },
  { v: 'phone', label: 'Phone' },
  { v: 'number', label: 'Number' },
  { v: 'zip', label: 'Postal code' },
];
/** Hint for a format in the form's region. */
function formatHint(f: FormatKind): string {
  const l = locale(store.options.locale);
  switch (f) {
    case 'email': return 'Checks for a valid address when the field is left.';
    case 'date': return `Format ${datePattern(l)} (${l.label}). Acrobat Reader shows a date picker on mobile devices.`;
    case 'phone': return 'Allows only digits, spaces and + ( ) / -.';
    case 'number': return `Number with two decimals (${l.numberExample}).`;
    case 'zip': return l.zipHint;
    default: return '';
  }
}

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

  /* ---------------- Document overview ---------------- */

  private docPanel(): HTMLElement {
    const wrap = h('div.panel');
    const counts: Record<string, number> = {};
    for (const f of store.fields) counts[f.type] = (counts[f.type] ?? 0) + 1;
    const total = store.fields.length;
    wrap.append(h('h2.panel-title', {}, 'Form'));
    wrap.append(h('p.panel-lead', {}, total
      ? `${total} ${total === 1 ? 'field' : 'fields'} on ${store.pages.length} ${store.pages.length === 1 ? 'page' : 'pages'}.`
      : 'No fields yet. Pick a tool above and drag a field onto the page.'));

    // List by page
    if (total) {
      const list = h('div.field-list');
      store.pages.forEach((p, i) => {
        const fs = store.fields.filter((f) => f.pageId === p.id);
        if (!fs.length) return;
        list.append(h('div.field-list-page', {}, `Page ${i + 1}`));
        for (const f of fs) {
          list.append(h('button.field-row', {
            type: 'button', 'data-type': f.type,
            onclick: () => { store.select(f.id); this.viewer.scrollToField(f.id); },
          }, h('span.dot'), h('span.field-row-name', {}, f.type === 'radio' ? `${f.name} · ${f.radioValue}` : f.type === 'reset' ? f.label : f.name),
          h('span.field-row-src', {}, f.source === 'layer' ? 'Layer' : f.source === 'tag' ? 'Tag' : f.source === 'import' ? 'existing' : '')));
        }
      });
      wrap.append(list);
    }

    wrap.append(h('h3.section-title', {}, 'Insert'));
    const addr = h('button.btn.secondary', { type: 'button', onclick: () => insertAddressBlock(this.viewer) }, 'Address block');
    wrap.append(h('div.insert-row', {}, addr), h('p.hint', {}, 'Name, street, postal code, city, email and phone as ready-made fields on the current page.'));

    wrap.append(h('h3.section-title', {}, 'Project'));
    const save = h('button.btn.secondary', { type: 'button', onclick: () => saveProjectFile() }, 'Save project file');
    wrap.append(h('div.insert-row', {}, save), h('p.hint', {}, 'Downloads the PDF with all fields and settings as one file, to back it up or pass it on. Open it again from the home screen.'));

    wrap.append(h('h3.section-title', {}, 'Options'));
    const region = h<HTMLSelectElement>('select', { name: 'locale', onchange: (e: Event) => { store.options.locale = (e.target as HTMLSelectElement).value; store.emit('options'); } },
      ...(Object.keys(LOCALES) as LocaleId[]).map((id) => {
        const l = LOCALES[id];
        return h('option', { value: id, selected: id === store.options.locale }, `${l.label} \u00b7 ${datePattern(l)} \u00b7 ${l.numberExample}`);
      }));
    wrap.append(this.row('Region', region));
    wrap.append(h('p.hint', {}, 'Sets the date, number and postal code formats for this form.'));
    wrap.append(this.toggle('Show tab order', store.options.showTabOrder, (v) => { store.options.showTabOrder = v; store.emit('options'); },
      'The order is calculated automatically from top left to bottom right.'));
    wrap.append(this.toggle('Snap to lines and fields', store.options.snap, (v) => { store.options.snap = v; store.emit('options'); },
      'Hold Alt while dragging to bypass snapping temporarily.'));
    wrap.append(this.toggle('Hide placeholder layers on export', store.options.hidePlaceholderLayers, (v) => { store.options.hidePlaceholderLayers = v; store.emit('options'); },
      'Turns off layers named like [Form_Text_…] in the final PDF.'));

    wrap.append(h('h3.section-title', {}, 'Shortcuts'));
    wrap.append(h('dl.shortcuts', {},
      ...[['V', 'Select'], ['T / A', 'Text field / text area'], ['C / R', 'Checkbox / radio'], ['D', 'Dropdown'], ['⇧ Click', 'Select multiple fields'], ['Drag', 'Selection rectangle on empty space'], ['Del', 'Delete selection'], ['Arrows', 'Move (⇧ = 10 pt)'], ['⌘/Ctrl C / V', 'Copy and paste'], ['⌘/Ctrl A', 'All fields on the page'], ['⌘/Ctrl D', 'Duplicate field'], ['⌘/Ctrl Z', 'Undo'], ['⌘/Ctrl E', 'Test the form']]
        .flatMap(([k, v]) => [h('dt', {}, h('kbd', {}, k)), h('dd', {}, v)])));
    return wrap;
  }

  /* ---------------- Field properties ---------------- */

  private fieldPanel(f: Field): HTMLElement {
    const wrap = h('div.panel', { 'data-type': f.type });
    const close = h('button.icon-btn', { type: 'button', 'aria-label': 'Clear selection', title: 'Close', onclick: () => store.select(null) });
    close.innerHTML = icons.close;
    wrap.append(h('div.panel-head', {}, h('span.type-dot'), h('h2.panel-title', {}, TYPES.find((t) => t.v === f.type)!.label), close));

    const set = <K extends keyof Field>(key: K, val: Field[K], kinds: ChangeKind[] = ['fields']) => {
      const fid = f.id;
      store.commit(() => {
        const ff = store.fields.find((x) => x.id === fid);
        if (ff) ff[key] = val;
      }, kinds, `${fid}:${String(key)}`);
    };
    /** Properties shared by all fields with the same name (one PDF field). */
    const setShared = <K extends keyof Field>(key: K, val: Field[K]) => {
      const fid = f.id;
      store.commit(() => {
        const ff = store.fields.find((x) => x.id === fid);
        if (!ff) return;
        for (const x of store.fields) if (x.name === ff.name && x.type === ff.type) x[key] = val;
      }, ['fields'], `${fid}:${String(key)}`);
    };

    // Type
    const typeSel = h<HTMLSelectElement>('select', { name: 'type', onchange: (e: Event) => {
      const t = (e.target as HTMLSelectElement).value as FieldType;
      const fid = f.id;
      store.commit(() => {
        const ff = store.fields.find((x) => x.id === fid)!;
        ff.type = t;
        if (t === 'radio' && !ff.radioValue) ff.radioValue = 'Option1';
        if (t === 'reset' && !ff.label) ff.label = 'Reset form';
        if (t === 'area' && !ff.fontSize) ff.fontSize = 10;
        if (t === 'dropdown' && !ff.choices?.length) ff.choices = ['Option 1', 'Option 2', 'Option 3'];
      }, ['fields', 'selection']);
      this.render();
    } }, ...TYPES.map((t) => h('option', { value: t.v, selected: t.v === f.type }, t.label)));
    wrap.append(this.row('Type', typeSel));

    // Name
    const nameLabel = f.type === 'radio' ? 'Group' : 'Field name';
    const nameIn = this.input('name', f.name, (v) => set('name', v.replace(/[.\s]+/g, '_')));
    wrap.append(this.row(nameLabel, nameIn));
    const syncInfo = h('p.hint.sync-info');
    wrap.append(syncInfo);
    if (f.type === 'radio') wrap.append(this.row('Value', this.input('radioValue', f.radioValue, (v) => set('radioValue', v.replace(/[.\s]+/g, '_')))));
    if (f.type === 'reset') wrap.append(this.row('Caption', this.input('label', f.label, (v) => set('label', v))));

    // Input
    if (f.type === 'text' || f.type === 'area') {
      wrap.append(h('h3.section-title', {}, 'Input'));
      if (f.type === 'text') {
        const chips = h('div.chips', { role: 'radiogroup', 'aria-label': 'Purpose' });
        const hint = h('p.hint', {}, formatHint(f.format));
        for (const fm of FORMATS) {
          chips.append(h('button.chip', {
            type: 'button', role: 'radio', 'aria-checked': String(fm.v === f.format),
            onclick: () => { setShared('format', fm.v); this.render(); },
          }, fm.label));
        }
        wrap.append(this.row('Purpose', chips), hint);
      }
      wrap.append(this.row('Placeholder', this.input('placeholder', f.placeholder, (v) => setShared('placeholder', v), 'Gray hint text, disappears when typing')));
      const al = h('div.segmented', { role: 'radiogroup', 'aria-label': 'Alignment' });
      for (const [v, l] of [['left', 'Left'], ['center', 'Center'], ['right', 'Right']] as const) {
        al.append(h('button', { type: 'button', role: 'radio', 'aria-checked': String(f.align === v), onclick: () => { setShared('align', v); this.render(); } }, l));
      }
      wrap.append(this.row('Alignment', al));
      wrap.append(this.row('Max. length', this.number('maxLength', f.maxLength, (v) => setShared('maxLength', Math.max(0, Math.round(v))), 0, 1, '0 = unlimited')));
      if (f.type === 'text') {
        wrap.append(this.toggle('Comb (one box per character)', !!f.comb, (v) => {
          const fid = f.id;
          store.commit(() => {
            const ff = store.fields.find((x) => x.id === fid);
            if (!ff) return;
            for (const x of store.fields) if (x.name === ff.name && x.type === ff.type) {
              x.comb = v;
              if (v && !(x.maxLength > 0)) x.maxLength = x.format === 'zip' ? 5 : 10;
            }
          });
          this.render();
        }, 'Splits the field into equal boxes, e.g. for an IBAN, a postal code or a date. The number of boxes is the max. length.'));
      }
    }
    if (f.type === 'dropdown') {
      wrap.append(h('h3.section-title', {}, 'Options'));
      const ta = h<HTMLTextAreaElement>('textarea.choices', { name: 'choices', rows: 5, spellcheck: 'false', 'aria-label': 'Dropdown options, one per line',
        oninput: (e: Event) => setShared('choices', (e.target as HTMLTextAreaElement).value.split('\n')) });
      ta.value = (f.choices ?? []).join('\n');
      wrap.append(ta, h('p.hint', {}, 'One option per line, in the order they should appear.'));
    }
    if (f.type !== 'reset') {
      wrap.append(this.toggle('Required', f.required, (v) => setShared('required', v)));
    }
    wrap.append(this.toggle('Hide text underneath', f.hideText, (v) => set('hideText', v),
      'Static text from the template inside the field area becomes invisible on export.'));

    // Font
    if (f.type !== 'check' && f.type !== 'radio') {
      wrap.append(h('h3.section-title', {}, 'Font'));
      const fam = h<HTMLSelectElement>('select', { name: 'fontFamily', onchange: async (e: Event) => {
        const v = (e.target as HTMLSelectElement).value;
        if (v === '__upload') { (e.target as HTMLSelectElement).value = f.fontFamily; await this.uploadFont(f); return; }
        setShared('fontFamily', v);
      } },
        h('option', { value: 'Helvetica', selected: f.fontFamily === 'Helvetica' }, 'Helvetica (sans)'),
        h('option', { value: 'Times', selected: f.fontFamily === 'Times' }, 'Times (serif)'),
        h('option', { value: 'Courier', selected: f.fontFamily === 'Courier' }, 'Courier (mono)'),
        ...store.customFonts.map((c) => h('option', { value: 'custom:' + c.id, selected: f.fontFamily === 'custom:' + c.id }, c.name)),
        h('option', { value: '__upload' }, 'Upload your own font …'),
      );
      wrap.append(this.row('Family', fam));
      const style = h('div.segmented', {},
        h('button', { type: 'button', 'aria-pressed': String(f.bold), onclick: () => { setShared('bold', !f.bold); this.render(); }, style: 'font-weight:700' }, 'Bold'),
        h('button', { type: 'button', 'aria-pressed': String(f.italic), onclick: () => { setShared('italic', !f.italic); this.render(); }, style: 'font-style:italic' }, 'Italic'));
      if (!f.fontFamily.startsWith('custom:')) wrap.append(this.row('Style', style));
      wrap.append(this.row('Size', this.number('fontSize', f.fontSize || 0, (v) => setShared('fontSize', Math.max(0, Math.min(144, v))), 0, 0.5, '0 = auto'), 'pt'));
    }
    const colorIn = h<HTMLInputElement>('input', { type: 'color', name: 'color', value: toHex(f.color), oninput: (e: Event) => setShared('color', fromHex((e.target as HTMLInputElement).value)) });
    const eff = h('span.effective', { title: 'Color actually used' }, h('span.swatch'), h('span.eff-note'));
    wrap.append(this.row(f.type === 'check' || f.type === 'radio' ? 'Mark color' : 'Text color', h('div.color-row', {}, colorIn, eff)));
    if (f.type === 'reset') {
      wrap.append(this.row('Background', h<HTMLInputElement>('input', { type: 'color', name: 'buttonBg', value: toHex(f.buttonBg), oninput: (e: Event) => set('buttonBg', fromHex((e.target as HTMLInputElement).value)) })));
    }
    wrap.append(this.toggle('Smart Contrast', f.autoContrast, (v) => setShared('autoContrast', v),
      'Automatically uses black or white if the color would be hard to read on the background.'));

    // Position
    wrap.append(h('h3.section-title', {}, 'Position (pt)'));
    const grid = h('div.pos-grid');
    for (const [k, l] of [['x', 'X'], ['y', 'Y'], ['w', 'Width'], ['h', 'Height']] as const) {
      grid.append(h('label.pos', {}, h('span', {}, l), this.number('rect.' + k, f.rect[k], (v) => {
        const fid = f.id;
        store.commit(() => { const ff = store.fields.find((x) => x.id === fid); if (ff) ff.rect = { ...ff.rect, [k]: k === 'w' || k === 'h' ? Math.max(2, v) : v }; }, ['fields'], `${fid}:rect.${k}`);
      }, undefined, 0.5)));
    }
    wrap.append(grid);
    wrap.append(this.row('Tooltip', this.input('tooltip', f.tooltip, (v) => set('tooltip', v), 'Help text on hover')));

    // Actions
    const dup = h('button.btn.secondary', { type: 'button', onclick: () => duplicateField(f.id) }, 'Duplicate');
    const del = h('button.btn.danger', { type: 'button', onclick: () => deleteField(f.id) });
    del.innerHTML = `${icons.trash}<span>Delete</span>`;
    wrap.append(h('div.panel-actions', {}, dup, del));

    queueMicrotask(() => this.refreshValues());
    return wrap;
  }

  /** Update values without rebuilding (e.g. while moving); focused inputs are left untouched. */
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
      eff.querySelector<HTMLElement>('.eff-note')!.textContent = 'Smart Contrast active';
      eff.hidden = !changed;
    }
    const sync = this.body.querySelector<HTMLElement>('.sync-info');
    if (sync) {
      const others = store.fields.filter((x) => x.id !== f.id && x.name === f.name && x.type === f.type);
      if (f.type === 'radio') sync.textContent = others.length ? `Group with ${others.length + 1} options.` : 'Radio buttons with the same group form one choice.';
      else if (others.length) {
        const pages = [...new Set(others.map((x) => store.pageNumber(x.pageId)))].sort((a, b) => a - b);
        sync.textContent = `Synced with ${others.length} other ${others.length === 1 ? 'field' : 'fields'} (page ${pages.join(', ')}). Input appears everywhere.`;
      } else sync.textContent = '';
      const clash = store.fields.some((x) => x.name === f.name && x.type !== f.type && f.type !== 'reset' && x.type !== 'reset');
      if (clash) sync.textContent = 'This name is already used for a different field type and will get a suffix on export.';
    }
  }

  private async uploadFont(f: Field) {
    const inp = h<HTMLInputElement>('input', { type: 'file', accept: '.ttf,.otf,font/ttf,font/otf' });
    inp.onchange = async () => {
      const file = inp.files?.[0];
      if (!file) return;
      if (!/\.(ttf|otf)$/i.test(file.name)) { toast('Please choose a TTF or OTF file.', 'warn'); return; }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const cf = { id: uid('font'), name: file.name.replace(/\.(ttf|otf)$/i, ''), bytes };
      store.customFonts.push(cf);
      const fid = f.id;
      store.commit(() => {
        const ff = store.fields.find((x) => x.id === fid);
        if (ff) for (const x of store.fields) if (x.name === ff.name && x.type === ff.type) x.fontFamily = 'custom:' + cf.id;
      });
      this.render();
      toast(`The font “${cf.name}” will be fully embedded on export.`);
    };
    inp.click();
  }

  /* ---------------- Form building blocks ---------------- */

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
      placeholder: name === 'maxLength' ? 'unlimited' : name === 'fontSize' ? 'auto' : undefined,
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
