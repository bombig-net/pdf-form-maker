import { store } from '../state';
import type { Field } from '../types';
import { h, svg } from './dom';
import { rectToScreen, screenToRect, round2 } from '../util/geom';
import { fromHex, toHex } from '../util/color';
import type { Viewer } from './viewer';

type Box = { left: number; top: number; width: number; height: number };
type Op = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom' | 'hdist' | 'vdist' | 'samew' | 'sameh';

const ICON: Record<Op, string> = {
  left: svg('<path d="M4 3v18"/><rect x="7" y="6" width="12" height="4" rx="1"/><rect x="7" y="14" width="7" height="4" rx="1"/>'),
  hcenter: svg('<path d="M12 3v18"/><rect x="5" y="6" width="14" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/>'),
  right: svg('<path d="M20 3v18"/><rect x="5" y="6" width="12" height="4" rx="1"/><rect x="10" y="14" width="7" height="4" rx="1"/>'),
  top: svg('<path d="M3 4h18"/><rect x="6" y="7" width="4" height="12" rx="1"/><rect x="14" y="7" width="4" height="7" rx="1"/>'),
  vcenter: svg('<path d="M3 12h18"/><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/>'),
  bottom: svg('<path d="M3 20h18"/><rect x="6" y="5" width="4" height="12" rx="1"/><rect x="14" y="10" width="4" height="7" rx="1"/>'),
  hdist: svg('<path d="M3 4v16M21 4v16"/><rect x="9" y="8" width="6" height="8" rx="1"/>'),
  vdist: svg('<path d="M4 3h16M4 21h16"/><rect x="8" y="9" width="8" height="6" rx="1"/>'),
  samew: svg('<path d="M4 12h16M7 9l-3 3 3 3M17 9l3 3-3 3"/>'),
  sameh: svg('<path d="M12 4v16M9 7l3-3 3 3M9 17l3 3 3-3"/>'),
};
const LABEL: Record<Op, string> = {
  left: 'Align left', hcenter: 'Align horizontal centers', right: 'Align right',
  top: 'Align top', vcenter: 'Align vertical centers', bottom: 'Align bottom',
  hdist: 'Distribute horizontally', vdist: 'Distribute vertically',
  samew: 'Match width of the last selected field', sameh: 'Match height of the last selected field',
};

/** Align/distribute in screen direction, separately per page. */
export function arrange(viewer: Viewer, op: Op) {
  const sel = store.selectedFields;
  if (sel.length < 2) return;
  const primary = store.selected ?? sel[sel.length - 1];
  store.commit(() => {
    const byPage = new Map<string, Field[]>();
    for (const f of sel) { const l = byPage.get(f.pageId) ?? []; l.push(f); byPage.set(f.pageId, l); }
    for (const [pageId, list] of byPage) {
      const page = store.page(pageId);
      if (!page || list.length < 2) continue;
      const g = viewer.geom(page);
      const boxes = list.map((f) => ({ f, b: rectToScreen(g, f.rect) as Box }));
      const L = Math.min(...boxes.map((x) => x.b.left)), T = Math.min(...boxes.map((x) => x.b.top));
      const R = Math.max(...boxes.map((x) => x.b.left + x.b.width)), B = Math.max(...boxes.map((x) => x.b.top + x.b.height));
      const ref = primary.pageId === pageId ? rectToScreen(g, primary.rect) : boxes[0].b;
      if (op === 'hdist' || op === 'vdist') {
        if (boxes.length < 3) continue;
        const horiz = op === 'hdist';
        boxes.sort((a, b) => (horiz ? a.b.left - b.b.left : a.b.top - b.b.top));
        const total = boxes.reduce((s, x) => s + (horiz ? x.b.width : x.b.height), 0);
        const gap = ((horiz ? R - L : B - T) - total) / (boxes.length - 1);
        let pos = horiz ? L : T;
        for (const x of boxes) {
          if (horiz) x.b.left = pos; else x.b.top = pos;
          pos += (horiz ? x.b.width : x.b.height) + gap;
        }
      } else {
        for (const x of boxes) {
          const b = x.b;
          switch (op) {
            case 'left': b.left = L; break;
            case 'right': b.left = R - b.width; break;
            case 'hcenter': b.left = (L + R) / 2 - b.width / 2; break;
            case 'top': b.top = T; break;
            case 'bottom': b.top = B - b.height; break;
            case 'vcenter': b.top = (T + B) / 2 - b.height / 2; break;
            case 'samew': b.width = ref.width; break;
            case 'sameh': b.height = ref.height; break;
          }
        }
      }
      for (const x of boxes) {
        const r = screenToRect(g, x.b.left, x.b.top, x.b.width, x.b.height);
        x.f.rect = { x: round2(r.x), y: round2(r.y), w: round2(r.w), h: round2(r.h) };
      }
    }
  });
}

export function deleteSelected() {
  const ids = new Set(store.selectedFields.map((f) => f.id));
  if (!ids.size) return;
  store.commit(() => { store.fields = store.fields.filter((f) => !ids.has(f.id)); }, ['fields']);
  store.setSelection([]);
}

/** Panel for multi-selection (replaces the properties panel while several fields are selected). */
export function mountMultiPanel(inspector: HTMLElement, viewer: Viewer) {
  const panel = h('div.panel.side-panel.multi-panel');
  inspector.prepend(panel);
  const render = () => {
    const sel = store.testMode ? [] : store.selectedFields;
    const multi = sel.length > 1;
    inspector.classList.toggle('multi', multi);
    panel.hidden = !multi;
    if (!multi) return;

    const btn = (op: Op, disabled = false) => {
      const b = h<HTMLButtonElement>('button.icon-btn', { type: 'button', title: LABEL[op], 'aria-label': LABEL[op], disabled, onclick: () => arrange(viewer, op) });
      b.innerHTML = ICON[op];
      return b;
    };
    const pages = new Set(sel.map((f) => f.pageId)).size;
    const texty = sel.filter((f) => f.type === 'text' || f.type === 'area' || f.type === 'dropdown' || f.type === 'reset');
    const sizes = new Set(texty.map((f) => f.fontSize));
    const colors = new Set(sel.map((f) => toHex(f.color)));
    const allReq = sel.every((f) => f.required);
    const setAll = (fn: (f: Field) => void) => {
      const ids = new Set(sel.map((f) => f.id));
      store.commit(() => { for (const f of store.fields) if (ids.has(f.id)) fn(f); }, ['fields'], 'multi:' + [...ids].join(','));
    };

    const size = h<HTMLInputElement>('input', {
      type: 'number', min: 0, step: 0.5, inputmode: 'decimal', placeholder: sizes.size > 1 ? 'mixed' : 'auto',
      value: sizes.size === 1 && [...sizes][0] ? String([...sizes][0]) : '',
      oninput: (e: Event) => { const v = parseFloat((e.target as HTMLInputElement).value.replace(',', '.')); setAll((f) => { if (f.type !== 'check' && f.type !== 'radio') f.fontSize = isNaN(v) ? 0 : Math.max(0, Math.min(144, v)); }); },
    });
    const color = h<HTMLInputElement>('input', { type: 'color', value: colors.size === 1 ? [...colors][0] : '#000000', oninput: (e: Event) => setAll((f) => (f.color = fromHex((e.target as HTMLInputElement).value))) });
    const req = h<HTMLInputElement>('input', { type: 'checkbox', role: 'switch', id: 'multi-req', checked: allReq, onchange: (e: Event) => setAll((f) => { if (f.type !== 'reset') f.required = (e.target as HTMLInputElement).checked; }) });

    const del = h('button.btn.danger', { type: 'button', onclick: deleteSelected });
    del.innerHTML = `${svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', 16)}<span>Delete ${sel.length} fields</span>`;

    panel.replaceChildren(...([
      h('div.panel-head', {}, h('h2.panel-title', {}, `${sel.length} fields selected`),
        (() => { const c = h('button.icon-btn', { type: 'button', 'aria-label': 'Clear selection', title: 'Clear selection', onclick: () => store.select(null) }); c.innerHTML = svg('<path d="M6 6l12 12M18 6L6 18"/>'); return c; })()),
      pages > 1 ? h('p.hint', {}, 'The selection spans several pages. Alignment applies per page.') : null,
      h('h3.section-title', {}, 'Align'),
      h('div.arrange-row', {}, btn('left'), btn('hcenter'), btn('right'), h('span.sep'), btn('top'), btn('vcenter'), btn('bottom')),
      h('h3.section-title', {}, 'Distribute and match'),
      h('div.arrange-row', {}, btn('hdist', sel.length < 3), btn('vdist', sel.length < 3), h('span.sep'), btn('samew'), btn('sameh')),
      h('h3.section-title', {}, 'Shared properties'),
      texty.length ? h('div.row', {}, h('label', {}, 'Font size'), h('div.row-control', {}, size, h('span.suffix', {}, 'pt'))) : null,
      h('div.row', {}, h('label', {}, 'Color'), h('div.row-control', {}, color)),
      h('div.toggle-row', {}, req, h('label', { for: 'multi-req' }, 'Required')),
      h('p.hint', {}, 'Shift-click adds or removes fields. Arrow keys move the whole selection.'),
      h('div.panel-actions', {}, del)].filter(Boolean) as Node[]));
  };
  store.subscribe((k) => { if (k.has('selection') || k.has('mode') || k.has('doc') || (k.has('fields') && !panel.contains(document.activeElement))) render(); });
  render();
}
