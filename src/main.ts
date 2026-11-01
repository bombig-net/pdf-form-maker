import '@fontsource-variable/inter/wght.css';
import './styles.css';
import './features.css';
import './theme.css';
import { store, type Tool } from './state';
import { h, icons, isTyping, svg, toast } from './ui/dom';
import { Viewer } from './ui/viewer';
import { PagesRail } from './ui/pages';
import { Inspector, deleteField, duplicateField } from './ui/inspector';
import { filesFromList, openPdfs, runExport } from './ui/actions';
import { initPdfjs } from './pdf/pdfjs';
import { mountMultiPanel, deleteSelected } from './ui/arrange';
import { mountTestPanel } from './ui/testmode';
import { copySelection, cutSelection, paste } from './ui/clipboard';
import { preflight } from './ui/preflight';
import { mountEmptyHelp } from './ui/help';
import { buildHome, applyTheme } from './ui/home';
import { startAutosave, flushSave } from './ui/recent';
import sampleLayers from './assets/sample-layers.pdf?inline';

const app = document.getElementById('app')!;

/* ------------------------------------------------------------------ */
/* Home                                                                */
/* ------------------------------------------------------------------ */

const openSample = () => openPdfs([{ name: 'sample-layers.pdf', bytes: dataUriToBytes(sampleLayers) }], 'replace');

function dataUriToBytes(uri: string): Uint8Array {
  const b64 = uri.slice(uri.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bindDrop(el: HTMLElement, mode: 'replace' | 'append') {
  let depth = 0;
  el.addEventListener('dragenter', (e) => { if (!e.dataTransfer?.types.includes('Files')) return; e.preventDefault(); depth++; el.classList.add('dropping'); });
  el.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  el.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) el.classList.remove('dropping'); });
  el.addEventListener('drop', async (e) => {
    e.preventDefault(); depth = 0; el.classList.remove('dropping');
    const files = e.dataTransfer?.files;
    if (files?.length) await openPdfs(await filesFromList(files), mode);
  });
}

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

const TOOLS: { t: Tool; label: string; key: string }[] = [
  { t: 'select', label: 'Select', key: 'V' },
  { t: 'text', label: 'Text field', key: 'T' },
  { t: 'area', label: 'Text area', key: 'A' },
  { t: 'check', label: 'Checkbox', key: 'C' },
  { t: 'radio', label: 'Radio button', key: 'R' },
  { t: 'reset', label: 'Reset button', key: 'B' },
];

function buildEditor(): HTMLElement {
  const mergeIn = h<HTMLInputElement>('input', { type: 'file', accept: 'application/pdf,.pdf', multiple: true, hidden: true });
  mergeIn.addEventListener('change', async () => { if (mergeIn.files?.length) await openPdfs(await filesFromList(mergeIn.files), 'append'); mergeIn.value = ''; });

  const viewerEl = h('section.viewer', { 'aria-label': 'Document', 'data-tool': 'select' });
  const viewer = new Viewer(viewerEl);
  const railEl = h('aside.rail', { 'aria-label': 'Page management' });
  new PagesRail(railEl, viewer, () => mergeIn.click());
  const inspEl = h('aside.inspector', { 'aria-label': 'Properties' });
  new Inspector(inspEl, viewer);
  mountMultiPanel(inspEl, viewer);
  mountTestPanel(inspEl);
  mountEmptyHelp(viewerEl);

  // Tools
  const tools = h('div.tools', { role: 'toolbar', 'aria-label': 'Tools' });
  for (const { t, label, key } of TOOLS) {
    const b = h('button.tool', { type: 'button', 'data-tool': t, 'aria-pressed': String(store.tool === t), title: `${label} (${key})`, 'aria-label': label, onclick: () => store.setTool(t) });
    b.innerHTML = icons[t];
    tools.append(b);
  }

  const undo = h<HTMLButtonElement>('button.icon-btn', { type: 'button', title: 'Undo (⌘/Ctrl Z)', 'aria-label': 'Undo', onclick: () => store.undo(), disabled: true });
  undo.innerHTML = icons.undo;
  const redo = h<HTMLButtonElement>('button.icon-btn', { type: 'button', title: 'Redo (⇧⌘/Ctrl Z)', 'aria-label': 'Redo', onclick: () => store.redo(), disabled: true });
  redo.innerHTML = icons.redo;

  const zoomOut = h('button.icon-btn', { type: 'button', 'aria-label': 'Zoom out', title: 'Zoom out', onclick: () => viewer.zoomAt(store.zoom / 1.2) });
  zoomOut.innerHTML = icons.minus;
  const zoomIn = h('button.icon-btn', { type: 'button', 'aria-label': 'Zoom in', title: 'Zoom in', onclick: () => viewer.zoomAt(store.zoom * 1.2) });
  zoomIn.innerHTML = icons.plus;
  const zoomLabel = h('button.zoom-label', { type: 'button', title: 'Fit to width', onclick: () => viewer.fitWidth() }, '100 %');

  const doExport = async () => { if (store.testMode) store.setTestMode(false); if (await preflight(viewer)) await runExport(exportBtn); };
  const exportBtn = h<HTMLButtonElement>('button.btn.primary.export', { type: 'button', onclick: doExport });
  const testBtn = h<HTMLButtonElement>('button.btn.secondary.test-toggle', { type: 'button', 'aria-pressed': 'false', title: 'Fill in the form inside the app (Ctrl/⌘ E)', onclick: () => { store.setTestMode(!store.testMode); if (store.testMode) { inspEl.classList.add('open'); railEl.classList.remove('open'); } } });
  testBtn.innerHTML = `${svg('<path d="M7 5l12 7-12 7z"/>')}<span>Test</span>`;
  exportBtn.innerHTML = `${icons.download}<span>Export PDF</span>`;

  const pagesToggle = h('button.icon-btn.only-narrow', { type: 'button', 'aria-label': 'Show pages', title: 'Pages', onclick: () => { railEl.classList.toggle('open'); inspEl.classList.remove('open'); } });
  pagesToggle.innerHTML = icons.pages;
  const propsToggle = h('button.icon-btn.only-narrow', { type: 'button', 'aria-label': 'Show properties', title: 'Properties', onclick: () => { inspEl.classList.toggle('open'); railEl.classList.remove('open'); } });
  propsToggle.innerHTML = icons.sliders;

  // Back to home: the project is saved automatically, so nothing gets lost
  const back = h('button.icon-btn', { type: 'button', title: 'Back to home', 'aria-label': 'Back to home', onclick: async () => { if (store.testMode) store.setTestMode(false); await flushSave(); store.reset(); } });
  back.innerHTML = icons.back;

  const title = h('span.doc-title');
  const bar = h('header.bar', {},
    h('div.bar-left', {}, back, h('span.mark.small', { 'aria-hidden': 'true' }, h('span.ink.c'), h('span.ink.m'), h('span.ink.y'), h('span.ink.k')), title),
    tools,
    h('div.bar-right', {}, pagesToggle, undo, redo, h('span.sep'), zoomOut, zoomLabel, zoomIn, h('span.sep'), propsToggle, testBtn, exportBtn),
    mergeIn);

  const editor = h('div.editor', {}, bar, railEl, viewerEl, inspEl);
  bindDrop(viewerEl, 'append');

  store.subscribe((k) => {
    if (k.has('tool')) tools.querySelectorAll<HTMLElement>('.tool').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === store.tool)));
    if (k.has('zoom') || k.has('doc')) zoomLabel.textContent = `${Math.round(store.zoom * 100)} %`;
    if (k.has('history') || k.has('doc')) { undo.disabled = !store.canUndo; redo.disabled = !store.canRedo; }
    if (k.has('doc')) { title.textContent = store.fileName; title.title = store.fileName; }
    if (k.has('mode') || k.has('doc')) {
      editor.classList.toggle('testing', store.testMode);
      testBtn.setAttribute('aria-pressed', String(store.testMode));
      testBtn.querySelector('span')!.textContent = store.testMode ? 'Edit' : 'Test';
    }
    if (k.has('selection') && store.selectedId && window.matchMedia('(max-width: 899px)').matches) {
      // on narrow screens don't open properties automatically – just hint via the button
      propsToggle.classList.add('pulse'); setTimeout(() => propsToggle.classList.remove('pulse'), 900);
    }
  });

  // Keyboard
  window.addEventListener('keydown', (e) => {
    if (!store.hasDocument) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); store.setTestMode(!store.testMode); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); doExport(); return; }
    if (store.testMode) { if (e.key === 'Escape') store.setTestMode(false); return; }
    if (mod && !isTyping(e)) {
      const k = e.key.toLowerCase();
      if (k === 'c' && copySelection()) { e.preventDefault(); return; }
      if (k === 'x' && cutSelection()) { e.preventDefault(); return; }
      if (k === 'v' && paste(viewer)) { e.preventDefault(); return; }
      if (k === 'a') { e.preventDefault(); const pid = viewer.currentPageId(); store.setSelection(store.fields.filter((f) => f.pageId === pid).map((f) => f.id)); return; }
    }
    if (mod && e.key.toLowerCase() === 'z') { if (isTyping(e)) return; e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { if (isTyping(e)) return; e.preventDefault(); store.redo(); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); if (store.selectedId) duplicateField(store.selectedId); return; }
    if (mod && (e.key === '+' || e.key === '=')) { e.preventDefault(); viewer.zoomAt(store.zoom * 1.2); return; }
    if (mod && e.key === '-') { e.preventDefault(); viewer.zoomAt(store.zoom / 1.2); return; }
    if (mod && e.key === '0') { e.preventDefault(); viewer.fitWidth(); return; }
    if (isTyping(e) || mod || e.altKey) return;
    const sel = store.selectedId;
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); if (store.selectedFields.length > 1) deleteSelected(); else deleteField(sel); return; }
    if (e.key === 'Escape') { if (store.tool !== 'select') store.setTool('select'); else store.select(null); return; }
    if (sel && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key as 'ArrowLeft'];
      if (d) viewer.nudge(store.selectedFields.map((f) => f.id), d[0], d[1]);
      return;
    }
    const tool = TOOLS.find((t) => t.key.toLowerCase() === e.key.toLowerCase());
    if (tool) store.setTool(tool.t);
  });

  // First load: fit to width
  store.subscribe((k) => { if (k.has('doc') && store.hasDocument) requestAnimationFrame(() => viewer.fitWidth()); });
  window.addEventListener('resize', () => { if (window.matchMedia('(min-width: 900px)').matches) { railEl.classList.remove('open'); inspEl.classList.remove('open'); } });
  viewerEl.addEventListener('pointerdown', () => { railEl.classList.remove('open'); });
  return editor;
}

/* ------------------------------------------------------------------ */

applyTheme();
startAutosave();
const start = buildHome(openSample);
const editor = buildEditor();
app.append(start);

store.subscribe((k) => {
  if (!k.has('doc')) return;
  if (store.hasDocument && start.isConnected) { start.replaceWith(editor); }
  else if (!store.hasDocument && editor.isConnected) editor.replaceWith(start);
});

// Files dropped next to the drop zone must not navigate the browser away
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

initPdfjs().catch(() => toast('The PDF renderer could not be loaded. Please reload the page.', 'error', 10000));
