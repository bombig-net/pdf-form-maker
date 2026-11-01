import type { Rect } from '../types';

/**
 * Sortiert Elemente für die Tab-Reihenfolge: zeilenweise von oben nach unten, innerhalb einer Zeile von links nach rechts.
 * Berücksichtigt die Seitendrehung (Leserichtung wie am Bildschirm).
 */
export function sortForTabOrder<T>(items: T[], rectOf: (t: T) => Rect, rotation = 0): T[] {
  const rot = ((rotation % 360) + 360) % 360;
  // In "Bildschirm-Koordinaten" umrechnen: top (kleiner = weiter oben), left
  const view = items.map((it) => {
    const r = rectOf(it);
    let top: number, left: number, h: number;
    switch (rot) {
      case 90: top = r.x; left = r.y; h = r.w; break;           // Seite im Uhrzeigersinn gedreht
      case 180: top = r.y; left = -(r.x + r.w); h = r.h; break;
      case 270: top = -(r.x + r.w); left = -(r.y + r.h); h = r.w; break;
      default: top = -(r.y + r.h); left = r.x; h = r.h;
    }
    return { it, top, left, h };
  });
  view.sort((a, b) => a.top - b.top || a.left - b.left);
  const rows: (typeof view)[] = [];
  for (const v of view) {
    const row = rows[rows.length - 1];
    if (row) {
      const ref = row[0];
      const overlap = Math.min(ref.top + ref.h, v.top + v.h) - Math.max(ref.top, v.top);
      if (overlap > Math.min(ref.h, v.h) * 0.5) { row.push(v); continue; }
    }
    rows.push([v]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.left - b.left).map((v) => v.it));
}
