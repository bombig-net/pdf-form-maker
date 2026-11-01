import type { Field, RGB } from '../types';

const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export function luminance([r, g, b]: RGB): number {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
export function contrast(a: RGB, b: RGB): number {
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
/** Smart Contrast: Bei zu geringem Kontrast zum Hintergrund Schwarz oder Weiß verwenden. */
export function effectiveColor(f: Pick<Field, 'color' | 'autoContrast' | 'bgColor'>): RGB {
  if (!f.autoContrast || !f.bgColor) return f.color;
  if (contrast(f.color, f.bgColor) >= 3) return f.color;
  return luminance(f.bgColor) > 0.35 ? [0, 0, 0] : [1, 1, 1];
}
export function toHex(c: RGB): string {
  return '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
}
export function fromHex(h: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
