import { store, type ChangeKind } from '../state';
import type { Field, PageRef, Rect, FieldType } from '../types';
import { h } from './dom';
import { pageSize, rectToScreen, screenToRect, toScreen, type ViewGeom } from '../util/geom';
import { newField, enrichField, buildLines } from '../pdf/detect';
import { sortForTabOrder } from '../util/tabOrder';
import { renderTestOverlay } from './testmode';

export const BASE_SCALE = 96 / 72;
const SNAP_PX = 6;
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type Handle = (typeof HANDLES)[number];

const TYPE_LABEL: Record<FieldType, string> = { text: 'Text', area: 'Textbereich', check: 'Checkbox', radio: 'Radio', reset: 'Reset' };

interface PageView {
  page: PageRef;
  wrap: HTMLDivElement;
  canvas: HTMLCanvasElement;
  overlay: HTMLDivElement;
  renderedKey: string;
  task: { cancel(): void } | null;
  visible: boolean;
}

interface SnapSet { xs: number[]; ys: number[] }

interface DragState {
  kind: 'move' | 'resize' | 'draw' | 'marquee';
  /** Weitere mitbewegte Felder bei Mehrfachauswahl */
  group?: { id: string; el: HTMLElement; orig: { left: number; top: number; width: number; height: number } }[];
  additive?: boolean;
  pointerId: number;
  pageId: string;
  field?: Field;
  handle?: Handle;
  startX: number; startY: number;
  orig: { left: number; top: number; width: number; height: number };
  cur: { left: number; top: number; width: number; height: number };
  el: HTMLElement;
  snaps: SnapSet;
  moved: boolean;
  type?: FieldType;
}

export class Viewer {
  readonly el: HTMLElement;
  private stack: HTMLDivElement;
  private views = new Map<string, PageView>();
  private observer: IntersectionObserver;
  private drag: DragState | null = null;
  private pinch: { startDist: number; startZoom: number; midX: number; midY: number; ratio: number } | null = null;
  private renderTimer = 0;
  private lastRadio: { name: string; pageId: string } | null = null;

  constructor(host: HTMLElement) {
    this.el = host;
    this.stack = h<HTMLDivElement>('div.stack');
    this.el.append(this.stack);
    this.observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const id = (e.target as HTMLElement).dataset.page!;
        const v = this.views.get(id);
        if (!v) continue;
        v.visible = e.isIntersecting;
        if (v.visible) this.renderPage(v);
      }
    }, { root: this.el, rootMargin: '600px 0px' });

    store.subscribe((k) => this.onChange(k));
    this.bindZoomGestures();
  }

  private onChange(k: Set<ChangeKind>) {
    if (k.has('pages') || k.has('doc')) this.rebuild();
    else if (k.has('zoom')) this.layout();
    else if (k.has('fields') || k.has('options') || k.has('mode') || k.has('selection')) this.drawAllOverlays();
    if (k.has('tool') || k.has('mode')) { this.el.dataset.tool = store.tool; this.el.classList.toggle('testing', store.testMode); }
  }

  geom(p: PageRef): ViewGeom {
    const a = store.analysis(p);
    return { view: a.view, rotation: (((a.baseRotate + p.rotation) % 360) + 360) % 360, scale: store.zoom * BASE_SCALE };
  }

  /* ---------------------------------------------------------------- */
  /* Aufbau & Rendering                                               */
  /* ---------------------------------------------------------------- */

  rebuild() {
    const keep = new Set(store.pages.map((p) => p.id));
    for (const [id, v] of this.views) if (!keep.has(id)) { this.observer.unobserve(v.wrap); v.wrap.remove(); this.views.delete(id); }
    store.pages.forEach((p, i) => {
      let v = this.views.get(p.id);
      if (!v) {
        const canvas = h('canvas.page-canvas') as HTMLCanvasElement;
        const overlay = h('div.overlay') as HTMLDivElement;
        const wrap = h('div.page', { 'data-page': p.id }, canvas, overlay) as HTMLDivElement;
        v = { page: p, wrap, canvas, overlay, renderedKey: '', task: null, visible: false };
        this.views.set(p.id, v);
        this.bindOverlay(v);
        this.observer.observe(wrap);
      }
      v.page = p;
      v.wrap.dataset.num = String(i + 1);
      v.wrap.setAttribute('aria-label', `Seite ${i + 1}`);
      if (this.stack.children[i] !== v.wrap) this.stack.insertBefore(v.wrap, this.stack.children[i] ?? null);
    });
    this.layout();
  }

  layout() {
    for (const v of this.views.values()) {
      const s = pageSize(this.geom(v.page));
      v.wrap.style.width = `${s.w}px`;
      v.wrap.style.height = `${s.h}px`;
      this.drawOverlay(v);
    }
    clearTimeout(this.renderTimer);
    this.renderTimer = window.setTimeout(() => { for (const v of this.views.values()) if (v.visible) this.renderPage(v); }, 60);
  }

  private async renderPage(v: PageView) {
    const g = this.geom(v.page);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = pageSize(g);
    let ratio = dpr;
    const maxPx = 14_000_000;
    if (size.w * size.h * ratio * ratio > maxPx) ratio = Math.sqrt(maxPx / (size.w * size.h));
    const key = `${v.page.docId}:${v.page.srcIndex}:${g.rotation}:${g.scale.toFixed(4)}:${ratio.toFixed(3)}`;
    if (v.renderedKey === key) return;
    v.renderedKey = key;
    v.task?.cancel();
    const proxy = store.proxies.get(v.page.docId);
    if (!proxy) return;
    try {
      const pdfPage = await proxy.getPage(v.page.srcIndex + 1);
      const viewport = pdfPage.getViewport({ scale: g.scale * ratio, rotation: g.rotation });
      const off = document.createElement('canvas');
      off.width = Math.floor(viewport.width); off.height = Math.floor(viewport.height);
      const ctx = off.getContext('2d')!;
      const task = pdfPage.render({ canvasContext: ctx, viewport, annotationMode: 0 });
      v.task = task;
      await task.promise;
      if (v.renderedKey !== key) return;
      v.canvas.width = off.width; v.canvas.height = off.height;
      v.canvas.getContext('2d')!.drawImage(off, 0, 0);
      v.task = null;
    } catch (e) {
      if ((e as Error)?.name !== 'RenderingCancelledException') console.warn(e);
      if (v.renderedKey === key) v.renderedKey = '';
    }
  }

  /* ---------------------------------------------------------------- */
  /* Overlays                                                          */
  /* ---------------------------------------------------------------- */

  drawAllOverlays() { for (const v of this.views.values()) this.drawOverlay(v); }

  private drawOverlay(v: PageView) {
    if (this.drag && this.drag.pageId === v.page.id) return; // während Drag nicht neu zeichnen
    const g = this.geom(v.page);
    const fields = store.fields.filter((f) => f.pageId === v.page.id);
    if (store.testMode) { renderTestOverlay(v.overlay, fields, g); return; }
    const single = store.selectedFields.length === 1;
    const order = store.options.showTabOrder ? sortForTabOrder(fields.filter((f) => f.type !== 'reset'), (f) => f.rect, g.rotation) : [];
    v.overlay.replaceChildren();
    for (const f of fields) {
      const r = rectToScreen(g, f.rect);
      const tabIdx = order.indexOf(f);
      const tag = f.type === 'radio' ? `${f.name} · ${f.radioValue}` : f.type === 'reset' ? f.label || 'Zurücksetzen' : f.name;
      const el = h('div.field', {
        'data-id': f.id, 'data-type': f.type, role: 'button', tabindex: '-1',
        'aria-label': `${TYPE_LABEL[f.type]}: ${tag}`,
        style: `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`,
      },
        h('span.field-tag', {}, tag || TYPE_LABEL[f.type]),
        tabIdx >= 0 ? h('span.tab-badge', {}, String(tabIdx + 1)) : null,
      );
      if (f.required) el.classList.add('required');
      if (store.selection.has(f.id)) this.decorateSelected(el, single);
      v.overlay.append(el);
    }
  }

  private decorateSelected(el: HTMLElement, withHandles: boolean) {
    el.classList.add('selected');
    if (withHandles) for (const hd of HANDLES) el.append(h('span.handle', { 'data-handle': hd }));
  }

  scrollToField(id: string) {
    const f = store.fields.find((x) => x.id === id);
    if (!f) return;
    const v = this.views.get(f.pageId);
    if (!v) return;
    const r = rectToScreen(this.geom(v.page), f.rect);
    const top = v.wrap.offsetTop + r.top - this.el.clientHeight / 3;
    const left = v.wrap.offsetLeft + r.left - this.el.clientWidth / 3;
    this.el.scrollTo({ top, left: Math.max(0, left), behavior: 'smooth' });
  }
  scrollToPage(id: string) {
    const v = this.views.get(id);
    if (v) this.el.scrollTo({ top: v.wrap.offsetTop - 16, behavior: 'smooth' });
  }
  currentPageId(): string | null {
    const mid = this.el.scrollTop + this.el.clientHeight / 2;
    let best: string | null = null;
    for (const [id, v] of this.views) if (v.wrap.offsetTop <= mid) best = id;
    return best ?? store.pages[0]?.id ?? null;
  }

  /* ---------------------------------------------------------------- */
  /* Interaktion                                                      */
  /* ---------------------------------------------------------------- */

  private bindOverlay(v: PageView) {
    const ov = v.overlay;
    ov.addEventListener('pointerdown', (e) => this.onPointerDown(e, v));
    ov.addEventListener('pointermove', (e) => this.onPointerMove(e));
    ov.addEventListener('pointerup', (e) => this.onPointerUp(e));
    ov.addEventListener('pointercancel', () => this.cancelDrag());
    ov.addEventListener('dblclick', (e) => {
      const fe = (e.target as HTMLElement).closest<HTMLElement>('.field');
      if (fe) document.dispatchEvent(new CustomEvent('focus-inspector'));
    });
  }

  private local(e: PointerEvent, v: PageView): [number, number] {
    const b = v.overlay.getBoundingClientRect();
    const sx = b.width ? v.overlay.offsetWidth / b.width : 1; // während Pinch skaliert
    return [(e.clientX - b.left) * sx, (e.clientY - b.top) * sx];
  }

  private onPointerDown(e: PointerEvent, v: PageView) {
    if (store.testMode || this.pinch || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const target = e.target as HTMLElement;
    const fieldEl = target.closest<HTMLElement>('.field');
    const [x, y] = this.local(e, v);
    const snaps = this.buildSnaps(v, new Set(fieldEl?.dataset.id ? [fieldEl.dataset.id] : []));

    if (store.tool !== 'select' && !target.classList.contains('handle')) {
      e.preventDefault();
      const el = h('div.field.drawing', { 'data-type': store.tool, style: `left:${x}px;top:${y}px;width:0;height:0` });
      v.overlay.append(el);
      const s = this.snapPoint(x, y, snaps);
      this.drag = { kind: 'draw', pointerId: e.pointerId, pageId: v.page.id, startX: s[0], startY: s[1], orig: { left: s[0], top: s[1], width: 0, height: 0 }, cur: { left: s[0], top: s[1], width: 0, height: 0 }, el, snaps, moved: false, type: store.tool };
      v.overlay.setPointerCapture(e.pointerId);
      return;
    }
    if (!fieldEl) {
      // Auswahlrahmen (nur Maus/Stift, auf Touch bleibt das Scrollen erhalten)
      if (e.pointerType === 'touch') { store.select(null); return; }
      e.preventDefault();
      const el = h('div.marquee', { style: `left:${x}px;top:${y}px;width:0;height:0` });
      v.overlay.append(el);
      const r0 = { left: x, top: y, width: 0, height: 0 };
      this.drag = { kind: 'marquee', pointerId: e.pointerId, pageId: v.page.id, startX: x, startY: y, orig: r0, cur: { ...r0 }, el, snaps, moved: false, additive: e.shiftKey || e.metaKey || e.ctrlKey };
      v.overlay.setPointerCapture(e.pointerId);
      return;
    }
    const f = store.fields.find((ff) => ff.id === fieldEl.dataset.id);
    if (!f) return;
    e.preventDefault();
    if (e.shiftKey || e.metaKey || e.ctrlKey) { store.toggleSelect(f.id); return; }
    const handle = target.dataset.handle as Handle | undefined;
    const inGroup = store.selection.has(f.id) && store.selectedFields.length > 1 && !handle;
    if (!inGroup) store.select(f.id);
    const el = v.overlay.querySelector<HTMLElement>(`.field[data-id="${f.id}"]`)!;
    const box = (n: HTMLElement) => ({ left: n.offsetLeft, top: n.offsetTop, width: n.offsetWidth, height: n.offsetHeight });
    const orig = box(el);
    let group: DragState['group'];
    if (inGroup) {
      group = store.selectedFields.filter((x) => x.id !== f.id && x.pageId === v.page.id).map((x) => {
        const n = v.overlay.querySelector<HTMLElement>(`.field[data-id="${x.id}"]`)!;
        return { id: x.id, el: n, orig: box(n) };
      });
    }
    const excl = new Set([f.id, ...(group ?? []).map((gg) => gg.id)]);
    this.drag = { kind: handle ? 'resize' : 'move', handle, pointerId: e.pointerId, pageId: v.page.id, field: f, startX: x, startY: y, orig, cur: { ...orig }, el, snaps: inGroup ? this.buildSnaps(v, excl) : snaps, moved: false, group };
    v.overlay.setPointerCapture(e.pointerId);
  }

  private onPointerMove(e: PointerEvent) {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId || this.pinch) return;
    const v = this.views.get(d.pageId)!;
    const [x, y] = this.local(e, v);
    const dx = x - d.startX, dy = y - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    d.moved = true;
    const useSnap = store.options.snap && !e.altKey;
    const guides: { x?: number; y?: number }[] = [];
    let { left, top, width, height } = d.orig;

    if (d.kind === 'marquee') {
      left = Math.min(d.startX, x); top = Math.min(d.startY, y); width = Math.abs(x - d.startX); height = Math.abs(y - d.startY);
      d.cur = { left, top, width, height };
      Object.assign(d.el.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
      return;
    }
    if (d.kind === 'move') {
      left += dx; top += dy;
      if (useSnap) {
        const sx = bestSnap([left, left + width / 2, left + width], d.snaps.xs);
        const sy = bestSnap([top, top + height / 2, top + height], d.snaps.ys);
        if (sx) { left += sx.delta; guides.push({ x: sx.target }); }
        if (sy) { top += sy.delta; guides.push({ y: sy.target }); }
      }
    } else if (d.kind === 'resize') {
      const hd = d.handle!;
      let l = left, t = top, r = left + width, b = top + height;
      if (hd.includes('w')) l += dx;
      if (hd.includes('e')) r += dx;
      if (hd.includes('n')) t += dy;
      if (hd.includes('s')) b += dy;
      if (useSnap) {
        if (hd.includes('w')) { const s = bestSnap([l], d.snaps.xs); if (s) { l += s.delta; guides.push({ x: s.target }); } }
        if (hd.includes('e')) { const s = bestSnap([r], d.snaps.xs); if (s) { r += s.delta; guides.push({ x: s.target }); } }
        if (hd.includes('n')) { const s = bestSnap([t], d.snaps.ys); if (s) { t += s.delta; guides.push({ y: s.target }); } }
        if (hd.includes('s')) { const s = bestSnap([b], d.snaps.ys); if (s) { b += s.delta; guides.push({ y: s.target }); } }
      }
      if (e.shiftKey && (d.field?.type === 'check' || d.field?.type === 'radio')) { const m = Math.max(r - l, b - t); r = l + m; b = t + m; }
      left = Math.min(l, r); top = Math.min(t, b); width = Math.max(4, Math.abs(r - l)); height = Math.max(4, Math.abs(b - t));
    } else {
      let [px, py] = [x, y];
      if (useSnap) {
        const s = bestSnap([px], d.snaps.xs); if (s) { px += s.delta; guides.push({ x: s.target }); }
        const t = bestSnap([py], d.snaps.ys); if (t) { py += t.delta; guides.push({ y: t.target }); }
      }
      if (e.shiftKey || d.type === 'check' || d.type === 'radio') {
        const m = Math.max(Math.abs(px - d.startX), Math.abs(py - d.startY));
        if (d.type === 'check' || d.type === 'radio' || e.shiftKey) { px = d.startX + Math.sign(px - d.startX || 1) * m; py = d.startY + Math.sign(py - d.startY || 1) * m; }
      }
      left = Math.min(d.startX, px); top = Math.min(d.startY, py); width = Math.abs(px - d.startX); height = Math.abs(py - d.startY);
    }
    d.cur = { left, top, width, height };
    Object.assign(d.el.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    if (d.group) {
      const ddx = left - d.orig.left, ddy = top - d.orig.top;
      for (const gm of d.group) Object.assign(gm.el.style, { left: `${gm.orig.left + ddx}px`, top: `${gm.orig.top + ddy}px` });
    }
    this.showGuides(v, guides);
  }

  private onPointerUp(e: PointerEvent) {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    this.drag = null;
    const v = this.views.get(d.pageId)!;
    this.showGuides(v, []);
    const g = this.geom(v.page);
    if (d.kind === 'draw') {
      d.el.remove();
      const type = d.type!;
      let { left, top, width, height } = d.cur;
      if (!d.moved || (width < 6 && height < 6)) {
        const def = defaultSize(type);
        width = def.w * g.scale; height = def.h * g.scale;
        left = d.startX; top = d.startY - height / 2;
        if (g.rotation % 180 !== 0) [width, height] = [height, width];
      }
      const rect = screenToRect(g, left, top, width, height);
      this.createField(type, v.page, rect);
      return;
    }
    if (d.kind === 'marquee') {
      d.el.remove();
      const m = d.cur;
      const hit = store.fields.filter((f) => {
        if (f.pageId !== v.page.id) return false;
        const r = rectToScreen(g, f.rect);
        return r.left < m.left + m.width && r.left + r.width > m.left && r.top < m.top + m.height && r.top + r.height > m.top;
      }).map((f) => f.id);
      if (!d.moved) { if (!d.additive) store.select(null); return; }
      store.setSelection(d.additive ? [...new Set([...store.selectedFields.map((f) => f.id), ...hit])] : hit);
      return;
    }
    if (!d.moved || !d.field) { this.drawOverlay(v); return; }
    const rect = screenToRect(g, d.cur.left, d.cur.top, d.cur.width, d.cur.height);
    const id = d.field.id;
    const ddx = d.cur.left - d.orig.left, ddy = d.cur.top - d.orig.top;
    const moves = (d.group ?? []).map((gm) => ({ id: gm.id, rect: screenToRect(g, gm.orig.left + ddx, gm.orig.top + ddy, gm.orig.width, gm.orig.height) }));
    store.commit(() => {
      const f = store.fields.find((x) => x.id === id);
      if (f) f.rect = roundRect(rect);
      for (const mv of moves) { const ff = store.fields.find((x) => x.id === mv.id); if (ff) ff.rect = roundRect(mv.rect); }
    });
  }

  private cancelDrag() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.kind === 'draw' || d.kind === 'marquee') d.el.remove();
    const v = this.views.get(d.pageId);
    if (v) { this.showGuides(v, []); this.drawOverlay(v); }
  }

  createField(type: FieldType, page: PageRef, rect: Rect) {
    const f = newField(type, page.id, roundRect(rect));
    f.name = this.autoName(type, page.id);
    if (type === 'radio') {
      const count = store.fields.filter((x) => x.type === 'radio' && x.name === f.name).length;
      f.radioValue = `Option${count + 1}`;
      this.lastRadio = { name: f.name, pageId: page.id };
    }
    if (type !== 'reset') {
      const a = store.analysis(page);
      const auto = f.name;
      enrichField(f, a, buildLines(a.texts), []);
      const label = f.tooltip !== auto.replace(/_/g, ' ') ? f.tooltip : '';
      if (!label) f.tooltip = '';
      const slug = slugify(label);
      // Name aus der Beschriftung neben/über dem Feld ableiten
      if (slug && type === 'radio') {
        let v = slug, k = 2;
        while (store.fields.some((x) => x.type === 'radio' && x.name === f.name && x.radioValue === v)) v = `${slug}_${k++}`;
        f.radioValue = v;
      } else if (slug) f.name = uniqueName(slug);
    }
    store.commit(() => { store.fields.push(f); });
    store.select(f.id);
    if (type !== 'radio') store.setTool('select');
  }

  private autoName(type: FieldType, pageId: string): string {
    if (type === 'radio' && this.lastRadio && this.lastRadio.pageId === pageId && store.fields.some((f) => f.name === this.lastRadio!.name && f.type === 'radio')) return this.lastRadio.name;
    const base = { text: 'Textfeld', area: 'Textbereich', check: 'Checkbox', radio: 'Auswahl', reset: 'Zuruecksetzen' }[type];
    let n = 1;
    while (store.fields.some((f) => f.name === `${base}_${n}`)) n++;
    return `${base}_${n}`;
  }

  private buildSnaps(v: PageView, exclude: Set<string> = new Set()): SnapSet {
    const g = this.geom(v.page);
    const xs: number[] = [], ys: number[] = [];
    const size = pageSize(g);
    xs.push(0, size.w / 2, size.w); ys.push(0, size.h / 2, size.h);
    const a = store.analysis(v.page);
    const addLine = (p1: [number, number], p2: [number, number]) => {
      if (Math.abs(p1[0] - p2[0]) < 0.5) xs.push(p1[0]); else if (Math.abs(p1[1] - p2[1]) < 0.5) ys.push(p1[1]);
    };
    for (const l of a.snap.xs) addLine(toScreen(g, l.v, l.a), toScreen(g, l.v, l.b));
    for (const l of a.snap.ys) addLine(toScreen(g, l.a, l.v), toScreen(g, l.b, l.v));
    for (const f of store.fields) {
      if (f.pageId !== v.page.id || exclude.has(f.id)) continue;
      const r = rectToScreen(g, f.rect);
      xs.push(r.left, r.left + r.width / 2, r.left + r.width);
      ys.push(r.top, r.top + r.height / 2, r.top + r.height);
    }
    return { xs, ys };
  }

  private snapPoint(x: number, y: number, s: SnapSet): [number, number] {
    if (!store.options.snap) return [x, y];
    const sx = bestSnap([x], s.xs), sy = bestSnap([y], s.ys);
    return [x + (sx?.delta ?? 0), y + (sy?.delta ?? 0)];
  }

  private showGuides(v: PageView, guides: { x?: number; y?: number }[]) {
    v.overlay.querySelectorAll('.guide').forEach((g) => g.remove());
    for (const g of guides) {
      if (g.x !== undefined) v.overlay.append(h('div.guide.v', { style: `left:${g.x}px` }));
      if (g.y !== undefined) v.overlay.append(h('div.guide.h', { style: `top:${g.y}px` }));
    }
  }

  /** Felder per Tastatur verschieben (Pfeiltasten), dx/dy in Bildschirm-Richtung, Einheit pt. */
  nudge(ids: string[], dx: number, dy: number) {
    store.commit(() => {
      for (const id of ids) {
        const f = store.fields.find((x) => x.id === id);
        const p = f && store.page(f.pageId);
        if (!f || !p) continue;
        const g = this.geom(p);
        const r = rectToScreen(g, f.rect);
        f.rect = roundRect(screenToRect(g, r.left + dx * g.scale, r.top + dy * g.scale, r.width, r.height));
      }
    }, ['fields'], 'nudge:' + ids.join(','));
  }

  /* ---------------------------------------------------------------- */
  /* Zoom: Strg+Mausrad, Trackpad (Safari), Pinch auf Touch           */
  /* ---------------------------------------------------------------- */

  zoomAt(newZoom: number, clientX?: number, clientY?: number) {
    const b = this.el.getBoundingClientRect();
    const mx = (clientX ?? b.left + b.width / 2) - b.left;
    const my = (clientY ?? b.top + b.height / 2) - b.top;
    const old = store.zoom;
    const cx = (this.el.scrollLeft + mx) / old, cy = (this.el.scrollTop + my) / old;
    store.setZoom(newZoom);
    this.layout();
    const z = store.zoom;
    this.el.scrollLeft = cx * z - mx;
    this.el.scrollTop = cy * z - my;
  }

  fitWidth() {
    const p = store.pages[0];
    if (!p) return;
    const g = this.geom(p);
    const w = pageSize({ ...g, scale: BASE_SCALE }).w;
    const avail = this.el.clientWidth - 48;
    this.zoomAt(Math.min(2, Math.max(0.25, avail / w)));
  }

  private bindZoomGestures() {
    this.el.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
      this.zoomAt(store.zoom * f, e.clientX, e.clientY);
    }, { passive: false });

    // Safari (macOS) Trackpad-Gesten
    let gStart = 1;
    this.el.addEventListener('gesturestart', (e) => { e.preventDefault(); gStart = store.zoom; });
    this.el.addEventListener('gesturechange', (e) => {
      e.preventDefault();
      if (this.pinch || 'ontouchstart' in window) return; // Touch-Geräte nutzen den Pinch oben
      const ge = e as unknown as { scale: number; clientX: number; clientY: number };
      this.zoomAt(gStart * ge.scale, ge.clientX, ge.clientY);
    });
    this.el.addEventListener('gestureend', (e) => e.preventDefault());

    // Pinch-to-Zoom mit zwei Fingern (Touch-Events, damit iPad/iPhone zuverlässig funktionieren)
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    this.el.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 2) return;
      this.cancelDrag();
      const rect = this.el.getBoundingClientRect();
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      this.pinch = { startDist: dist(e.touches), startZoom: store.zoom, midX, midY, ratio: 1 };
      const ox = this.el.scrollLeft + midX - this.stack.offsetLeft;
      const oy = this.el.scrollTop + midY - this.stack.offsetTop;
      this.stack.style.transformOrigin = `${ox}px ${oy}px`;
    }, { passive: true });
    this.el.addEventListener('touchmove', (e) => {
      if (!this.pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const target = Math.min(4, Math.max(0.25, this.pinch.startZoom * (dist(e.touches) / this.pinch.startDist)));
      this.pinch.ratio = target / this.pinch.startZoom;
      this.stack.style.transform = `scale(${this.pinch.ratio})`;
    }, { passive: false });
    const end = () => {
      if (!this.pinch) return;
      const p = this.pinch;
      this.pinch = null;
      this.stack.style.transform = '';
      const rect = this.el.getBoundingClientRect();
      if (Math.abs(p.ratio - 1) > 0.01) this.zoomAt(p.startZoom * p.ratio, p.midX + rect.left, p.midY + rect.top);
    };
    this.el.addEventListener('touchend', (e) => { if (e.touches.length < 2) end(); });
    this.el.addEventListener('touchcancel', end);
  }
}

function bestSnap(cands: number[], targets: number[]): { delta: number; target: number } | null {
  let best: { delta: number; target: number } | null = null;
  for (const c of cands) for (const t of targets) {
    const d = t - c;
    if (Math.abs(d) <= SNAP_PX && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, target: t };
  }
  return best;
}

function defaultSize(type: FieldType): { w: number; h: number } {
  switch (type) {
    case 'area': return { w: 240, h: 80 };
    case 'check': case 'radio': return { w: 12, h: 12 };
    case 'reset': return { w: 130, h: 24 };
    default: return { w: 170, h: 22 };
  }
}

function roundRect(r: Rect): Rect {
  const q = (n: number) => Math.round(n * 100) / 100;
  return { x: q(r.x), y: q(r.y), w: q(r.w), h: q(r.h) };
}

/** Beschriftung in einen gültigen Feldnamen umwandeln. */
export function slugify(label: string): string {
  return label.trim().replace(/[:*]+$/, '').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}
export function uniqueName(base: string): string {
  if (!store.fields.some((f) => f.name === base)) return base;
  let n = 2;
  while (store.fields.some((f) => f.name === `${base}_${n}`)) n++;
  return `${base}_${n}`;
}
