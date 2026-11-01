import '@fontsource-variable/inter/wght.css';
import './styles.css';
import './features.css';
import './home.css';
import './workspace.css';
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
import { startAutosave, flushSave, saveProjectFile } from './ui/recent';
import { FieldList } from './ui/fieldlist';
import { suggestAllFields } from './ui/extras';
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
  { t: 'hand', label: 'Hand: move the view (or hold Space)', key: 'H' },
  { t: 'text', label: 'Text field', key: 'T' },
  { t: 'area', label: 'Text area', key: 'A' },
  { t: 'check', label: 'Checkbox', key: 'C' },
  { t: 'radio', label: 'Radio button', key: 'R' },
  { t: 'dropdown', label: 'Dropdown', key: 'D' },
  { t: 'reset', label: 'Button', key: 'B' },
  { t: 'signature', label: 'Signature', key: 'S' },
];
const TOOL_ICONS: Record<Tool, string> = {
  ...icons,
  hand: svg('<path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5M14 10.5V5.5a1.5 1.5 0 0 1 3 0V13M17 9.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.7-2.3L4.3 14.4a1.5 1.5 0 0 1 2.3-1.9L8 14"/>'),
};

/** Small popup menu below a button; closes on a choice, Escape or a click outside. */
function menu(button: HTMLButtonElement, items: (({ label: string; hint?: string; run: () => void }) | 'sep')[]): HTMLElement {
  const pop = h('div.menu', { role: 'menu', hidden: true });
  const close = () => { pop.hidden = true; button.setAttribute('aria-expanded', 'false'); };
  for (const it of items) {
    if (it === 'sep') { pop.append(h('div.menu-sep', { role: 'separator' })); continue; }
    pop.append(h('button.menu-item', { type: 'button', role: 'menuitem', onclick: () => { close(); it.run(); } },
      h('span', {}, it.label), it.hint ? h('kbd', {}, it.hint) : null));
  }
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = pop.hidden;
    document.querySelectorAll<HTMLElement>('.menu').forEach((m) => { m.hidden = true; });
    pop.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) (pop.querySelector('.menu-item') as HTMLElement | null)?.focus();
  });
  document.addEventListener('click', (e) => { if (!pop.contains(e.target as Node)) close(); });
  pop.addEventListener('keydown', (e) => {
    const items = [...pop.querySelectorAll<HTMLElement>('.menu-item')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { close(); button.focus(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  });
  return pop;
}

function buildEditor(): HTMLElement {
  const pdfInput = (mode: 'replace' | 'append') => {
    const input = h<HTMLInputElement>('input', { type: 'file', accept: 'application/pdf,.pdf', multiple: mode === 'append', hidden: true });
    input.addEventListener('change', async () => { if (input.files?.length) { if (mode === 'replace') await flushSave(); await openPdfs(await filesFromList(input.files), mode); } input.value = ''; });
    return input;
  };
  const mergeIn = pdfInput('append');
  const replaceIn = pdfInput('replace');

  const viewerEl = h('section.viewer', { 'aria-label': 'Document', 'data-tool': 'select' });
  const viewer = new Viewer(viewerEl);

  // Left sidebar: pages and fields
  const pagesPane = h('div.side-pane.rail-pages', { role: 'tabpanel', id: 'pane-pages' });
  new PagesRail(pagesPane, viewer, () => mergeIn.click());
  const fieldsPane = h('div.side-pane', { role: 'tabpanel', id: 'pane-fields', hidden: true });
  new FieldList(fieldsPane, viewer);
  const tab = (id: 'pages' | 'fields', label: string) => h<HTMLButtonElement>('button.side-tab', { type: 'button', role: 'tab', 'aria-controls': `pane-${id}`, 'data-tab': id }, label);
  const tabs = [tab('pages', 'Pages'), tab('fields', 'Fields')];
  const showTab = (id: string) => {
    for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.tab === id));
    pagesPane.hidden = id !== 'pages'; fieldsPane.hidden = id !== 'fields';
    try { localStorage.setItem('pfm-side', id); } catch { /* ignore */ }
  };
  tabs.forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab!)));
  let savedTab = 'pages';
  try { savedTab = localStorage.getItem('pfm-side') ?? 'pages'; } catch { /* ignore */ }
  showTab(savedTab === 'fields' ? 'fields' : 'pages');
  const railEl = h('aside.rail.side', { 'aria-label': 'Pages and fields' }, h('div.side-tabs', { role: 'tablist' }, ...tabs), pagesPane, fieldsPane);

  const inspEl = h('aside.inspector', { 'aria-label': 'Properties' });
  new Inspector(inspEl, viewer);
  mountMultiPanel(inspEl, viewer);
  mountTestPanel(inspEl);
  mountEmptyHelp(viewerEl);

  // Vertical tool bar, like in layout apps
  const tools = h('div.tools.toolrail', { role: 'toolbar', 'aria-label': 'Tools', 'aria-orientation': 'vertical' });
  TOOLS.forEach(({ t, label, key }, i) => {
    if (i === 2) tools.append(h('span.tool-sep', { 'aria-hidden': 'true' }));
    const b = h('button.tool', { type: 'button', 'data-tool': t, 'aria-pressed': String(store.tool === t), title: `${label} (${key})`, 'aria-label': label, onclick: () => store.setTool(t) });
    b.innerHTML = TOOL_ICONS[t];
    tools.append(b);
  });

  const undo = h<HTMLButtonElement>('button.icon-btn', { type: 'button', title: 'Undo (\u2318/Ctrl Z)', 'aria-label': 'Undo', onclick: () => store.undo(), disabled: true });
  undo.innerHTML = icons.undo;
  const redo = h<HTMLButtonElement>('button.icon-btn', { type: 'button', title: 'Redo (\u21e7\u2318/Ctrl Z)', 'aria-label': 'Redo', onclick: () => store.redo(), disabled: true });
  redo.innerHTML = icons.redo;

  const doExport = async () => { if (store.testMode) store.setTestMode(false); if (await preflight(viewer)) await runExport(exportBtn); };
  const exportBtn = h<HTMLButtonElement>('button.btn.primary.export', { type: 'button', onclick: doExport });
  exportBtn.innerHTML = `${icons.download}<span>Export PDF</span>`;

  // Preview of the field content (placeholder, buttons, marks) as in the PDF
  const togglePreview = () => {
    store.options.preview = !store.options.preview;
    try { localStorage.setItem('pfm-preview', store.options.preview ? '1' : '0'); } catch { /* ignore */ }
    store.emit('options');
  };
  const previewBtn = h<HTMLButtonElement>('button.btn.ghost.preview-toggle', { type: 'button', title: 'Show field content as in the PDF (P)', 'aria-pressed': String(store.options.preview), onclick: togglePreview });
  previewBtn.innerHTML = `${svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>')}<span>Preview</span>`;
  const detectBtn = h<HTMLButtonElement>('button.btn.ghost.detect', { type: 'button', title: 'Suggest fields for empty boxes, lines and checkboxes', onclick: () => suggestAllFields((id) => viewer.scrollToField(id)) });
  detectBtn.innerHTML = `${svg('<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>')}<span>Auto-detect</span>`;

  // Design | Test
  const modeBtn = (test: boolean, label: string) => h<HTMLButtonElement>('button.mode-btn', { type: 'button', role: 'radio', 'data-test': String(test), title: test ? 'Fill in the form inside the app (\u2318/Ctrl E)' : 'Place and edit fields',
    onclick: () => { if (store.testMode !== test) { store.setTestMode(test); if (test) { inspEl.classList.add('open'); railEl.classList.remove('open'); } } } }, label);
  const modeBtns = [modeBtn(false, 'Design'), modeBtn(true, 'Test')];
  const modeSwitch = h('div.mode-switch', { role: 'radiogroup', 'aria-label': 'Mode' }, ...modeBtns);

  const pagesToggle = h('button.icon-btn.only-narrow', { type: 'button', 'aria-label': 'Show pages and fields', title: 'Pages and fields', onclick: () => { railEl.classList.toggle('open'); inspEl.classList.remove('open'); } });
  pagesToggle.innerHTML = icons.pages;
  const propsToggle = h('button.icon-btn.only-narrow', { type: 'button', 'aria-label': 'Show properties', title: 'Properties', onclick: () => { inspEl.classList.toggle('open'); railEl.classList.remove('open'); } });
  propsToggle.innerHTML = icons.sliders;

  // Back to home: the project is saved automatically, so nothing gets lost
  const goHome = async () => { if (store.testMode) store.setTestMode(false); await flushSave(); store.reset(); };
  const back = h('button.icon-btn', { type: 'button', title: 'Back to home', 'aria-label': 'Back to home', onclick: goHome });
  back.innerHTML = icons.back;

  const fileBtn = h<HTMLButtonElement>('button.btn.ghost.file-btn', { type: 'button' }, 'File');
  const fileMenu = menu(fileBtn, [
    { label: 'Open another PDF\u2026', run: () => replaceIn.click() },
    { label: 'Append PDF\u2026', run: () => mergeIn.click() },
    'sep',
    { label: 'Save project file', run: () => { void saveProjectFile(); } },
    { label: 'Export fillable PDF', hint: '\u2318S', run: () => { void doExport(); } },
    'sep',
    { label: 'Back to home', run: () => { void goHome(); } },
  ]);

  // Title with save status
  const title = h('span.doc-title');
  const saved = h('span.doc-saved', { 'aria-live': 'polite' });
  let savedAt = 0;
  const ago = () => {
    if (!savedAt) { saved.textContent = ''; return; }
    const s = Math.round((Date.now() - savedAt) / 1000);
    saved.textContent = s < 45 ? 'Saved just now' : s < 3600 ? `Saved ${Math.round(s / 60)} min ago` : 'Saved';
  };
  window.addEventListener('pfm-saved', () => { savedAt = Date.now(); ago(); });
  setInterval(ago, 30000);

  const bar = h('header.bar', {},
    h('div.bar-left', {}, back, h('span.logo-mark', { 'aria-hidden': 'true' }), h('div.doc-head', {}, title, saved), h('span.file-wrap', {}, fileBtn, fileMenu), h('span.sep'), undo, redo),
    modeSwitch,
    h('div.bar-right', {}, pagesToggle, detectBtn, previewBtn, propsToggle, exportBtn),
    mergeIn, replaceIn);

  // Page and zoom controls below the canvas
  const zoomOut = h('button.icon-btn', { type: 'button', 'aria-label': 'Zoom out', title: 'Zoom out', onclick: () => viewer.zoomAt(store.zoom / 1.2) });
  zoomOut.innerHTML = icons.minus;
  const zoomIn = h('button.icon-btn', { type: 'button', 'aria-label': 'Zoom in', title: 'Zoom in', onclick: () => viewer.zoomAt(store.zoom * 1.2) });
  zoomIn.innerHTML = icons.plus;
  const zoomLabel = h('button.zoom-label', { type: 'button', title: 'Fit to width', onclick: () => viewer.fitWidth() }, '100 %');
  const fit = h('button.icon-btn', { type: 'button', 'aria-label': 'Fit to width', title: 'Fit to width', onclick: () => viewer.fitWidth() });
  fit.innerHTML = svg('<path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/>');
  const pageLabel = h('span.page-label', { 'aria-live': 'polite' });
  const goPage = (d: number) => {
    const i = store.pages.findIndex((p) => p.id === viewer.currentPageId());
    const next = store.pages[Math.min(store.pages.length - 1, Math.max(0, i + d))];
    if (next) viewer.scrollToPage(next.id);
  };
  const prev = h('button.icon-btn', { type: 'button', 'aria-label': 'Previous page', title: 'Previous page', onclick: () => goPage(-1) });
  prev.innerHTML = svg('<path d="M15 18l-6-6 6-6"/>');
  const next = h('button.icon-btn', { type: 'button', 'aria-label': 'Next page', title: 'Next page', onclick: () => goPage(1) });
  next.innerHTML = svg('<path d="M9 18l6-6-6-6"/>');
  const updatePage = () => {
    const i = store.pages.findIndex((p) => p.id === viewer.currentPageId());
    pageLabel.textContent = store.pages.length ? `${Math.max(1, i + 1)} / ${store.pages.length}` : '';
  };
  viewerEl.addEventListener('scroll', () => requestAnimationFrame(updatePage), { passive: true });
  const viewBar = h('div.viewbar', { role: 'toolbar', 'aria-label': 'Page and zoom' }, prev, pageLabel, next, h('span.sep'), zoomOut, zoomLabel, zoomIn, fit);
  const canvas = h('div.canvas', {}, viewerEl, viewBar);

  const editor = h('div.editor', {}, bar, railEl, tools, canvas, inspEl);
  bindDrop(viewerEl, 'append');

  store.subscribe((k) => {
    if (k.has('tool')) tools.querySelectorAll<HTMLElement>('.tool').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === store.tool)));
    if (k.has('zoom') || k.has('doc')) zoomLabel.textContent = `${Math.round(store.zoom * 100)} %`;
    if (k.has('history') || k.has('doc')) { undo.disabled = !store.canUndo; redo.disabled = !store.canRedo; }
    if (k.has('options') || k.has('doc')) previewBtn.setAttribute('aria-pressed', String(store.options.preview));
    if (k.has('doc')) { title.textContent = store.fileName; title.title = store.fileName; savedAt = 0; ago(); }
    if (k.has('pages') || k.has('doc')) requestAnimationFrame(updatePage);
    if (k.has('mode') || k.has('doc')) {
      editor.classList.toggle('testing', store.testMode);
      for (const b of modeBtns) b.setAttribute('aria-checked', String((b.dataset.test === 'true') === store.testMode));
    }
    if (k.has('selection') && store.selectedId && window.matchMedia('(max-width: 899px)').matches) {
      // on narrow screens don't open properties automatically \u2013 just hint via the button
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
    if (e.key.toLowerCase() === 'p') { togglePreview(); return; }
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
