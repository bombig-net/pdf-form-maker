import type { Field, FieldType, PageAnalysis, Rect, TextOpRecord } from '../types';
import { bboxToRect, rectContainsPoint } from '../util/geom';
import { buildLines, enrichField, newField } from './detect';
import { luminance } from '../util/color';

/**
 * Suggests form fields on a page without any tags: empty boxes, underlines,
 * runs of underscores or dots, and checkbox glyphs. Returns new fields with
 * source 'auto' (not yet named); areas covered by `existing` are skipped.
 */
export function suggestFields(a: PageAnalysis, pageId: string, existing: Field[] = []): Field[] {
  const [vx0, vy0, vx1, vy1] = a.view;
  const W = vx1 - vx0, H = vy1 - vy0;
  const lines = buildLines(a.texts);
  const cands: { type: FieldType; rect: Rect; label?: string }[] = [];

  // Dark text inside a box means it is a label or a panel, light gray text is a placeholder
  const darkTextIn = (r: Rect) => a.textOps.some((op: TextOpRecord) => op.tr !== 3
    && rectContainsPoint(r, op.x + 0.5, op.y + op.size * 0.3, -0.5)
    && (!op.color || luminance(op.color) < 0.3));

  // 1) Boxes
  const boxes: Rect[] = [];
  for (const p of a.paths) {
    if (!p.stroke && !p.fill) continue;
    const r = bboxToRect(p.bbox);
    if (r.w < 4 || r.h < 4) continue; // lines are handled below
    if (r.w > W * 0.97 || r.h > H * 0.6) continue;
    if (boxes.some((b) => Math.abs(b.x - r.x) < 1.5 && Math.abs(b.y - r.y) < 1.5 && Math.abs(b.w - r.w) < 1.5 && Math.abs(b.h - r.h) < 1.5)) continue;
    boxes.push(r);
  }
  const contains = (o: Rect, i: Rect) => o !== i && i.x >= o.x - 0.5 && i.y >= o.y - 0.5 && i.x + i.w <= o.x + o.w + 0.5 && i.y + i.h <= o.y + o.h + 0.5;
  for (const r of boxes) {
    const ratio = r.w / r.h;
    let type: FieldType | null = null;
    if (ratio > 0.75 && ratio < 1.33 && r.w >= 6 && r.w <= 28) type = 'check';
    else if (r.h >= 12 && r.h <= 45 && r.w >= Math.max(40, r.h * 2.2)) type = 'text';
    else if (r.h > 45 && r.w >= 80) type = 'area';
    if (!type) continue;
    if (boxes.some((b) => contains(r, b) && b.w * b.h < r.w * r.h * 0.9)) continue; // a panel around other boxes
    if (type !== 'check' && darkTextIn(r)) continue;
    cands.push({ type, rect: { ...r } });
  }

  // 2) Underlines (not table rules, not underlined headings, not box edges)
  // Individual horizontal strokes (snap lines are merged per height, which would join neighbouring underlines)
  const strokes = a.paths.filter((p) => p.stroke && p.bbox[3] - p.bbox[1] < 2).map((p) => ({ v: (p.bbox[1] + p.bbox[3]) / 2, a: p.bbox[0], b: p.bbox[2] }));
  for (const l of strokes) {
    if (cands.some((c) => Math.abs(c.rect.y - 1 - l.v) < 1 && Math.abs(c.rect.x - l.a) < 1)) continue;
    const len = l.b - l.a;
    if (len < 50 || len > W * 0.95) continue;
    if (a.snap.xs.some((v) => v.v >= l.a - 1 && v.v <= l.b + 1 && l.v >= v.a - 1 && l.v <= v.b + 1)) continue;
    if (boxes.some((b) => (Math.abs(b.y - l.v) < 2 || Math.abs(b.y + b.h - l.v) < 2) && b.x < l.b && b.x + b.w > l.a)) continue;
    const sitsOnLine = a.textOps.some((op) => op.tr !== 3 && op.y >= l.v - 1 && op.y <= l.v + 10
      && Math.min(l.b, Math.max(op.x, op.x2)) - Math.max(l.a, Math.min(op.x, op.x2)) > len * 0.3);
    if (sitsOnLine) continue;
    cands.push({ type: 'text', rect: { x: l.a, y: l.v + 1, w: len, h: 16 } });
  }

  // 3) Runs of underscores or dots, and checkbox glyphs in the text
  for (const line of lines) {
    const re = /_{5,}|\.{8,}|\u2026{3,}|[\u2610\u25A1\u274F\u25A2]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line.text))) {
      const chars = line.chars.slice(m.index, m.index + m[0].length).filter(Boolean) as { x0: number; x1: number; y: number; h: number }[];
      if (!chars.length) continue;
      const x0 = chars[0].x0, x1 = chars[chars.length - 1].x1, y = chars[0].y, h = chars[0].h;
      // The label is usually on the same text line: before the underscores, after a checkbox glyph
      const before = line.text.slice(0, m.index).replace(/[_.\u2026]+/g, ' ').replace(/[:\s]+$/, '').trim().split(/\s{2,}/).pop() ?? '';
      const after = line.text.slice(m.index + m[0].length).trim().split(/\s{2,}|[_\u2610\u25A1\u274F\u25A2]/)[0].trim();
      if (m[0].length === 1) cands.push({ type: 'check', rect: { x: x0, y: y - h * 0.1, w: h * 0.9, h: h * 0.9 }, label: after });
      else cands.push({ type: 'text', rect: { x: x0, y: y - 2, w: x1 - x0, h: Math.max(14, h * 1.3) }, label: before });
    }
  }

  // 4) Drop overlaps with existing fields and between suggestions
  const overlap = (p: Rect, q: Rect) => {
    const w = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
    const h = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
    return w > 0 && h > 0 ? (w * h) / Math.min(p.w * p.h, q.w * q.h) : 0;
  };
  const taken: Rect[] = existing.filter((f) => f.pageId === pageId).map((f) => f.rect);
  const out: Field[] = [];
  for (const c of cands) {
    if (c.rect.x < vx0 - 1 || c.rect.y < vy0 - 1 || c.rect.x + c.rect.w > vx1 + 1 || c.rect.y + c.rect.h > vy1 + 1) continue;
    if (taken.some((t) => overlap(t, c.rect) > 0.3)) continue;
    taken.push(c.rect);
    const f = newField(c.type, pageId, c.rect);
    f.source = 'auto';
    enrichField(f, a, lines, []);
    if (c.label) f.tooltip = c.label.slice(0, 120);
    // Underscores, dots and glyphs are the visual line or box: keep them, no placeholder
    if (/^[_.\s\u2026\u2610\u25A1\u274F\u25A2]*$/.test(f.placeholder)) { f.placeholder = ''; f.hideText = false; }
    if (c.type === 'check') f.hideText = false;
    // A line labeled Signature (or Unterschrift, Signatur, Firma) is meant for signing
    if (f.type === 'text' && /signature|signatur|unterschrift|firma/i.test(f.tooltip)) { f.type = 'signature'; f.placeholder = ''; }
    if (f.type === 'text' && f.fontSize > f.rect.h * 0.8) f.fontSize = Math.max(6, Math.floor(f.rect.h * 0.65));
    out.push(f);
  }
  return out;
}
