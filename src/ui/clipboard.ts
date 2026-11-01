import { store } from '../state';
import type { Field } from '../types';
import { uid } from '../util/geom';
import { toast } from './dom';
import { uniqueName, type Viewer } from './viewer';

let clip: Field[] = [];
let pasteCount = 0;

export function copySelection(): boolean {
  const sel = store.selectedFields;
  if (!sel.length) return false;
  clip = structuredClone(sel);
  pasteCount = 0;
  toast(`${sel.length} ${sel.length === 1 ? 'Feld' : 'Felder'} kopiert.`, 'info', 1800);
  return true;
}

export function cutSelection(): boolean {
  if (!copySelection()) return false;
  const ids = new Set(clip.map((f) => f.id));
  store.commit(() => { store.fields = store.fields.filter((f) => !ids.has(f.id)); }, ['fields']);
  store.setSelection([]);
  return true;
}

/** Fügt auf der aktuell sichtbaren Seite ein. Auf derselben Seite leicht versetzt, auf anderen Seiten an gleicher Position. */
export function paste(viewer: Viewer): boolean {
  if (!clip.length) return false;
  const target = viewer.currentPageId();
  if (!target) return false;
  const samePage = clip.every((f) => f.pageId === target);
  pasteCount++;
  const off = samePage ? 10 * pasteCount : 0;
  const created: Field[] = [];
  store.commit(() => {
    for (const src of clip) {
      const f: Field = structuredClone(src);
      f.id = uid('f');
      f.pageId = target;
      f.rect = { ...src.rect, x: src.rect.x + off, y: src.rect.y - off };
      f.extraHide = [];
      f.hideText = false;
      f.source = 'manual';
      if (f.type === 'radio') {
        let v = src.radioValue, k = 2;
        while ([...store.fields, ...created].some((x) => x.type === 'radio' && x.name === f.name && x.radioValue === v)) v = `${src.radioValue}_${k++}`;
        f.radioValue = v;
      } else if (f.type !== 'reset') {
        const base = src.name.replace(/_\d+$/, '');
        let n = uniqueName(base);
        while (created.some((x) => x.name === n)) n = `${n}_2`;
        f.name = n;
      }
      created.push(f);
      store.fields.push(f);
    }
  });
  store.setSelection(created.map((f) => f.id));
  return true;
}
