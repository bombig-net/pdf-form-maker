import { store, type ChangeKind } from '../state';
import { h, icons } from './dom';
import type { Viewer } from './viewer';
import type { PageRef } from '../types';

const THUMB_W = 112;

export class PagesRail {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private thumbs = new Map<string, { el: HTMLElement; canvas: HTMLCanvasElement; key: string }>();
  private justDragged = false;
  private drag: { id: string; pointerId: number; startY: number; active: boolean; el: HTMLElement; marker: HTMLElement; target: number } | null = null;

  constructor(host: HTMLElement, private viewer: Viewer, onMerge: () => void) {
    this.el = host;
    this.list = h('ol.thumbs', { 'aria-label': 'Pages' });
    const merge = h('button.rail-add', { type: 'button', onclick: onMerge, title: 'Append another PDF' });
    merge.innerHTML = `${icons.fileAdd}<span>Append PDF</span>`;
    host.append(h('div.rail-head', {}, h('span', {}, 'Pages'), h('span.rail-count')), this.list, merge);
    store.subscribe((k) => this.onChange(k));
  }

  private onChange(k: Set<ChangeKind>) {
    if (k.has('pages') || k.has('doc')) this.rebuild();
    if (k.has('fields') || k.has('pages')) this.updateCounts();
  }

  private rebuild() {
    const keep = new Set(store.pages.map((p) => p.id));
    for (const [id, t] of this.thumbs) if (!keep.has(id)) { t.el.remove(); this.thumbs.delete(id); }
    store.pages.forEach((p, i) => {
      let t = this.thumbs.get(p.id);
      if (!t) {
        const canvas = h<HTMLCanvasElement>('canvas');
        const rot = h('button.icon-btn', { type: 'button', title: 'Rotate page', 'aria-label': 'Rotate page by 90°', onclick: (e: Event) => { e.stopPropagation(); this.rotate(p.id); } });
        rot.innerHTML = icons.rotate;
        const del = h('button.icon-btn.danger', { type: 'button', title: 'Delete page', 'aria-label': 'Delete page', onclick: (e: Event) => { e.stopPropagation(); this.remove(p.id); } });
        del.innerHTML = icons.trash;
        const el = h('li.thumb', { 'data-id': p.id, tabindex: '0' },
          h('div.thumb-paper', {}, canvas, h('span.thumb-fields')),
          h('div.thumb-meta', {}, h('span.grip', { title: 'Drag to reorder', 'aria-hidden': 'true' }), h('span.thumb-num'), h('span.thumb-actions', {}, rot, del)));
        el.addEventListener('pointerdown', (e) => this.onDown(e, p.id));
        el.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('button') || this.justDragged) return;
          this.viewer.scrollToPage(p.id);
        });
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') this.viewer.scrollToPage(p.id);
          if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.altKey) { e.preventDefault(); this.move(p.id, store.pages.findIndex((x) => x.id === p.id) + (e.key === 'ArrowUp' ? -1 : 1)); }
        });
        t = { el, canvas, key: '' };
        this.thumbs.set(p.id, t);
      }
      (t.el.querySelector('.thumb-num') as HTMLElement).textContent = String(i + 1);
      t.el.setAttribute('aria-label', `Page ${i + 1}`);
      if (this.list.children[i] !== t.el) this.list.insertBefore(t.el, this.list.children[i] ?? null);
      this.renderThumb(p, t);
    });
    (this.el.querySelector('.rail-count') as HTMLElement).textContent = String(store.pages.length);
  }

  private updateCounts() {
    for (const [id, t] of this.thumbs) {
      const n = store.fields.filter((f) => f.pageId === id).length;
      const badge = t.el.querySelector('.thumb-fields') as HTMLElement;
      badge.textContent = n ? String(n) : '';
      badge.title = n ? `${n} fields` : '';
    }
  }

  private async renderThumb(p: PageRef, t: { canvas: HTMLCanvasElement; key: string }) {
    const a = store.analysis(p);
    const rotation = (((a.baseRotate + p.rotation) % 360) + 360) % 360;
    const key = `${p.docId}:${p.srcIndex}:${rotation}`;
    if (t.key === key) return;
    t.key = key;
    const proxy = store.proxies.get(p.docId);
    if (!proxy) return;
    try {
      const page = await proxy.getPage(p.srcIndex + 1);
      const vp0 = page.getViewport({ scale: 1, rotation });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const vp = page.getViewport({ scale: (THUMB_W / vp0.width) * ratio, rotation });
      t.canvas.width = Math.floor(vp.width); t.canvas.height = Math.floor(vp.height);
      t.canvas.style.aspectRatio = `${vp.width} / ${vp.height}`;
      await page.render({ canvasContext: t.canvas.getContext('2d')!, viewport: vp, annotationMode: 0 }).promise;
    } catch { t.key = ''; }
  }

  rotate(id: string) {
    store.commit(() => { const p = store.page(id); if (p) p.rotation = (p.rotation + 90) % 360; }, ['pages']);
  }

  remove(id: string) {
    if (store.pages.length <= 1) return;
    store.commit(() => {
      store.pages = store.pages.filter((p) => p.id !== id);
      store.fields = store.fields.filter((f) => f.pageId !== id);
      if (store.selected?.pageId === id) store.selectedId = null;
    }, ['pages', 'fields', 'selection']);
  }

  move(id: string, to: number) {
    const from = store.pages.findIndex((p) => p.id === id);
    to = Math.max(0, Math.min(store.pages.length - 1, to));
    if (from < 0 || from === to) return;
    store.commit(() => {
      const [p] = store.pages.splice(from, 1);
      store.pages.splice(to, 0, p);
    }, ['pages']);
    requestAnimationFrame(() => (this.thumbs.get(id)?.el as HTMLElement | undefined)?.focus());
  }

  /* Reorder by dragging (mouse and touch) */
  private onDown(e: PointerEvent, id: string) {
    if ((e.target as HTMLElement).closest('button')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // On touch devices only drag via the grip so the list stays scrollable
    if (e.pointerType !== 'mouse' && !(e.target as HTMLElement).closest('.grip')) return;
    const el = this.thumbs.get(id)!.el;
    const marker = h('div.drop-marker');
    this.drag = { id, pointerId: e.pointerId, startY: e.clientY, active: false, el, marker, target: -1 };
    const move = (ev: PointerEvent) => this.onMove(ev);
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      d.el.classList.remove('dragging');
      d.marker.remove();
      if (!d.active) return;
      this.justDragged = true;
      setTimeout(() => (this.justDragged = false), 50);
      if (ev.type === 'pointercancel') return;
      const from = store.pages.findIndex((p) => p.id === id);
      const to = d.target > from ? d.target - 1 : d.target;
      if (d.target >= 0) this.move(id, to);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  private onMove(e: PointerEvent) {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.active) {
      if (Math.abs(e.clientY - d.startY) < 8) return;
      d.active = true;
      d.el.classList.add('dragging');
      this.list.append(d.marker);
    }
    e.preventDefault();
    const items = [...this.list.querySelectorAll<HTMLElement>('.thumb')];
    let target = items.length;
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { target = i; break; }
    }
    d.target = target;
    const ref = items[target];
    const listRect = this.list.getBoundingClientRect();
    const y = ref ? ref.getBoundingClientRect().top - listRect.top + this.list.scrollTop - 6 : (items[items.length - 1].getBoundingClientRect().bottom - listRect.top + this.list.scrollTop + 4);
    d.marker.style.top = `${y}px`;
    // Auto-scroll
    if (e.clientY < listRect.top + 30) this.list.scrollTop -= 8;
    if (e.clientY > listRect.bottom - 30) this.list.scrollTop += 8;
  }
}
