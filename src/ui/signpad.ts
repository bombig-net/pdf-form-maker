import { h } from './dom';

/*
 * Signature dialog for test mode: draw with mouse, finger or pen, or type the name in a script face.
 * Returns a transparent PNG (data URL) cropped to the ink, or null when cancelled.
 * '' means the existing signature was removed.
 */

const INK = '#1b2a5a';
const SCRIPT = '"Segoe Script", "Snell Roundhand", "Bradley Hand", "Brush Script MT", "Apple Chancery", cursive';

export function signDialog(opts: { aspect: number; hasSignature: boolean }): Promise<string | null> {
  return new Promise((resolve) => {
    let result: string | null = null;
    let mode: 'draw' | 'type' = 'draw';
    const W = 520, H = Math.round(Math.min(220, Math.max(120, W / Math.max(1.5, opts.aspect))));
    const dpr = Math.min(window.devicePixelRatio || 1, 3);

    // Draw
    const canvas = h<HTMLCanvasElement>('canvas.sign-canvas', { width: W * dpr, height: H * dpr, style: `height:${H}px`, 'aria-label': 'Draw your signature' });
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = INK;
    let drawn = false;
    let last: { x: number; y: number; t: number; w: number } | null = null;
    const pos = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) }; };
    canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); const p = pos(e); last = { ...p, t: e.timeStamp, w: 2.4 }; e.preventDefault(); });
    canvas.addEventListener('pointermove', (e) => {
      if (!last) return;
      const p = pos(e);
      const dist = Math.hypot(p.x - last.x, p.y - last.y);
      if (dist < 0.8) return;
      // Faster strokes are thinner; pen pressure counts too
      const speed = dist / Math.max(1, e.timeStamp - last.t);
      const pressure = e.pointerType === 'pen' && e.pressure > 0 ? 0.6 + e.pressure : 1;
      const w = Math.max(1.1, Math.min(3.4, (3.2 - speed * 1.4) * pressure)) * 0.5 + last.w * 0.5;
      ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      last = { ...p, t: e.timeStamp, w };
      drawn = true; adopt.disabled = false;
    });
    const end = () => { last = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    const clear = h('button.btn.secondary.small', { type: 'button', onclick: () => { ctx.clearRect(0, 0, W, H); drawn = false; adopt.disabled = mode === 'draw' || !typed.value.trim(); } }, 'Clear');
    const drawPane = h('div.sign-pane', {}, h('div.sign-area', {}, canvas, h('span.sign-line', { 'aria-hidden': 'true' })), h('div.sign-tools', {}, clear, h('span.hint', {}, 'Draw with mouse, finger or pen')));

    // Type
    const typed = h<HTMLInputElement>('input.sign-input', { type: 'text', placeholder: 'Your name', 'aria-label': 'Your name', autocomplete: 'name' });
    const preview = h('div.sign-typed', { style: `font-family:${SCRIPT}` });
    typed.addEventListener('input', () => { preview.textContent = typed.value; adopt.disabled = !typed.value.trim(); });
    const typePane = h('div.sign-pane', { hidden: true }, typed, h('div.sign-area.typed', {}, preview, h('span.sign-line', { 'aria-hidden': 'true' })));

    const tab = (m: 'draw' | 'type', label: string) => h<HTMLButtonElement>('button.sign-tab', { type: 'button', role: 'tab', 'aria-selected': String(m === mode), onclick: () => {
      mode = m;
      tabs.forEach((t) => t.setAttribute('aria-selected', String(t === (m === 'draw' ? tabs[0] : tabs[1]))));
      drawPane.hidden = m !== 'draw'; typePane.hidden = m !== 'type';
      adopt.disabled = m === 'draw' ? !drawn : !typed.value.trim();
      if (m === 'type') typed.focus();
    } }, label);
    const tabs = [tab('draw', 'Draw'), tab('type', 'Type')];

    const adopt = h<HTMLButtonElement>('button.btn.primary', { type: 'button', disabled: true, onclick: () => { result = mode === 'draw' ? crop(canvas) : renderTyped(typed.value.trim()); dlg.close(); } }, 'Sign');
    const remove = opts.hasSignature ? h('button.btn.secondary', { type: 'button', onclick: () => { result = ''; dlg.close(); } }, 'Remove signature') : null;
    const dlg = h<HTMLDialogElement>('dialog.modal.sign-dialog', { 'aria-labelledby': 'sign-title' },
      h('h2', { id: 'sign-title' }, 'Sign'),
      h('p', {}, 'The signature is placed in the filled-in PDF you download. It is a picture of your signature, not a certificate-based digital signature.'),
      h('div.sign-tabs', { role: 'tablist' }, ...tabs), drawPane, typePane,
      h('div.modal-actions', {}, remove, h('span.spacer'), h('button.btn.secondary', { type: 'button', onclick: () => dlg.close() }, 'Cancel'), adopt));
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

/** Crops the drawing to the ink, with a little air, as a transparent PNG. */
function crop(src: HTMLCanvasElement): string {
  const c = src.getContext('2d')!;
  const { width: w, height: hh } = src;
  const data = c.getImageData(0, 0, w, hh).data;
  let x0 = w, y0 = hh, x1 = 0, y1 = 0;
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 <= x0 || y1 <= y0) return src.toDataURL('image/png');
  const pad = 6;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(hh - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext('2d')!.drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

/** Renders a typed name in the script face as a transparent PNG. */
function renderTyped(name: string): string {
  const size = 96;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  ctx.font = `${size}px ${SCRIPT}`;
  const w = Math.ceil(ctx.measureText(name).width) + 24;
  c.width = w; c.height = Math.round(size * 1.5);
  ctx.font = `${size}px ${SCRIPT}`;
  ctx.fillStyle = INK;
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 12, c.height / 2);
  return c.toDataURL('image/png');
}
