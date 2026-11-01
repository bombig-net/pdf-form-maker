import type { Field, FieldType, PageAnalysis, Rect, RGB, TextOpRecord, TextItemLite } from '../types';
import { bboxToRect, rectContainsPoint, uid } from '../util/geom';
import { BUTTON_ACTIONS, type ButtonAction } from './logic';

/* ------------------------------------------------------------------ */
/* Naming convention                                                   */
/* ------------------------------------------------------------------ */

export interface ParsedTag { type: FieldType; name: string; radioValue: string; buttonAction?: ButtonAction; label?: string }

const TYPE_MAP: Record<string, ParsedTag['type']> = { text: 'text', check: 'check', checkbox: 'check', radio: 'radio', area: 'area', textarea: 'area', dropdown: 'dropdown', select: 'dropdown', signature: 'signature', sign: 'signature', button: 'reset' };
/** Button tags: [Form_Button_Send], [Form_Button_Print_Print this form] (action, then an optional caption). */
const BUTTON_WORDS: Record<string, ButtonAction> = { send: 'email', email: 'email', mail: 'email', submit: 'email', reset: 'reset', clear: 'reset', print: 'print', save: 'save' };

/** Recognizes "[Form_TYPE_Name]" (brackets optional, e.g. in layer names). */
export function parseTag(raw: string): ParsedTag | null {
  const m = /^\s*\[?\s*Form_(Text|Checkbox|Check|Radio|Textarea|Area|Dropdown|Select|Signature|Sign|Button)_(.+?)\s*\]?\s*$/i.exec(raw);
  if (!m) return null;
  return buildTag(m[1], m[2]);
}
function buildTag(kind: string, rest: string): ParsedTag | null {
  const type = TYPE_MAP[kind.toLowerCase()];
  const clean = rest.trim().replace(/\s+/g, '_');
  if (!type || !clean) return null;
  if (type === 'reset') {
    // Action first, then an optional caption: Send, Print_Print this form, Save_Keep a copy
    const [word, ...rest] = clean.split('_');
    const action = BUTTON_WORDS[word.toLowerCase()];
    if (!action) return { type, name: `Button_${clean}`, radioValue: '', buttonAction: 'reset', label: clean.replace(/_/g, ' ') };
    const caption = rest.join(' ').trim();
    return { type, name: `Button_${word}`, radioValue: '', buttonAction: action, label: caption || BUTTON_ACTIONS[action].caption };
  }
  if (type === 'radio') {
    const i = clean.indexOf('_');
    if (i > 0 && i < clean.length - 1) return { type, name: clean.slice(0, i), radioValue: clean.slice(i + 1) };
    return { type, name: clean, radioValue: '' };
  }
  return { type, name: clean, radioValue: '' };
}
const TAG_IN_TEXT = /\[\s*Form_(Text|Checkbox|Check|Radio|Textarea|Area|Dropdown|Select|Signature|Sign|Button)_([^\]\s][^\]]*?)\s*\]/gi;

/* ------------------------------------------------------------------ */
/* Field factory                                                       */
/* ------------------------------------------------------------------ */

export function newField(type: FieldType, pageId: string, rect: Rect, name = ''): Field {
  return {
    id: uid('f'), pageId, type, name, radioValue: '', rect,
    fontFamily: 'Helvetica', bold: false, italic: false,
    fontSize: type === 'area' ? 10 : 0,
    color: [0, 0, 0], autoContrast: true, bgColor: null,
    align: 'left', required: false, maxLength: 0, format: 'none',
    placeholder: '', hideText: false, tooltip: '',
    label: type === 'reset' ? 'Reset form' : '',
    buttonBg: [0.92, 0.92, 0.92],
    source: 'manual', extraHide: [],
    choices: type === 'dropdown' ? ['Option 1', 'Option 2', 'Option 3'] : [],
    comb: false,
  };
}

/* ------------------------------------------------------------------ */
/* Font mapping                                                        */
/* ------------------------------------------------------------------ */

export function mapFont(baseFont: string): { family: 'Helvetica' | 'Times' | 'Courier'; bold: boolean; italic: boolean } {
  const n = baseFont.replace(/^[A-Z]{6}\+/, '');
  const bold = /bold|black|heavy|semibold|demibold|extrabold|ultra/i.test(n);
  const italic = /italic|oblique|kursiv/i.test(n);
  let family: 'Helvetica' | 'Times' | 'Courier' = 'Helvetica';
  if (/mono|courier|code|consol/i.test(n)) family = 'Courier';
  else if (!/sans/i.test(n) && /times|serif|garamond|georgia|minion|caslon|baskerville|bodoni|palatino|merriweather|playfair|crimson|lora|cambria|antiqua|didot|charter|literata|slab|spectral|cormorant|sabon|utopia|plantin|bembo|janson|century|bookman|egyptienne/i.test(n)) family = 'Times';
  return { family, bold, italic };
}

/* ------------------------------------------------------------------ */
/* Text lines from pdf.js items (for tags, placeholders, labels)       */
/* ------------------------------------------------------------------ */

interface CharPos { x0: number; x1: number; y: number; h: number }
interface Line { text: string; chars: (CharPos | null)[]; y: number; h: number; x0: number; x1: number }

export function buildLines(items: TextItemLite[]): Line[] {
  // Whitespace-only items are skipped: they can bridge large gaps and merge separate labels into one line
  const its = items.filter((t) => t.str.trim().length > 0 && t.h > 0).slice().sort((a, b) => (Math.abs(a.y - b.y) < Math.min(a.h, b.h) * 0.3 ? a.x - b.x : b.y - a.y));
  const lines: Line[] = [];
  let cur: Line | null = null;
  let lastEnd = 0;
  for (const it of its) {
    const same = cur && Math.abs(cur.y - it.y) < Math.min(cur.h, it.h) * 0.3 && it.x >= lastEnd - it.h * 0.5 && it.x - lastEnd < it.h * 3;
    if (!same) {
      cur = { text: '', chars: [], y: it.y, h: it.h, x0: it.x, x1: it.x + it.w };
      lines.push(cur);
    } else if (it.x - lastEnd > it.h * 0.2 && !cur!.text.endsWith(' ') && !it.str.startsWith(' ')) {
      cur!.text += ' '; cur!.chars.push(null);
    }
    const L = cur!;
    const cw = it.w / Math.max(1, it.str.length);
    for (let i = 0; i < it.str.length; i++) {
      L.text += it.str[i];
      L.chars.push({ x0: it.x + cw * i, x1: it.x + cw * (i + 1), y: it.y, h: it.h });
    }
    L.x1 = Math.max(L.x1, it.x + it.w);
    L.h = Math.max(L.h, it.h);
    lastEnd = it.x + it.w;
  }
  return lines;
}

function charsBox(chars: (CharPos | null)[]): Rect | null {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const c of chars) {
    if (!c) continue;
    x0 = Math.min(x0, c.x0); x1 = Math.max(x1, c.x1);
    y0 = Math.min(y0, c.y - c.h * 0.25); y1 = Math.max(y1, c.y + c.h * 0.85);
  }
  return x0 < x1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/* ------------------------------------------------------------------ */
/* Main function                                                       */
/* ------------------------------------------------------------------ */

const area = (r: Rect) => r.w * r.h;
const center = (r: Rect): [number, number] => [r.x + r.w / 2, r.y + r.h / 2];
const overlap = (a: Rect, b: Rect) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

export function detectPageFields(a: PageAnalysis, pageId: string): Field[] {
  const out: Field[] = [];
  const pageArea = (a.view[2] - a.view[0]) * (a.view[3] - a.view[1]);
  const lines = buildLines(a.texts);
  const tagBoxes: Rect[] = [];

  // 1) Layers (optional content groups) following the naming convention
  for (const [layerName, boxes] of Object.entries(a.ocBoxes)) {
    const tag = parseTag(layerName);
    if (!tag || !boxes.length) continue;
    // Separate objects on the same layer: one box per section, overlapping boxes are merged
    const merged = mergeBoxes(boxes.map(bboxToRect));
    merged.forEach((rect, idx) => {
      const f = newField(tag.type, pageId, rect, tag.name);
      f.radioValue = tag.radioValue || (tag.type === 'radio' ? `Option${idx + 1}` : '');
      if (tag.type === 'reset') { f.buttonAction = tag.buttonAction; f.label = tag.label ?? f.label; }
      f.source = 'layer';
      out.push(f);
    });
  }

  // 2) Text tags "[Form_Text_Name]" in the document
  for (const line of lines) {
    TAG_IN_TEXT.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TAG_IN_TEXT.exec(line.text))) {
      const tag = buildTag(m[1], m[2]);
      if (!tag) continue;
      const box = charsBox(line.chars.slice(m.index, m.index + m[0].length));
      if (!box) continue;
      tagBoxes.push(box);
      // Already detected via a layer?
      if (out.some((f) => f.name === tag.name && (tag.type !== 'radio' || f.radioValue === tag.radioValue) && overlap(f.rect, box) > 0)) {
        const f = out.find((ff) => ff.name === tag.name && overlap(ff.rect, box) > 0)!;
        f.extraHide.push(box);
        continue;
      }
      const startX = box.x + 1, midY = box.y + box.h / 2;
      let rect: Rect | null = null;
      if (tag.type === 'check' || tag.type === 'radio') {
        rect = smallestPath(a, (r) => rectContainsPoint(r, startX, midY, 0.5) && r.w < 80 && r.h < 80 && r.w / r.h > 0.6 && r.w / r.h < 1.7, pageArea);
        if (!rect) {
          // Box to the left of the tag
          const cands = a.paths.map((p) => bboxToRect(p.bbox)).filter((r) => r.w >= 4 && r.h >= 4 && r.w < 60 && r.h < 60 && r.w / r.h > 0.6 && r.w / r.h < 1.7
            && r.x + r.w <= box.x + 1 && box.x - (r.x + r.w) < box.h * 3 && midY >= r.y - box.h * 0.3 && midY <= r.y + r.h + box.h * 0.3);
          rect = cands.length ? cands.sort((p, q) => (box.x - (p.x + p.w)) - (box.x - (q.x + q.w)))[0] : null;
        }
        if (!rect) { const s = Math.max(8, box.h * 0.9); rect = { x: box.x, y: midY - s / 2, w: s, h: s }; }
      } else {
        rect = smallestPath(a, (r) => rectContainsPoint(r, startX, midY, 0.5) && r.w > box.w * 0.5, pageArea) ?? { ...box };
        // A signature tag on a plain line: give the field room to sign above it
        if (tag.type === 'signature' && rect.h < 20) rect = { x: rect.x, y: rect.y, w: Math.max(rect.w, 140), h: 26 };
      }
      const f = newField(tag.type, pageId, rect, tag.name);
      f.radioValue = tag.radioValue;
      if (tag.type === 'reset') { f.buttonAction = tag.buttonAction; f.label = tag.label ?? f.label; }
      f.source = 'tag';
      f.extraHide.push(box);
      out.push(f);
    }
  }

  // 3) Keep existing form fields
  for (const w of a.widgets) {
    if (w.kind === 'other') continue;
    const type: FieldType = w.kind === 'button' ? 'reset' : w.kind === 'signature' ? 'signature' : w.kind;
    if (w.kind === 'button') continue; // don't import buttons (actions unknown)
    const rect = bboxToRect(w.rect);
    if (out.some((f) => f.name === w.name && overlap(f.rect, rect) > area(rect) * 0.5)) continue;
    const f = newField(type, pageId, rect, w.name);
    f.source = 'import';
    f.required = !!w.required;
    if (type === 'radio') f.radioValue = w.value || 'Option';
    out.push(f);
  }

  // Number radio buttons without a value
  const radioCount: Record<string, number> = {};
  for (const f of out) if (f.type === 'radio') {
    radioCount[f.name] = (radioCount[f.name] ?? 0) + 1;
    if (!f.radioValue) f.radioValue = `Option${radioCount[f.name]}`;
  }

  // Enrich: font, color, background, placeholder, tooltip
  for (const f of out) enrichField(f, a, lines, tagBoxes);
  return out;
}

function mergeBoxes(rs: Rect[]): Rect[] {
  const res: Rect[] = [];
  for (const r of rs) {
    const hit = res.find((q) => overlap(q, { x: r.x - 0.5, y: r.y - 0.5, w: r.w + 1, h: r.h + 1 }) > 0);
    if (hit) {
      const x0 = Math.min(hit.x, r.x), y0 = Math.min(hit.y, r.y);
      const x1 = Math.max(hit.x + hit.w, r.x + r.w), y1 = Math.max(hit.y + hit.h, r.y + r.h);
      Object.assign(hit, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    } else res.push({ ...r });
  }
  return res;
}

function smallestPath(a: PageAnalysis, pred: (r: Rect) => boolean, pageArea: number): Rect | null {
  let best: Rect | null = null;
  for (const p of a.paths) {
    const r = bboxToRect(p.bbox);
    if (r.w < 4 || r.h < 4 || area(r) > pageArea * 0.5) continue;
    if (!pred(r)) continue;
    if (!best || area(r) < area(best)) best = r;
  }
  return best;
}

function inAny(rs: Rect[], x: number, y: number) { return rs.some((r) => rectContainsPoint(r, x, y, 0.5)); }

export function enrichField(f: Field, a: PageAnalysis, lines: Line[], tagBoxes: Rect[]): void {
  const r = f.rect;
  const isTag = (op: TextOpRecord) => inAny(tagBoxes, op.x + 0.5, op.y + op.size * 0.3);
  const inside = a.textOps.filter((op) => op.tr !== 3 && rectContainsPoint(r, op.x + 0.5, op.y + op.size * 0.3, 0.5));
  const insideNonTag = inside.filter((op) => !isTag(op));

  // Placeholder text (visible text inside the field, excluding the tag)
  if (f.type === 'text' || f.type === 'area') {
    const parts: string[] = [];
    for (const line of lines) {
      let s = '';
      for (let i = 0; i < line.text.length; i++) {
        const c = line.chars[i];
        if (!c) { s += line.text[i]; continue; }
        const cx = (c.x0 + c.x1) / 2, cy = c.y + c.h * 0.3;
        if (rectContainsPoint(r, cx, cy, 0.5) && !inAny(tagBoxes, cx, cy)) s += line.text[i];
        else s += '\u0000';
      }
      const t = s.split('\u0000').map((x) => x.trim()).filter(Boolean).join(' ');
      if (t) parts.push(t);
    }
    const ph = parts.join(f.type === 'area' ? '\n' : ' ').trim();
    if (ph) { f.placeholder = ph; f.hideText = true; }
  } else if (insideNonTag.length && f.source !== 'import') {
    // Hide text inside a checkbox/radio (e.g. "x")
    f.hideText = true;
  }

  // Font: text inside the field first, then the tag text, then the label next to/above it
  let src: TextOpRecord | undefined = insideNonTag[0] ?? inside[0];
  let fromLabel = false;
  if (!src) {
    src = nearestLabelOp(a.textOps, r);
    fromLabel = !!src;
  }
  if (src) {
    const mf = mapFont(src.baseFont);
    // Labels are often bold – inputs only take over font family, size and color.
    f.fontFamily = mf.family; f.bold = fromLabel ? false : mf.bold; f.italic = fromLabel ? false : mf.italic;
    if (f.type === 'text' || f.type === 'area' || f.type === 'reset') {
      let size = Math.round(src.size * 2) / 2;
      if (f.type === 'text' && size > r.h * 0.85) size = Math.max(4, Math.floor(r.h * 0.75 * 2) / 2);
      f.fontSize = Math.min(72, Math.max(4, size));
    }
    // Placeholder text is usually intentionally gray – take the input color from the label (or black)
    const colorSrc = f.placeholder && !fromLabel ? nearestLabelOp(a.textOps, r) : src;
    f.color = colorSrc?.color ? ([...colorSrc.color] as RGB) : [0, 0, 0];
  }

  // Background color under the field (topmost filled object at the center)
  const [cx, cy] = center(r);
  let bg: RGB = [1, 1, 1];
  for (const p of a.paths) {
    if (!p.fill) continue;
    const b = p.bbox;
    if (cx >= b[0] && cx <= b[2] && cy >= b[1] && cy <= b[3]) bg = p.fill;
  }
  f.bgColor = bg;
  // Button tags: the box drawn in the layout gives the button its color
  if (f.type === 'reset' && f.source !== 'manual' && f.source !== 'import') f.buttonBg = [...bg] as RGB;

  // Tooltip from the label
  const label = nearestLabelText(lines, r, tagBoxes);
  f.tooltip = label || f.name.replace(/_/g, ' ');
}

function nearestLabelOp(ops: TextOpRecord[], r: Rect): TextOpRecord | undefined {
  let best: TextOpRecord | undefined; let bd = Infinity;
  for (const op of ops) {
    if (op.tr === 3) continue;
    const top = Math.max(op.y, op.y2), bottom = Math.min(op.y, op.y2);
    const left = Math.min(op.x, op.x2), right = Math.max(op.x, op.x2);
    const midY = (top + bottom) / 2;
    let d = Infinity;
    // to the left
    if (right <= r.x + 2 && midY >= r.y - 2 && midY <= r.y + r.h + 2) d = r.x - right;
    // above
    else if (bottom >= r.y + r.h - 2 && bottom - (r.y + r.h) < Math.max(op.size * 2.5, 24) && right > r.x - 4 && left < r.x + r.w) d = bottom - (r.y + r.h) + Math.max(0, left - r.x) * 0.1;
    if (d < bd && d < 200) { bd = d; best = op; }
  }
  return best;
}

function nearestLabelText(lines: Line[], r: Rect, tagBoxes: Rect[]): string {
  let best = ''; let bd = Infinity;
  for (const line of lines) {
    const t = line.text.replace(TAG_IN_TEXT, '').trim();
    if (!t) continue;
    const ly = line.y, lx0 = line.x0, lx1 = line.x1;
    if (inAny(tagBoxes, (lx0 + lx1) / 2, ly + line.h * 0.3)) continue;
    let d = Infinity;
    const mid = ly + line.h * 0.3;
    if (lx1 <= r.x + 2 && mid >= r.y - 2 && mid <= r.y + r.h + 2) d = r.x - lx1;
    else if (ly >= r.y + r.h - 2 && ly - (r.y + r.h) < Math.max(line.h * 2.5, 24) && lx1 > r.x - 4 && lx0 < r.x + r.w) d = ly - (r.y + r.h);
    else if (lx0 >= r.x + r.w - 2 && lx0 - (r.x + r.w) < 40 && mid >= r.y - 2 && mid <= r.y + r.h + 2) d = (lx0 - (r.x + r.w)) + 5; // to the right (checkbox label)
    if (d < bd && d < 200) { bd = d; best = t; }
  }
  return best.replace(/[:*]+\s*$/, '').slice(0, 120);
}

/* ------------------------------------------------------------------ */
/* Fields with the same name on multiple pages                         */
/* ------------------------------------------------------------------ */

export function crossPageDuplicates(fields: Field[]): string[] {
  const pagesByName = new Map<string, Set<string>>();
  for (const f of fields) {
    if (f.type === 'radio' || f.type === 'reset') continue;
    const s = pagesByName.get(f.name) ?? new Set<string>();
    s.add(f.pageId);
    pagesByName.set(f.name, s);
  }
  return [...pagesByName.entries()].filter(([, s]) => s.size > 1).map(([n]) => n);
}
