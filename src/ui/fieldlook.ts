import { store } from '../state';
import type { Field } from '../types';
import { effectiveColor, toHex } from '../util/color';
import { rectToScreen, type ViewGeom } from '../util/geom';
import { CALC_OPS } from '../pdf/logic';
import { h } from './dom';

/*
 * How a field looks in the PDF reader, shared by the editor preview and the test mode,
 * so both always show the same font, color, padding and covers.
 */

export const FONT_STACK: Record<string, string> = {
  Helvetica: 'Helvetica, Arial, sans-serif',
  Times: '"Times New Roman", Times, serif',
  Courier: '"Courier New", Courier, monospace',
};
/** Margin PDF readers keep inside text fields anyway (pt). */
const READER_MARGIN = 2;
/** Gray of placeholder text, as written into the PDF (0.6 gray). */
export const GHOST = '#999999';

/** Custom fonts are registered with the browser so the preview uses them too. */
const loadedFonts = new Set<string>();
function fontStack(family: string): string {
  if (!family.startsWith('custom:')) return FONT_STACK[family] ?? FONT_STACK.Helvetica;
  const cf = store.customFonts.find((c) => 'custom:' + c.id === family);
  if (!cf) return FONT_STACK.Helvetica;
  const name = `pfm-${cf.id}`;
  if (!loadedFonts.has(name) && typeof FontFace !== 'undefined') {
    loadedFonts.add(name);
    new FontFace(name, cf.bytes.slice().buffer as ArrayBuffer).load()
      .then((face) => { document.fonts.add(face); store.emit('fields'); })
      .catch(() => { /* keep the fallback */ });
  }
  return `"${name}", ${FONT_STACK.Helvetica}`;
}

export interface FieldLook {
  /** CSS font shorthand */
  font: string;
  /** Text or mark color (Smart Contrast applied) */
  color: string;
  /** Inner padding in px: reader margin plus the form padding */
  padPx: number;
  /** Background color that covers hidden template text, or null */
  cover: string | null;
}

export function fieldLook(f: Field, g: ViewGeom): FieldLook {
  const r = rectToScreen(g, f.rect);
  const auto = f.type === 'area' ? 10 * g.scale : Math.min(r.height * 0.62, 14 * g.scale);
  const size = f.fontSize ? f.fontSize * g.scale : auto;
  const font = `${f.italic ? 'italic ' : ''}${f.bold ? '700 ' : '400 '}${size}px ${fontStack(f.fontFamily)}`;
  const color = toHex(f.type === 'reset' ? effectiveColor({ ...f, bgColor: f.buttonBg }) : effectiveColor(f));
  const padPx = (READER_MARGIN + (store.options.formFont.padding ?? 0)) * g.scale;
  // Checkboxes and radios keep the printed box or circle visible; tag text next to them is covered separately
  const mark = f.type === 'check' || f.type === 'radio';
  const cover = (f.hideText || (f.extraHide.length && !mark)) && f.bgColor ? toHex(f.bgColor) : null;
  return { font, color, padPx, cover };
}

/** Covers for hidden tag text outside the field (e.g. next to a checkbox), like the export hides it. */
export function outsideCovers(f: Field, g: ViewGeom): HTMLElement[] {
  if (!f.bgColor) return [];
  const out: HTMLElement[] = [];
  for (const x of f.extraHide) {
    const inside = x.x >= f.rect.x && x.y >= f.rect.y && x.x + x.w <= f.rect.x + f.rect.w && x.y + x.h <= f.rect.y + f.rect.h;
    if (inside) continue;
    // 1 pt of air: character widths are estimated, so the last glyph would otherwise peek out
    const c = rectToScreen(g, { x: x.x - 1, y: x.y - 1, w: x.w + 2, h: x.h + 2 });
    out.push(h('div.tag-cover', { 'aria-hidden': 'true', style: `left:${c.left}px;top:${c.top}px;width:${c.width}px;height:${c.height}px;background:${toHex(f.bgColor)}` }));
  }
  return out;
}

/** Text a calculated field shows in the editor, e.g. "= Qty × Price" or "= Sum of Total, VAT". */
function calcHint(f: Field): string {
  if (!f.calc) return '';
  if (f.calc.op === 'formula') return f.calc.formula ? `= ${f.calc.formula.replace(/\*/g, '\u00d7').replace(/\//g, '\u00f7')}` : '';
  const names = (f.calc.fields ?? []).join(', ');
  return names ? `= ${CALC_OPS[f.calc.op]} of ${names}` : '';
}

/**
 * Static preview of a field's content for the editor: placeholder, comb boxes, dropdown hint,
 * button with color and caption, check mark. The element fills the field and ignores the mouse.
 */
export function previewContent(f: Field, look: FieldLook): HTMLElement {
  const fp = h('div.fp', { 'aria-hidden': 'true' });
  if (look.cover) { fp.classList.add('cov'); fp.style.setProperty('--cover', look.cover); }
  const textStyle = (align: string) => `font:${look.font};color:${GHOST};text-align:${align};padding:${f.type === 'area' ? `${look.padPx}px` : `0 ${look.padPx}px`}`;

  if (f.type === 'text' && f.comb && f.maxLength > 0) {
    const chars = [...(f.placeholder || '')];
    fp.append(h('div.fp-comb', { style: `--cells:${f.maxLength};font:${look.font};color:${GHOST}` },
      ...Array.from({ length: f.maxLength }, (_, i) => h('span', {}, chars[i] ?? ''))));
  } else if (f.type === 'text' || f.type === 'area') {
    const hint = calcHint(f);
    const text = hint || f.placeholder;
    if (text) fp.append(h(`span.fp-text${f.type === 'area' ? '.multi' : ''}${hint ? '.calc' : ''}`, { style: textStyle(f.align) }, text));
  } else if (f.type === 'dropdown') {
    const first = (f.choices ?? []).find((c) => c.trim());
    if (first) fp.append(h('span.fp-text.dd', { style: textStyle('left') }, first));
  } else if (f.type === 'reset') {
    // Not 'btn': that class belongs to the app's own buttons (fixed height)
    fp.classList.add('fp-button');
    fp.style.background = toHex(f.buttonBg);
    fp.append(h('span.fp-btn', { style: `font:${look.font};color:${look.color}` }, f.label || 'Button'));
  } else {
    fp.append(h(`span.fp-mark${f.type === 'radio' ? '.dot' : ''}`, { style: `color:${look.color};--mark:${look.color}` }, f.type === 'check' ? '\u2713' : ''));
  }
  return fp;
}
