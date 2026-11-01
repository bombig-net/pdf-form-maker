import type { Rect } from '../types';

export type M6 = [number, number, number, number, number, number];
export const IDENT: M6 = [1, 0, 0, 1, 0, 0];

/** m1 × m2 (m1 first, then m2) – PDF convention. */
export function mul(m1: M6, m2: M6): M6 {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}
export function apply(m: M6, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function rectContainsPoint(r: Rect, x: number, y: number, tol = 0): boolean {
  return x >= r.x - tol && x <= r.x + r.w + tol && y >= r.y - tol && y <= r.y + r.h + tol;
}
export function bboxToRect(b: [number, number, number, number]): Rect {
  return { x: b[0], y: b[1], w: b[2] - b[0], h: b[3] - b[1] };
}
export function bboxContains(b: [number, number, number, number], x: number, y: number, tol = 0): boolean {
  return x >= b[0] - tol && x <= b[2] + tol && y >= b[1] - tol && y <= b[3] + tol;
}

/** Maps PDF user space -> screen (CSS px) for a page with view box, rotation (clockwise) and scale. */
export interface ViewGeom { view: [number, number, number, number]; rotation: number; scale: number }

const norm = (r: number) => ((r % 360) + 360) % 360;

export function pageSize(g: ViewGeom): { w: number; h: number } {
  const W = (g.view[2] - g.view[0]) * g.scale, H = (g.view[3] - g.view[1]) * g.scale;
  return norm(g.rotation) % 180 === 0 ? { w: W, h: H } : { w: H, h: W };
}
export function toScreen(g: ViewGeom, x: number, y: number): [number, number] {
  const W = (g.view[2] - g.view[0]) * g.scale, H = (g.view[3] - g.view[1]) * g.scale;
  const px = (x - g.view[0]) * g.scale, py = (g.view[3] - y) * g.scale;
  switch (norm(g.rotation)) {
    case 90: return [H - py, px];
    case 180: return [W - px, H - py];
    case 270: return [py, W - px];
    default: return [px, py];
  }
}
export function toPdf(g: ViewGeom, sx: number, sy: number): [number, number] {
  const W = (g.view[2] - g.view[0]) * g.scale, H = (g.view[3] - g.view[1]) * g.scale;
  let px: number, py: number;
  switch (norm(g.rotation)) {
    case 90: px = sy; py = H - sx; break;
    case 180: px = W - sx; py = H - sy; break;
    case 270: px = W - sy; py = sx; break;
    default: px = sx; py = sy;
  }
  return [px / g.scale + g.view[0], g.view[3] - py / g.scale];
}
export function rectToScreen(g: ViewGeom, r: Rect): { left: number; top: number; width: number; height: number } {
  const a = toScreen(g, r.x, r.y), b = toScreen(g, r.x + r.w, r.y + r.h);
  return { left: Math.min(a[0], b[0]), top: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]) };
}
export function screenToRect(g: ViewGeom, l: number, t: number, w: number, h: number): Rect {
  const a = toPdf(g, l, t), b = toPdf(g, l + w, t + h);
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) };
}

export function uid(prefix = 'id'): string {
  return prefix + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
}

export function round2(n: number): number { return Math.round(n * 100) / 100; }
