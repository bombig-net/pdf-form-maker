import { store, type ChangeKind } from '../state';
import type { Field, FieldType, FormatKind, RGB } from '../types';
import { h, icons, toast } from './dom';
import { effectiveColor, fromHex, toHex } from '../util/color';
import { uid, round2 } from '../util/geom';
import type { Viewer } from './viewer';
import { LOCALES, locale, datePattern, type LocaleId } from '../util/locale';
import { insertAddressBlock, suggestAllFields } from './extras';
import { saveProjectFile } from './recent';
import { BUTTON_ACTIONS, CALC_OPS, parseFormula, type ButtonAction, type CalcOp } from '../pdf/logic';
import { startFormFont } from './formfont';

/** Open/closed state of the collapsible sections, remembered across selections and visits. */
const SECTIONS_KEY = 'pfm-sections';
const sectionState: Record<string, boolean> = (() => { try { return JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? '{}'); } catch { return {}; } })();
const FONT_LABEL: Record<string, string> = { Helvetica: 'Helvetica', Times: 'Times', Courier: 'Courier' };

const TYPES: { v: FieldType; label: string }[] = [
  { v: 'text', label: 'Text field' },
  { v: 'area', label: 'Text area (multi-line)' },
  { v: 'check', label: 'Checkbox' },
  { v: 'radio', label: 'Radio button' },
  { v: 'dropdown', label: 'Dropdown' },
  { v: 'reset', label: 'Button' },
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
    startFormFont();
    store.subscribe((k) => this.onChange(k));
    document.addEventListener('focus-inspector', () => {
      this.el.classList.add('open');
      (this.body.querySelector('input[name="name"]') as HTMLInputElement | null)?.focus();
    });
  }

  private onChange(k: Set<ChangeKind>) {
    const id = store.selectedId;
    // Don't rebuild the form panel while the user is typing or picking a color in it
    const active = document.activeElement as HTMLElement | null;
    const editing = !!active && this.body.contains(active) && active.matches('input, textarea, select');
    if (!id && editing && !k.has('selection') && !k.has('doc') && this.shownId === id) return;
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
    const total = store.fields.length;
    wrap.append(h('h2.panel-title', {}, 'Form'));
    wrap.append(h('p.panel-lead', {}, total
      ? `${total} ${total === 1 ? 'field' : 'fields'} on ${store.pages.length} ${store.pages.length === 1 ? 'page' : 'pages'}.`
      : 'No fields yet. Pick a tool above and drag a field onto the page.'));

    // Fields by page
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
          h('span.field-row-src', {}, f.source === 'layer' ? 'Layer' : f.source === 'tag' ? 'Tag' : f.source === 'import' ? 'existing' : f.source === 'auto' ? 'Suggested' : '')));
        }
      });
      wrap.append(this.section('doc:fields', 'Fields', [list], { open: true, meta: String(total) }));
    }

    wrap.append(this.formFontSection());

    const detect = h('button.btn.secondary', { type: 'button', onclick: () => suggestAllFields((id) => this.viewer.scrollToField(id)) }, 'Detect fields');
    const addr = h('button.btn.secondary', { type: 'button', onclick: () => insertAddressBlock(this.viewer) }, 'Address block');
    wrap.append(this.section('doc:insert', 'Insert', [h('div.insert-row', {}, detect, addr),
      h('p.hint', {}, 'Detect fields looks for empty boxes, lines and checkboxes without tags. Address block adds name, street, postal code, city, email and phone.')], { open: true }));

    const region = h<HTMLSelectElement>('select', { name: 'locale', onchange: (e: Event) => { store.options.locale = (e.target as HTMLSelectElement).value; store.emit('options'); } },
      ...(Object.keys(LOCALES) as LocaleId[]).map((id) => {
        const l = LOCALES[id];
        return h('option', { value: id, selected: id === store.options.locale }, `${l.label} · ${datePattern(l)} · ${l.numberExample}`);
      }));
    wrap.append(this.section('doc:options', 'Options', [
      this.row('Region', region),
      h('p.hint', {}, 'Sets the date, number and postal code formats for this form.'),
      this.toggle('Show tab order', store.options.showTabOrder, (v) => { store.options.showTabOrder = v; store.emit('options'); },
        'The order is calculated automatically from top left to bottom right.'),
      this.toggle('Snap to lines and fields', store.options.snap, (v) => { store.options.snap = v; store.emit('options'); },
        'Hold Alt while dragging to bypass snapping temporarily.'),
      this.toggle('Hide placeholder layers on export', store.options.hidePlaceholderLayers, (v) => { store.options.hidePlaceholderLayers = v; store.emit('options'); },
        'Turns off layers named like [Form_Text_…] in the final PDF.'),
    ], { meta: locale(store.options.locale).label }));

    const save = h('button.btn.secondary', { type: 'button', onclick: () => saveProjectFile() }, 'Save project file');
    wrap.append(this.section('doc:project', 'Project', [h('div.insert-row', {}, save),
      h('p.hint', {}, 'Downloads the PDF with all fields and settings as one file, to back it up or pass it on. Open it again from the home screen.')]));

    wrap.append(this.section('doc:shortcuts', 'Shortcuts', [h('dl.shortcuts', {},
      ...[['V', 'Select'], ['T / A', 'Text field / text area'], ['C / R', 'Checkbox / radio'], ['D / B', 'Dropdown / button'], ['⇧ Click', 'Select multiple fields'], ['Drag', 'Selection rectangle on empty space'], ['Del', 'Delete selection'], ['Arrows', 'Move (⇧ = 10 pt)'], ['⌘/Ctrl C / V', 'Copy and paste'], ['⌘/Ctrl A', 'All fields on the page'], ['⌘/Ctrl D', 'Duplicate field'], ['⌘/Ctrl Z', 'Undo'], ['⌘/Ctrl E', 'Test the form']]
        .flatMap(([k, v]) => [h('dt', {}, h('kbd', {}, k)), h('dd', {}, v)]))]));
    return wrap;
  }

  /** Form font: one font for all fields, or the fonts detected in the layout. */
  private formFontSection(): HTMLElement {
    const ff = store.options.formFont;
    const update = (p: Partial<typeof ff>) => { Object.assign(store.options.formFont, p); store.emit('options'); };
    const mode = h('div.segmented', { role: 'radiogroup', 'aria-label': 'Font mode' },
      h('button', { type: 'button', role: 'radio', 'aria-checked': String(ff.mode === 'uniform'), onclick: () => { update({ mode: 'uniform' }); this.render(); } }, 'Same for all fields'),
      h('button', { type: 'button', role: 'radio', 'aria-checked': String(ff.mode === 'layout'), onclick: () => { update({ mode: 'layout' }); this.render(); } }, 'Match layout'));
    const own = store.fields.filter((f) => f.fontLocked).length;
    const children: (Node | null)[] = [mode];
    const padding = this.row('Padding', this.number('formPadding', ff.padding ?? 0, (v) => update({ padding: Math.max(0, Math.min(20, v)) }), 0, 0.5), 'pt');
    if (ff.mode === 'uniform') {
      const fam = h<HTMLSelectElement>('select', { name: 'formFontFamily', onchange: (e: Event) => update({ family: (e.target as HTMLSelectElement).value }) },
        ...['Helvetica', 'Times', 'Courier'].map((v) => h('option', { value: v, selected: ff.family === v }, `${v} (${v === 'Helvetica' ? 'sans' : v === 'Times' ? 'serif' : 'mono'})`)),
        ...store.customFonts.map((c) => h('option', { value: 'custom:' + c.id, selected: ff.family === 'custom:' + c.id }, c.name)));
      const style = h('div.segmented', {},
        h('button', { type: 'button', 'aria-pressed': String(ff.bold), style: 'font-weight:700', onclick: () => { update({ bold: !ff.bold }); this.render(); } }, 'Bold'),
        h('button', { type: 'button', 'aria-pressed': String(ff.italic), style: 'font-style:italic', onclick: () => { update({ italic: !ff.italic }); this.render(); } }, 'Italic'));
      const size = this.number('formFontSize', ff.size, (v) => update({ size: Math.max(0, Math.min(72, v)) }), 0, 0.5, '0 = auto');
      const color = h<HTMLInputElement>('input', { type: 'color', name: 'formFontColor', value: toHex(ff.color), oninput: (e: Event) => update({ color: fromHex((e.target as HTMLInputElement).value) }) });
      children.push(this.row('Family', fam), ff.family.startsWith('custom:') ? null : this.row('Style', style), this.row('Size', size, 'pt'), this.row('Color', color));
      children.push(padding);
      children.push(h('p.hint', {}, own
        ? `${own} ${own === 1 ? 'field uses its' : 'fields use their'} own font settings.`
        : 'Applies to every field. Individual fields can still get their own settings.'));
      if (own) children.push(h('div.insert-row', {}, h('button.btn.secondary.small', { type: 'button', onclick: () => {
        store.commit(() => { for (const f of store.fields) f.fontLocked = false; });
      } }, 'Use the form font everywhere')));
    } else {
      children.push(h('p.hint', {}, 'Every field keeps the font, size and color detected from its label in the layout.'), padding);
    }
    const meta = ff.mode === 'uniform' ? `${FONT_LABEL[ff.family] ?? store.customFonts.find((c) => 'custom:' + c.id === ff.family)?.name ?? 'Custom'} · ${ff.size ? `${ff.size} pt` : 'auto'}` : 'Match layout';
    return this.section('doc:font', 'Form font', children, { open: true, meta });
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
    const setShared = <K extends keyof Field>(key: K, val: Field[K], extra?: Partial<Field>) => {
      const fid = f.id;
      store.commit(() => {
        const ff = store.fields.find((x) => x.id === fid);
        if (!ff) return;
        for (const x of store.fields) if (x.name === ff.name && x.type === ff.type) { x[key] = val; if (extra) Object.assign(x, extra); }
      }, ['fields'], `${fid}:${String(key)}`);
    };
    const uniform = store.options.formFont.mode === 'uniform';
    /** Font changes make the field independent of the form font. */
    const setFont = <K extends keyof Field>(key: K, val: Field[K]) => setShared(key, val, { fontLocked: true });

    // ----- Essentials (always visible) -----
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
    wrap.append(this.row(f.type === 'radio' ? 'Group' : 'Field name', this.input('name', f.name, (v) => set('name', v.replace(/[.\s]+/g, '_')))));
    wrap.append(h('p.hint.sync-info'));
    if (f.type === 'radio') wrap.append(this.row('Value', this.input('radioValue', f.radioValue, (v) => set('radioValue', v.replace(/[.\s]+/g, '_')))));
    if (f.type === 'reset') {
      wrap.append(this.row('Caption', this.input('label', f.label, (v) => set('label', v))));
      const current = (f.buttonAction ?? 'reset') as ButtonAction;
      const act = h<HTMLSelectElement>('select', { name: 'buttonAction', onchange: (e: Event) => {
        const v = (e.target as HTMLSelectElement).value as ButtonAction;
        const fid = f.id;
        store.commit(() => {
          const ff = store.fields.find((x) => x.id === fid);
          if (!ff) return;
          // Swap the caption too, unless it was changed by hand
          const defaults = Object.values(BUTTON_ACTIONS).map((a) => a.caption) as string[];
          if (!ff.label || defaults.includes(ff.label)) ff.label = BUTTON_ACTIONS[v].caption;
          ff.buttonAction = v;
        });
        this.render();
      } }, ...(Object.keys(BUTTON_ACTIONS) as ButtonAction[]).map((k) => h('option', { value: k, selected: k === current }, BUTTON_ACTIONS[k].label)));
      wrap.append(this.row('Action', act));
      if (current === 'email') {
        wrap.append(this.row('To', this.input('mailTo', f.mailTo ?? '', (v) => set('mailTo', v.trim()), 'forms@example.com')));
        wrap.append(this.row('Subject', this.input('mailSubject', f.mailSubject ?? '', (v) => set('mailSubject', v), 'Completed form')));
      }
      wrap.append(h('p.hint', {}, {
        reset: 'Clears every field of the form.',
        email: 'Opens an email with the filled-in PDF attached.',
        print: 'Opens the print dialog.',
        save: 'Opens \u201cSave As\u201d, so the filled-in form can be kept as a PDF.',
      }[current] + (current === 'reset' ? '' : ' Works in Adobe Acrobat and Reader.')));
    }
    if (f.type === 'text') {
      const chips = h('div.chips', { role: 'radiogroup', 'aria-label': 'Purpose' });
      for (const fm of FORMATS) {
        chips.append(h('button.chip', {
          type: 'button', role: 'radio', 'aria-checked': String(fm.v === f.format),
          onclick: () => { setShared('format', fm.v); this.render(); },
        }, fm.label));
      }
      wrap.append(this.row('Purpose', chips), h('p.hint', {}, formatHint(f.format)));
    }
    if (f.type === 'text' || f.type === 'area') {
      wrap.append(this.row('Placeholder', this.input('placeholder', f.placeholder, (v) => setShared('placeholder', v), 'Gray hint text, disappears when typing')));
    }
    if (f.type === 'dropdown') {
      const ta = h<HTMLTextAreaElement>('textarea.choices', { name: 'choices', rows: 5, spellcheck: 'false', 'aria-label': 'Dropdown options, one per line',
        oninput: (e: Event) => setShared('choices', (e.target as HTMLTextAreaElement).value.split('\n')) });
      ta.value = (f.choices ?? []).join('\n');
      wrap.append(h('label.block-label', {}, 'Options'), ta, h('p.hint', {}, 'One option per line, in the order they should appear.'));
    }
    if (f.type !== 'reset') wrap.append(this.toggle('Required', f.required, (v) => setShared('required', v)));

    // ----- Collapsible sections -----
    if (f.type === 'text' || f.type === 'area') {
      const al = h('div.segmented', { role: 'radiogroup', 'aria-label': 'Alignment' });
      for (const [v, l] of [['left', 'Left'], ['center', 'Center'], ['right', 'Right']] as const) {
        al.append(h('button', { type: 'button', role: 'radio', 'aria-checked': String(f.align === v), onclick: () => { setShared('align', v); this.render(); } }, l));
      }
      const comb = f.type === 'text' ? this.toggle('Comb (one box per character)', !!f.comb, (v) => {
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
      }, 'Splits the field into equal boxes, e.g. for an IBAN, a postal code or a date. The number of boxes is the max. length.') : null;
      const meta = [f.align !== 'left' ? (f.align === 'center' ? 'Centered' : 'Right') : '', f.maxLength > 0 ? `max. ${f.maxLength}` : '', f.comb ? 'Comb' : ''].filter(Boolean).join(' · ');
      wrap.append(this.section('f:input', 'Input', [
        this.row('Alignment', al),
        this.row('Max. length', this.number('maxLength', f.maxLength, (v) => setShared('maxLength', Math.max(0, Math.round(v))), 0, 1, '0 = unlimited')),
        comb,
      ], { meta }));
    }
    if (f.type === 'text') wrap.append(this.calcSection(f));
    wrap.append(this.visibilitySection(f));
    wrap.append(this.fontSection(f, setShared, setFont, set, uniform));

    const grid = h('div.pos-grid');
    for (const [k, l] of [['x', 'X'], ['y', 'Y'], ['w', 'Width'], ['h', 'Height']] as const) {
      grid.append(h('label.pos', {}, h('span', {}, l), this.number('rect.' + k, f.rect[k], (v) => {
        const fid = f.id;
        store.commit(() => { const ff = store.fields.find((x) => x.id === fid); if (ff) ff.rect = { ...ff.rect, [k]: k === 'w' || k === 'h' ? Math.max(2, v) : v }; }, ['fields'], `${fid}:rect.${k}`);
      }, undefined, 0.5)));
    }
    wrap.append(this.section('f:position', 'Position & size', [grid, h('p.hint', {}, 'In points, measured from the bottom left of the page.')],
      { meta: `${Math.round(f.rect.w)} × ${Math.round(f.rect.h)} pt` }));

    wrap.append(this.section('f:more', 'More', [
      this.row('Tooltip', this.input('tooltip', f.tooltip, (v) => set('tooltip', v), 'Help text on hover')),
      this.toggle('Hide text underneath', f.hideText, (v) => set('hideText', v),
        'Static text from the template inside the field area becomes invisible on export.'),
    ]));

    const dup = h('button.btn.secondary', { type: 'button', onclick: () => duplicateField(f.id) }, 'Duplicate');
    const del = h('button.btn.danger', { type: 'button', onclick: () => deleteField(f.id) });
    del.innerHTML = `${icons.trash}<span>Delete</span>`;
    wrap.append(h('div.panel-actions', {}, dup, del));

    queueMicrotask(() => this.refreshValues());
    return wrap;
  }

  /** Font & color: follows the form font unless the field has its own settings. */
  private fontSection(f: Field,
    setShared: <K extends keyof Field>(key: K, val: Field[K], extra?: Partial<Field>) => void,
    setFont: <K extends keyof Field>(key: K, val: Field[K]) => void,
    set: <K extends keyof Field>(key: K, val: Field[K]) => void,
    uniform: boolean): HTMLElement {
    const textual = f.type !== 'check' && f.type !== 'radio';
    const followsForm = uniform && !f.fontLocked;
    const children: (Node | null)[] = [];
    if (uniform) {
      children.push(this.toggle('Own font settings', !!f.fontLocked, (v) => { setShared('fontLocked', v); this.render(); },
        followsForm ? 'Uses the form font. Turn on to set this field individually.' : 'This field ignores the form font.'));
    }
    if (!followsForm) {
      if (textual) {
        const fam = h<HTMLSelectElement>('select', { name: 'fontFamily', onchange: async (e: Event) => {
          const v = (e.target as HTMLSelectElement).value;
          if (v === '__upload') { (e.target as HTMLSelectElement).value = f.fontFamily; await this.uploadFont(f); return; }
          setFont('fontFamily', v);
        } },
          h('option', { value: 'Helvetica', selected: f.fontFamily === 'Helvetica' }, 'Helvetica (sans)'),
          h('option', { value: 'Times', selected: f.fontFamily === 'Times' }, 'Times (serif)'),
          h('option', { value: 'Courier', selected: f.fontFamily === 'Courier' }, 'Courier (mono)'),
          ...store.customFonts.map((c) => h('option', { value: 'custom:' + c.id, selected: f.fontFamily === 'custom:' + c.id }, c.name)),
          h('option', { value: '__upload' }, 'Upload your own font …'),
        );
        const style = h('div.segmented', {},
          h('button', { type: 'button', 'aria-pressed': String(f.bold), onclick: () => { setFont('bold', !f.bold); this.render(); }, style: 'font-weight:700' }, 'Bold'),
          h('button', { type: 'button', 'aria-pressed': String(f.italic), onclick: () => { setFont('italic', !f.italic); this.render(); }, style: 'font-style:italic' }, 'Italic'));
        children.push(this.row('Family', fam), f.fontFamily.startsWith('custom:') ? null : this.row('Style', style),
          this.row('Size', this.number('fontSize', f.fontSize || 0, (v) => setFont('fontSize', Math.max(0, Math.min(144, v))), 0, 0.5, '0 = auto'), 'pt'));
      }
      const colorIn = h<HTMLInputElement>('input', { type: 'color', name: 'color', value: toHex(f.color), oninput: (e: Event) => setFont('color', fromHex((e.target as HTMLInputElement).value)) });
      const eff = h('span.effective', { title: 'Color actually used' }, h('span.swatch'), h('span.eff-note'));
      children.push(this.row(textual ? 'Text color' : 'Mark color', h('div.color-row', {}, colorIn, eff)));
    }
    if (f.type === 'reset') {
      children.push(this.row('Background', h<HTMLInputElement>('input', { type: 'color', name: 'buttonBg', value: toHex(f.buttonBg), oninput: (e: Event) => set('buttonBg', fromHex((e.target as HTMLInputElement).value)) })));
    }
    children.push(this.toggle('Smart Contrast', f.autoContrast, (v) => setShared('autoContrast', v),
      'Automatically uses black or white if the color would be hard to read on the background.'));
    const fam = FONT_LABEL[f.fontFamily] ?? store.customFonts.find((c) => 'custom:' + c.id === f.fontFamily)?.name ?? 'Custom';
    const meta = followsForm ? 'Form font' : textual ? `${fam} · ${f.fontSize ? `${f.fontSize} pt` : 'auto'}` : 'Own color';
    return this.section('f:font', textual ? 'Font & color' : 'Color', children, { meta });
  }

  /** Calculation: sum, product, average, min, max of other fields, or a formula. */
  private calcSection(f: Field): HTMLElement {
    const fid = f.id;
    const setCalc = (calc: Field['calc']) => store.commit(() => {
      const ff = store.fields.find((x) => x.id === fid);
      if (!ff) return;
      for (const x of store.fields) if (x.name === ff.name && x.type === ff.type) {
        x.calc = calc;
        if (calc && x.format === 'none') x.format = 'number';
      }
    }, ['fields'], `${fid}:calc`);
    const op = h<HTMLSelectElement>('select', { name: 'calcOp', onchange: (e: Event) => {
      const v = (e.target as HTMLSelectElement).value as CalcOp | '';
      setCalc(v ? { op: v, fields: f.calc?.fields ?? [], formula: f.calc?.formula ?? '' } : undefined);
      this.render();
    } }, h('option', { value: '', selected: !f.calc }, 'None (typed in)'),
      ...(Object.keys(CALC_OPS) as CalcOp[]).map((k) => h('option', { value: k, selected: f.calc?.op === k }, CALC_OPS[k])));
    const children: (Node | null)[] = [this.row('Value', op)];
    if (f.calc) {
      const others = [...new Set(store.fields.filter((x) => x.type === 'text' && x.name !== f.name).map((x) => x.name))];
      if (f.calc.op === 'formula') {
        const err = h('p.hint.formula-error');
        const check = (v: string) => { try { parseFormula(v, new Set(others)); err.textContent = ''; } catch (e) { err.textContent = (e as Error).message; } };
        const inp = this.input('formula', f.calc.formula ?? '', (v) => { setCalc({ op: 'formula', formula: v }); check(v); }, 'Quantity * Price');
        children.push(this.row('Formula', inp), err,
          h('p.hint', {}, `Use field names, numbers, + − × / and parentheses. Fields: ${others.slice(0, 12).join(', ')}${others.length > 12 ? ' …' : ''}`));
        check(f.calc.formula ?? '');
      } else {
        const chosen = new Set(f.calc.fields ?? []);
        const list = h('div.calc-list', { role: 'group', 'aria-label': 'Fields to calculate' },
          ...others.map((n) => {
            const id = uid('c');
            return h('label.calc-item', { for: id }, h('input', { type: 'checkbox', id, checked: chosen.has(n), onchange: (e: Event) => {
              if ((e.target as HTMLInputElement).checked) chosen.add(n); else chosen.delete(n);
              setCalc({ op: f.calc!.op, fields: others.filter((x) => chosen.has(x)) });
            } }), h('span', {}, n));
          }));
        children.push(others.length ? list : h('p.hint', {}, 'Add more text fields first.'));
      }
      children.push(h('p.hint', {}, 'Calculated fields are read-only and update while the form is filled in (Adobe Acrobat and Reader).'));
    }
    return this.section('f:calc', 'Calculation', children, { open: !!f.calc, meta: f.calc ? CALC_OPS[f.calc.op] : 'None' });
  }

  /** Visibility: always, or only if a checkbox is checked / a radio or dropdown has a value. */
  private visibilitySection(f: Field): HTMLElement {
    const opts: { key: string; label: string; field: string; value?: string }[] = [];
    const seen = new Set<string>();
    for (const x of store.fields) {
      if (x.name === f.name || seen.has(x.type + x.name)) continue;
      if (x.type === 'check') { seen.add(x.type + x.name); opts.push({ key: JSON.stringify([x.name]), label: `${x.name} is checked`, field: x.name }); }
      if (x.type === 'radio') {
        if (!seen.has('radio' + x.name + x.radioValue)) { seen.add('radio' + x.name + x.radioValue); opts.push({ key: JSON.stringify([x.name, x.radioValue]), label: `${x.name} = ${x.radioValue}`, field: x.name, value: x.radioValue }); }
      }
      if (x.type === 'dropdown') {
        seen.add(x.type + x.name);
        for (const c of (x.choices ?? []).filter((c) => c.trim())) opts.push({ key: JSON.stringify([x.name, c]), label: `${x.name} = ${c}`, field: x.name, value: c });
      }
    }
    const cur = f.showIf ? JSON.stringify(f.showIf.value === undefined ? [f.showIf.field] : [f.showIf.field, f.showIf.value]) : '';
    const sel = h<HTMLSelectElement>('select', { name: 'showIf', onchange: (e: Event) => {
      const o = opts.find((x) => x.key === (e.target as HTMLSelectElement).value);
      const fid = f.id;
      store.commit(() => {
        const ff = store.fields.find((x) => x.id === fid);
        if (!ff) return;
        for (const x of store.fields) if (x.name === ff.name && x.type === ff.type) x.showIf = o ? { field: o.field, value: o.value } : undefined;
      });
    } }, h('option', { value: '', selected: !cur }, 'Always visible'), ...opts.map((o) => h('option', { value: o.key, selected: o.key === cur }, `Only if ${o.label}`)));
    const hint = opts.length
      ? 'Hidden fields appear as soon as the condition is met (Adobe Acrobat and Reader).'
      : 'Add a checkbox, radio group or dropdown to show this field only when needed.';
    return this.section('f:visibility', 'Visibility', [this.row('Show', sel), h('p.hint', {}, hint)],
      { open: !!f.showIf, meta: f.showIf ? `Only if ${f.showIf.field}${f.showIf.value ? ` = ${f.showIf.value}` : ''}` : 'Always' });
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

  /** Collapsible section. `meta` is a short status shown next to the title while closed. */
  private section(id: string, title: string, children: (Node | null | false)[], opts: { open?: boolean; meta?: string } = {}): HTMLElement {
    const d = h<HTMLDetailsElement>('details.acc', { 'data-sec': id });
    d.open = sectionState[id] ?? !!opts.open;
    d.addEventListener('toggle', () => {
      sectionState[id] = d.open;
      try { localStorage.setItem(SECTIONS_KEY, JSON.stringify(sectionState)); } catch { /* ignore */ }
    });
    d.append(h('summary.acc-head', {}, h('span.acc-title', {}, title), opts.meta ? h('span.acc-meta', {}, opts.meta) : null),
      h('div.acc-body', {}, ...children.filter(Boolean) as Node[]));
    return d;
  }

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
