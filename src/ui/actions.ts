import { store } from '../state';
import { analyzeDocument, PdfLoadError } from '../pdf/analyze';
import { detectPageFields, crossPageDuplicates } from '../pdf/detect';
import { exportPdf } from '../pdf/export';
import { uid } from '../util/geom';
import { h, toast } from './dom';
import type { Field, PageRef } from '../types';

export interface InputFile { name: string; bytes: Uint8Array }

export async function filesFromList(list: FileList | File[]): Promise<InputFile[]> {
  const out: InputFile[] = [];
  for (const f of Array.from(list)) {
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') {
      toast(`„${f.name}“ ist keine PDF-Datei. Exportiere dein Dokument zuerst als PDF.`, 'error', 6000);
      continue;
    }
    out.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
  }
  return out;
}

/** Öffnet PDFs. mode 'replace' startet neu, 'append' hängt Seiten an (Merge). */
export async function openPdfs(files: InputFile[], mode: 'replace' | 'append'): Promise<boolean> {
  if (!files.length) return false;
  const busy = showBusy(mode === 'replace' ? 'PDF wird analysiert …' : 'PDF wird angehängt …');
  const newFields: Field[] = [];
  const newPages: PageRef[] = [];
  const loaded: { doc: Awaited<ReturnType<typeof analyzeDocument>> }[] = [];
  try {
    for (const f of files) loaded.push({ doc: await analyzeDocument(f.bytes, f.name) });
  } catch (e) {
    busy();
    toast(e instanceof PdfLoadError ? e.message : `Die PDF konnte nicht geöffnet werden: ${(e as Error).message}`, 'error', 7000);
    return false;
  }
  busy();
  const apply = () => {
    for (const { doc: { doc, proxy } } of loaded) {
      store.docs.push(doc);
      store.proxies.set(doc.id, proxy);
      doc.pages.forEach((a, i) => {
        const p: PageRef = { id: uid('pg'), docId: doc.id, srcIndex: i, rotation: 0 };
        newPages.push(p);
        newFields.push(...detectPageFields(a, p.id));
      });
    }
    store.pages.push(...newPages);
    store.fields.push(...newFields);
  };
  if (mode === 'replace') {
    store.reset();
    store.fileName = files[0].name.replace(/\.pdf$/i, '');
    apply();
    store.emit('doc', 'pages', 'fields', 'selection');
  } else {
    store.commit(apply, ['pages', 'fields']);
  }

  const n = newFields.length;
  if (n) toast(`${n} ${n === 1 ? 'Feld' : 'Felder'} erkannt auf ${newPages.length} ${newPages.length === 1 ? 'Seite' : 'Seiten'}.`);
  else if (mode === 'replace') toast('Keine Platzhalter gefunden. Zieh Felder mit den Werkzeugen oben auf.', 'info', 6000);

  const newIds = new Set(newFields.map((f) => f.id));
  const dupes = crossPageDuplicates(store.fields).filter((name) => store.fields.some((f) => f.name === name && newIds.has(f.id)));
  if (dupes.length) await askDuplicates(dupes);
  return true;
}

/** Dialog: gleichnamige Felder auf mehreren Seiten synchronisieren oder trennen. */
export function askDuplicates(names: string[]): Promise<void> {
  return new Promise((resolve) => {
    const choice = new Map(names.map((n) => [n, 'sync' as 'sync' | 'split']));
    const rows = names.map((n) => {
      const pages = [...new Set(store.fields.filter((f) => f.name === n).map((f) => store.pageNumber(f.pageId)))].sort((a, b) => a - b);
      const group = `dup_${uid('g')}`;
      return h('fieldset.dup-row', {},
        h('legend', {}, h('code', {}, n), h('span.dup-pages', {}, ` auf Seite ${pages.join(', ')}`)),
        h('label.dup-opt', {}, h('input', { type: 'radio', name: group, checked: true, onchange: () => choice.set(n, 'sync') }),
          h('span', {}, h('strong', {}, 'Synchronisieren'), h('small', {}, 'Ein Eintrag erscheint auf allen Seiten.'))),
        h('label.dup-opt', {}, h('input', { type: 'radio', name: group, onchange: () => choice.set(n, 'split') }),
          h('span', {}, h('strong', {}, 'Trennen'), h('small', {}, `Eigene Felder, z. B. ${n}_S${pages[0]}.`))));
    });
    const dlg = h<HTMLDialogElement>('dialog.modal', { 'aria-labelledby': 'dup-title' },
      h('h2', { id: 'dup-title' }, 'Gleiche Feldnamen auf mehreren Seiten'),
      h('p', {}, 'Sollen diese Felder dieselben Daten zeigen oder getrennt ausgefüllt werden?'),
      h('div.dup-list', {}, ...rows),
      h('div.modal-actions', {}, h('button.btn.primary', { type: 'button', onclick: () => dlg.close() }, 'Übernehmen')));
    dlg.addEventListener('close', () => {
      const split = names.filter((n) => choice.get(n) === 'split');
      if (split.length) {
        store.commit(() => {
          for (const f of store.fields) {
            if (!split.includes(f.name) || f.type === 'radio' || f.type === 'reset') continue;
            let nn = `${f.name}_S${store.pageNumber(f.pageId)}`;
            let k = 2;
            while (store.fields.some((x) => x !== f && x.name === nn)) nn = `${f.name}_S${store.pageNumber(f.pageId)}_${k++}`;
            f.name = nn;
          }
        });
      }
      dlg.remove();
      resolve();
    });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export async function runExport(btn?: HTMLButtonElement) {
  if (!store.pages.length) return;
  btn?.setAttribute('aria-busy', 'true');
  if (btn) btn.disabled = true;
  try {
    const t0 = performance.now();
    const res = await exportPdf({
      docs: store.docs, pages: store.pages, fields: store.fields, customFonts: store.customFonts,
      options: { hidePlaceholderLayers: store.options.hidePlaceholderLayers },
    });
    const ms = Math.round(performance.now() - t0);
    const name = `${store.fileName || 'formular'}-formular.pdf`;
    const saved = await saveFile(name, res.bytes);
    if (saved === 'declined') return;
    toast(`${res.fieldCount} ${res.fieldCount === 1 ? 'Feld' : 'Felder'} exportiert (${ms} ms).`);
    for (const w of res.warnings) toast(w, 'warn', 8000);
  } catch (e) {
    console.error(e);
    toast(`Export fehlgeschlagen: ${(e as Error).message}`, 'error', 8000);
  } finally {
    btn?.removeAttribute('aria-busy');
    if (btn) btn.disabled = false;
  }
}

/** Speichert über die Download-Funktion der Claude-Vorschau, sonst klassisch per Link. */
async function saveFile(name: string, bytes: Uint8Array): Promise<'saved' | 'declined'> {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const c = (window as unknown as { claude?: { use?: (n: string) => Promise<{ save(r: { filename: string; data: Blob }): Promise<unknown> } | null> } }).claude;
  if (c?.use) {
    try {
      const dl = await c.use('downloads');
      if (dl) { await dl.save({ filename: name, data: blob }); return 'saved'; }
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'declined') return 'declined';
      if (code === 'rate_limited') { toast('Bitte kurz warten und erneut exportieren.', 'warn'); return 'declined'; }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = h<HTMLAnchorElement>('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'saved';
}

function showBusy(text: string): () => void {
  const el = h('div.busy', { role: 'status' }, h('span.spinner'), h('span', {}, text));
  document.body.append(el);
  return () => el.remove();
}
