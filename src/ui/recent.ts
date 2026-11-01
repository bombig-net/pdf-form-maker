import { store } from '../state';
import { analyzeDocument } from '../pdf/analyze';
import type { CustomFont, Field, FormFont, PageRef } from '../types';
import { defaultFormFont } from '../state';
import { uid } from '../util/geom';
import { toast } from './dom';
import { saveFile } from './actions';

/** A saved project: source PDFs plus the full editing state. Stored only in this browser (IndexedDB). */
export interface Project {
  id: string;
  name: string;
  updatedAt: number;
  thumb: string;
  fieldCount: number;
  pageCount: number;
  docs: { id: string; name: string; bytes: Uint8Array }[];
  pages: PageRef[];
  fields: Field[];
  customFonts: CustomFont[];
  locale?: string;
  formFont?: FormFont;
}
export type ProjectSummary = Omit<Project, 'docs' | 'pages' | 'fields' | 'customFonts' | 'locale' | 'formFont'>;

const DB = 'pdf-form-maker';
const STORE = 'projects';
const MAX = 12;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = fn(db.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function listProjects(): Promise<ProjectSummary[]> {
  try {
    const all = await tx<Project[]>('readonly', (s) => s.getAll());
    return all.map(({ docs: _d, pages: _p, fields: _f, customFonts: _c, locale: _l, formFont: _ff, ...rest }) => rest).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch { return []; }
}
export async function deleteProject(id: string) {
  try { await tx('readwrite', (s) => s.delete(id)); } catch { /* ignore */ }
  if (id === currentId) currentId = null;
}

/* ------------------------------------------------------------------ */
/* Autosave                                                            */
/* ------------------------------------------------------------------ */

let currentId: string | null = null;
let thumb = '';
let timer = 0;
let suspended = false;
/** Document set of the currently open project; a different set on 'doc' means a new project. */
let projectKey = '';
const docKey = () => store.docs.map((d) => d.id).join(',');

async function makeThumb(): Promise<string> {
  const p = store.pages[0];
  const proxy = p && store.proxies.get(p.docId);
  if (!proxy) return '';
  try {
    const page = await proxy.getPage(p.srcIndex + 1);
    const rot = (((page.rotate + p.rotation) % 360) + 360) % 360;
    const vp0 = page.getViewport({ scale: 1, rotation: rot });
    const vp = page.getViewport({ scale: 240 / vp0.width, rotation: rot });
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    await page.render({ canvasContext: c.getContext('2d')!, viewport: vp, annotationMode: 0 }).promise;
    return c.toDataURL('image/jpeg', 0.7);
  } catch { return ''; }
}

async function save() {
  if (!store.hasDocument || suspended) return;
  if (!currentId) currentId = uid('proj');
  if (!thumb) thumb = await makeThumb();
  const project: Project = {
    id: currentId,
    name: store.fileName || 'Untitled',
    updatedAt: Date.now(),
    thumb,
    fieldCount: store.fields.length,
    pageCount: store.pages.length,
    docs: store.docs.map((d) => ({ id: d.id, name: d.name, bytes: d.bytes })),
    pages: structuredClone(store.pages),
    fields: structuredClone(store.fields),
    customFonts: store.customFonts.map((f) => ({ ...f })),
    locale: store.options.locale,
    formFont: store.options.formFont,
  };
  try {
    await tx('readwrite', (s) => s.put(project));
    // Lets the editor show "Saved just now"
    window.dispatchEvent(new CustomEvent('pfm-saved', { detail: project.updatedAt }));
    const all = await listProjects();
    for (const old of all.slice(MAX)) await deleteProject(old.id);
  } catch (e) {
    console.warn('Could not save the project locally', e);
  }
}

/** Saves changes automatically shortly after each edit. */
export function startAutosave() {
  store.subscribe((k) => {
    if (k.has('doc')) {
      thumb = '';
      if (!store.hasDocument) { currentId = null; projectKey = ''; return; }
      if (docKey() !== projectKey) { currentId = null; projectKey = docKey(); }
    }
    if (k.has('pages')) thumb = '';
    if (!store.hasDocument || !(k.has('doc') || k.has('pages') || k.has('fields') || k.has('options'))) return;
    clearTimeout(timer);
    timer = window.setTimeout(save, 600);
  });
  window.addEventListener('pagehide', () => { clearTimeout(timer); save(); });
}

/** Saves immediately (e.g. before leaving the editor). */
export async function flushSave() { clearTimeout(timer); await save(); }

/** Opens a saved project with all fields and settings. */
export async function openProject(id: string): Promise<boolean> {
  let p: Project | undefined;
  try { p = await tx<Project | undefined>('readonly', (s) => s.get(id)); } catch { /* ignore */ }
  if (!p) { toast('This project is no longer available.', 'error'); return false; }
  return restore(p);
}

/** Loads a project into the editor. Projects from a file get a new id so they appear as their own entry. */
async function restore(p: Project): Promise<boolean> {
  suspended = true;
  try {
    const idMap = new Map<string, string>();
    const loaded = [];
    for (const d of p.docs) {
      const res = await analyzeDocument(d.bytes, d.name);
      idMap.set(d.id, res.doc.id);
      loaded.push(res);
    }
    store.reset();
    for (const { doc, proxy } of loaded) { store.docs.push(doc); store.proxies.set(doc.id, proxy); }
    store.pages = p.pages.map((pg) => ({ ...pg, docId: idMap.get(pg.docId) ?? pg.docId }));
    store.fields = p.fields;
    store.customFonts = p.customFonts ?? [];
    store.fileName = p.name;
    if (p.locale) store.options.locale = p.locale;
    // Forms saved before the form font existed keep their look
    store.options.formFont = p.formFont ?? { ...defaultFormFont(), mode: 'layout' };
    currentId = p.id;
    projectKey = docKey();
    thumb = p.thumb;
    store.emit('doc', 'pages', 'fields', 'selection');
    return true;
  } catch (e) {
    toast(`The project could not be opened: ${(e as Error).message}`, 'error', 7000);
    return false;
  } finally {
    setTimeout(() => (suspended = false), 0);
  }
}

/* ------------------------------------------------------------------ */
/* Project file: everything in one file to back up or pass on          */
/* ------------------------------------------------------------------ */

const FORMAT = 'pdf-form-maker';
export const PROJECT_EXT = '.formmaker';

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Downloads the open form (PDFs, fields, fonts, region) as a .formmaker file. */
export async function saveProjectFile() {
  if (!store.hasDocument) return;
  const data = {
    format: FORMAT,
    version: 1,
    name: store.fileName || 'Untitled',
    savedAt: new Date().toISOString(),
    locale: store.options.locale,
    formFont: store.options.formFont,
    docs: store.docs.map((d) => ({ id: d.id, name: d.name, data: toBase64(d.bytes) })),
    pages: store.pages,
    fields: store.fields,
    customFonts: store.customFonts.map((f) => ({ id: f.id, name: f.name, data: toBase64(f.bytes) })),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  const saved = await saveFile(`${data.name}${PROJECT_EXT}`, bytes, 'application/json');
  if (saved === 'saved') toast('Project file saved. Open it again from the home screen.');
}

export const isProjectFile = (name: string) => name.toLowerCase().endsWith(PROJECT_EXT);

/** Opens a .formmaker file. */
export async function openProjectFile(file: File): Promise<boolean> {
  try {
    const d = JSON.parse(await file.text());
    if (d?.format !== FORMAT || !Array.isArray(d.docs) || !d.docs.length) throw new Error('not a project file');
    const p: Project = {
      id: uid('proj'),
      name: String(d.name || file.name.replace(/\.formmaker$/i, '')),
      updatedAt: Date.now(),
      thumb: '',
      fieldCount: d.fields?.length ?? 0,
      pageCount: d.pages?.length ?? 0,
      docs: d.docs.map((x: { id: string; name: string; data: string }) => ({ id: x.id, name: x.name, bytes: fromBase64(x.data) })),
      pages: d.pages ?? [],
      fields: d.fields ?? [],
      customFonts: (d.customFonts ?? []).map((x: { id: string; name: string; data: string }) => ({ id: x.id, name: x.name, bytes: fromBase64(x.data) })),
      locale: d.locale,
      formFont: d.formFont,
    };
    const ok = await restore(p);
    if (ok) setTimeout(() => { void flushSave(); }, 0);
    return ok;
  } catch {
    toast(`\u201c${file.name}\u201d is not a valid project file.`, 'error', 6000);
    return false;
  }
}
