type Attrs = Record<string, string | number | boolean | undefined | null | EventListener>;
type Child = Node | string | null | undefined | false;

/** Small element helper: h('button.primary', {onclick}, 'Text') */
export function h<T extends HTMLElement = HTMLElement>(tag: string, attrs: Attrs = {}, ...children: (Child | Child[])[]): T {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || "div") as T;
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'html') el.innerHTML = String(v);
    else if (k === 'class') el.className += ' ' + v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export function svg(path: string, size = 18): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

export const icons = {
  select: svg('<path d="M5 3l14 8-6.5 1.5L10 19z"/>'),
  text: svg('<rect x="3" y="7" width="18" height="10" rx="1.5"/><path d="M7 10v4M6 10h2"/>'),
  area: svg('<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M7 8h10M7 12h10M7 16h6"/>'),
  check: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 12.5l2.5 2.5L16 9.5"/>'),
  radio: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/>'),
  dropdown: svg('<rect x="3" y="7" width="18" height="10" rx="1.5"/><path d="M14 11l2 2 2-2"/>'),
  // Button tool (type 'reset' = button with an action): a button with a mouse pointer
  reset: svg('<rect x="2.5" y="5" width="16" height="10" rx="5"/><path d="M14 12l0 9 2.4-2.3 1.7 3.4 1.7-.8-1.7-3.3h3.3z" fill="currentColor" stroke-width="1"/>'),
  // Signature: a signed line
  signature: svg('<path d="M3 19h18"/><path d="M4 14c1.6-3.5 3.2-6 4.6-6 1.9 0-.6 6.5 1.4 6.5 1.6 0 2.4-3 3.8-3 1.2 0 .9 2 2.2 2 .9 0 1.6-.6 2.5-1.4"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
  redo: svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  rotate: svg('<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4h-4"/>', 16),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', 16),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  pages: svg('<rect x="5" y="3" width="12" height="16" rx="1.5"/><path d="M9 21h10V7"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  fileAdd: svg('<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M12 11v6M9 14h6"/>', 16),
  fit: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  sliders: svg('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
};

export function toast(message: string, kind: 'info' | 'warn' | 'error' = 'info', ms = 4200) {
  let host = document.querySelector<HTMLElement>('.toasts');
  if (!host) { host = h('div.toasts', { role: 'status', 'aria-live': 'polite' }); document.body.append(host); }
  const t = h('div.toast', { class: kind }, message);
  host.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

export function isTyping(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}
