import '@fontsource-variable/instrument-sans/wght.css';
import './styles.css';
import { store, type Tool } from './state';
import { h, icons, isTyping, toast } from './ui/dom';
import { Viewer } from './ui/viewer';
import { PagesRail } from './ui/pages';
import { Inspector, deleteField, duplicateField } from './ui/inspector';
import { filesFromList, openPdfs, runExport } from './ui/actions';
import { initPdfjs } from './pdf/pdfjs';
import sampleLayers from './assets/beispiel-ebenen.pdf?inline';

const app = document.getElementById('app')!;

/* ------------------------------------------------------------------ */
/* Startseite                                                          */
/* ------------------------------------------------------------------ */

const TAGS: [string, string, string][] = [
  ['text', '[Form_Text_Name]', 'Textfeld'],
  ['area', '[Form_Area_Nachricht]', 'Mehrzeiliges Textfeld'],
  ['check', '[Form_Check_AGB]', 'Checkbox'],
  ['radio', '[Form_Radio_Anrede_Frau]', 'Radio-Button: Gruppe, dann Wert'],
];

function buildStart(): HTMLElement {
  const fileIn = h<HTMLInputElement>('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: true });
  fileIn.addEventListener('change', async () => { if (fileIn.files?.length) await openPdfs(await filesFromList(fileIn.files), 'replace'); fileIn.value = ''; });
  const pick = h('button.btn.primary.lg', { type: 'button', onclick: () => fileIn.click() }, 'PDF auswählen');
  const sample = h('button.btn.ghost.lg', { type: 'button', onclick: () => openPdfs([{ name: 'beispiel-ebenen.pdf', bytes: dataUriToBytes(sampleLayers) }], 'replace') }, 'Beispiel öffnen');

  const sheet = h('section.sheet', { 'aria-labelledby': 'start-title' },
    h('span.crop.tl'), h('span.crop.tr'), h('span.crop.bl'), h('span.crop.br'),
    h('div.sheet-inner', {},
      h('p.mark', {}, h('span.ink.c'), h('span.ink.m'), h('span.ink.y'), h('span.ink.k'), h('span.mark-name', {}, 'PDF Form Maker')),
      h('h1', { id: 'start-title' }, 'Aus deiner PDF wird ein ausfüllbares Formular.'),
      h('p.lead', {}, 'Zieh eine PDF hierher. Benannte Platzhalter werden automatisch zu echten Formularfeldern. Danach kannst du sie anpassen, ergänzen und prüfen oder Felder direkt auf der Seite aufziehen.'),
      h('div.start-actions', {}, pick, sample),
      h('p.privacy', {}, 'Die Datei bleibt auf deinem Gerät. Nichts wird hochgeladen.'),
      fileIn));

  const legend = h('aside.legend', { 'aria-labelledby': 'legend-title' },
    h('h2', { id: 'legend-title' }, 'So benennst du Platzhalter'),
    h('p', {}, 'Zeichne in deinem Layoutprogramm ein Rechteck dort, wo das Feld hin soll, und schreib einen dieser Tags als Text hinein:'),
    h('ul.tag-list', {}, ...TAGS.map(([t, code, desc]) => h('li', { 'data-type': t }, h('span.dot'), h('code', {}, code), h('span', {}, desc)))),
    h('p.small', {}, 'Der Tag wird beim Export automatisch entfernt. Alternativ kannst du das Rechteck auf eine Ebene mit diesem Namen legen, sofern dein Programm Ebenen in die PDF exportiert.'));

  const start = h('main.start', {}, sheet, legend);
  bindDrop(start, 'replace');
  return start;
}

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
  { t: 'select', label: 'Auswählen', key: 'V' },
  { t: 'text', label: 'Textfeld', key: 'T' },
  { t: 'area', label: 'Textbereich', key: 'A' },
  { t: 'check', label: 'Checkbox', key: 'C' },
  { t: 'radio', label: 'Radio-Button', key: 'R' },
  { t: 'reset', label: 'Zurücksetzen-Button', key: 'B' },
];

function buildEditor(): HTMLElement {
  const mergeIn = h<HTMLInputElement>('input', { type: 'file', accept: 'application/pdf,.pdf', multiple: true, hidden: true });
  mergeIn.addEventListener('change', async () => { if (mergeIn.files?.length) await openPdfs(await filesFromList(mergeIn.files), 'append'); mergeIn.value = ''; });
  const openIn = h<HTMLInputElement>('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: true });
  openIn.addEventListener('change', async () => { if (openIn.files?.length) await openPdfs(await filesFromList(openIn.files), 'replace'); openIn.value = ''; });

  const viewerEl = h('section.viewer', { 'aria-label': 'Dokument', 'data-tool': 'select' });
  const viewer = new Viewer(viewerEl);
  const railEl = h('aside.rail', { 'aria-label': 'Seitenverwaltung' });
  new PagesRail(railEl, viewer, () => mergeIn.click());
  const inspEl = h('aside.inspector', { 'aria-label': 'Eigenschaften' });
  new Inspector(inspEl, viewer);

  // Werkzeuge
  const tools = h('div.tools', { role: 'toolbar', 'aria-label': 'Werkzeuge' });
  for (const { t, label, key } of TOOLS) {
    const b = h('button.tool', { type: 'button', 'data-tool': t, 'aria-pressed': String(store.tool === t), title: `${label} (${key})`, 'aria-label': label, onclick: () => store.setTool(t) });
    b.innerHTML = icons[t];
    tools.append(b);
  }

  const undo = h<HTMLButtonElement>('button.icon-btn', { type: 'button', title: 'Rückgängig (⌘/Strg Z)', 'aria-label': 'Rückgängig', onclick: () => store.undo(), disabled: true });
  undo.innerHTML = icons.undo;
  const redo = h<HTMLButtonElement>('button.icon-btn', { type: 'button', title: 'Wiederholen (⇧⌘/Strg Z)', 'aria-label': 'Wiederholen', onclick: () => store.redo(), disabled: true });
  redo.innerHTML = icons.redo;

  const zoomOut = h('button.icon-btn', { type: 'button', 'aria-label': 'Verkleinern', title: 'Verkleinern', onclick: () => viewer.zoomAt(store.zoom / 1.2) });
  zoomOut.innerHTML = icons.minus;
  const zoomIn = h('button.icon-btn', { type: 'button', 'aria-label': 'Vergrößern', title: 'Vergrößern', onclick: () => viewer.zoomAt(store.zoom * 1.2) });
  zoomIn.innerHTML = icons.plus;
  const zoomLabel = h('button.zoom-label', { type: 'button', title: 'An Breite anpassen', onclick: () => viewer.fitWidth() }, '100 %');

  const exportBtn = h<HTMLButtonElement>('button.btn.primary.export', { type: 'button', onclick: () => runExport(exportBtn) });
  exportBtn.innerHTML = `${icons.download}<span>PDF exportieren</span>`;

  const pagesToggle = h('button.icon-btn.only-narrow', { type: 'button', 'aria-label': 'Seiten anzeigen', title: 'Seiten', onclick: () => { railEl.classList.toggle('open'); inspEl.classList.remove('open'); } });
  pagesToggle.innerHTML = icons.pages;
  const propsToggle = h('button.icon-btn.only-narrow', { type: 'button', 'aria-label': 'Eigenschaften anzeigen', title: 'Eigenschaften', onclick: () => { inspEl.classList.toggle('open'); railEl.classList.remove('open'); } });
  propsToggle.innerHTML = icons.sliders;

  const back = h('button.icon-btn', { type: 'button', title: 'Andere PDF öffnen', 'aria-label': 'Andere PDF öffnen', onclick: () => openIn.click() });
  back.innerHTML = icons.back;

  const title = h('span.doc-title');
  const bar = h('header.bar', {},
    h('div.bar-left', {}, back, h('span.mark.small', { 'aria-hidden': 'true' }, h('span.ink.c'), h('span.ink.m'), h('span.ink.y'), h('span.ink.k')), title),
    tools,
    h('div.bar-right', {}, pagesToggle, undo, redo, h('span.sep'), zoomOut, zoomLabel, zoomIn, h('span.sep'), propsToggle, exportBtn),
    mergeIn, openIn);

  const editor = h('div.editor', {}, bar, railEl, viewerEl, inspEl);
  bindDrop(viewerEl, 'append');

  store.subscribe((k) => {
    if (k.has('tool')) tools.querySelectorAll<HTMLElement>('.tool').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === store.tool)));
    if (k.has('zoom') || k.has('doc')) zoomLabel.textContent = `${Math.round(store.zoom * 100)} %`;
    if (k.has('history') || k.has('doc')) { undo.disabled = !store.canUndo; redo.disabled = !store.canRedo; }
    if (k.has('doc')) { title.textContent = store.fileName; title.title = store.fileName; }
    if (k.has('selection') && store.selectedId && window.matchMedia('(max-width: 899px)').matches) {
      // auf schmalen Bildschirmen Eigenschaften nicht automatisch aufklappen – nur Hinweis per Badge
      propsToggle.classList.add('pulse'); setTimeout(() => propsToggle.classList.remove('pulse'), 900);
    }
  });

  // Tastatur
  window.addEventListener('keydown', (e) => {
    if (!store.hasDocument) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { if (isTyping(e)) return; e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { if (isTyping(e)) return; e.preventDefault(); store.redo(); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); if (store.selectedId) duplicateField(store.selectedId); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); runExport(exportBtn); return; }
    if (mod && (e.key === '+' || e.key === '=')) { e.preventDefault(); viewer.zoomAt(store.zoom * 1.2); return; }
    if (mod && e.key === '-') { e.preventDefault(); viewer.zoomAt(store.zoom / 1.2); return; }
    if (mod && e.key === '0') { e.preventDefault(); viewer.fitWidth(); return; }
    if (isTyping(e) || mod || e.altKey) return;
    const sel = store.selectedId;
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); deleteField(sel); return; }
    if (e.key === 'Escape') { if (store.tool !== 'select') store.setTool('select'); else store.select(null); return; }
    if (sel && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key as 'ArrowLeft'];
      if (d) viewer.nudge(sel, d[0], d[1]);
      return;
    }
    const tool = TOOLS.find((t) => t.key.toLowerCase() === e.key.toLowerCase());
    if (tool) store.setTool(tool.t);
  });

  // Erstes Laden: an Breite anpassen
  store.subscribe((k) => { if (k.has('doc') && store.hasDocument) requestAnimationFrame(() => viewer.fitWidth()); });
  window.addEventListener('resize', () => { if (window.matchMedia('(min-width: 900px)').matches) { railEl.classList.remove('open'); inspEl.classList.remove('open'); } });
  viewerEl.addEventListener('pointerdown', () => { railEl.classList.remove('open'); });
  return editor;
}

/* ------------------------------------------------------------------ */

const start = buildStart();
const editor = buildEditor();
app.append(start);

store.subscribe((k) => {
  if (!k.has('doc')) return;
  if (store.hasDocument && start.isConnected) { start.replaceWith(editor); }
  else if (!store.hasDocument && editor.isConnected) editor.replaceWith(start);
});

// Dateien, die neben die Ablagefläche fallen, sollen den Browser nicht verlassen
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

initPdfjs().catch(() => toast('Die PDF-Darstellung konnte nicht geladen werden. Lade die Seite neu.', 'error', 10000));
