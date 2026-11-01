import { store } from '../state';
import { h, toast } from './dom';
import { uid } from '../util/geom';

/*
 * Fonts installed on this device (Local Font Access API, Chrome and Edge on the desktop).
 * A chosen font is added like an uploaded one: fully embedded on export, used in the preview.
 */

interface LocalFont { family: string; fullName: string; postscriptName: string; style: string; blob(): Promise<Blob> }
const api = () => (window as unknown as { queryLocalFonts?: () => Promise<LocalFont[]> }).queryLocalFonts;
export const deviceFontsSupported = () => typeof api() === 'function';

/** The standard PDF fonts need no lookup on the device. */
const STANDARD = /^(helvetica|arial|times|timesnewroman|courier|couriernew|symbol|zapfdingbats)/i;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

async function query(): Promise<LocalFont[] | null> {
  try {
    const fonts = await api()!();
    if (!fonts.length) toast('The browser did not share any fonts. Allow access to local fonts in the site settings.', 'warn', 7000);
    return fonts;
  } catch {
    toast('Access to the fonts on this device was not allowed.', 'warn', 6000);
    return null;
  }
}

/** Adds a device font to the form; returns its family value ('custom:<id>'). */
async function add(font: LocalFont): Promise<string> {
  const existing = store.customFonts.find((c) => c.name === font.fullName);
  if (existing) return 'custom:' + existing.id;
  const bytes = new Uint8Array(await (await font.blob()).arrayBuffer());
  const cf = { id: uid('font'), name: font.fullName, bytes };
  store.customFonts.push(cf);
  toast(`\u201c${font.fullName}\u201d will be fully embedded on export. Its license must allow embedding.`, 'info', 6000);
  return 'custom:' + cf.id;
}

/** The main font of the layout (most used non-standard font in the PDF), e.g. { ps: 'Inter-SemiBold', family: 'Inter' }. */
export function layoutFont(): { ps: string; family: string } | null {
  const count = new Map<string, number>();
  for (const d of store.docs) for (const p of d.pages) for (const op of p.textOps) {
    if (op.tr === 3 || !op.baseFont) continue;
    const ps = op.baseFont.replace(/^[A-Z]{6}\+/, '');
    if (STANDARD.test(norm(ps))) continue;
    count.set(ps, (count.get(ps) ?? 0) + 1);
  }
  const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!best) return null;
  const family = best.split(/[-,]/)[0].replace(/(MT|PS|Std|Pro)$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return { ps: best, family };
}

/** Is the layout font already part of the form? */
export function layoutFontAdded(lf: { ps: string; family: string }): boolean {
  return store.customFonts.some((c) => norm(c.name).startsWith(norm(lf.family)));
}

/** Looks for the layout font among the installed fonts and adds it. */
export async function useLayoutFont(lf: { ps: string; family: string }): Promise<string | null> {
  const fonts = await query();
  if (!fonts) return null;
  const regular = (list: LocalFont[]) => list.find((f) => /^(regular|book|roman|normal)$/i.test(f.style)) ?? list[0];
  // Inputs use the regular style of the family (labels are often bold); the exact face if the family is unknown
  const match = regular(fonts.filter((f) => norm(f.family) === norm(lf.family)))
    ?? fonts.find((f) => f.postscriptName === lf.ps);
  if (!match) {
    toast(`\u201c${lf.family}\u201d is not installed on this device. You can upload the font file instead.`, 'warn', 7000);
    return null;
  }
  return add(match);
}

/** Dialog with every installed font, shown in its own face, with a search. */
export async function pickDeviceFont(): Promise<string | null> {
  const fonts = await query();
  if (!fonts?.length) return null;
  return new Promise((resolve) => {
    let result: string | null = null;
    const search = h<HTMLInputElement>('input.font-search', { type: 'search', placeholder: 'Search fonts', 'aria-label': 'Search fonts' });
    const list = h('div.font-list', { role: 'listbox', 'aria-label': 'Installed fonts' });
    const dlg = h<HTMLDialogElement>('dialog.modal.font-dialog', { 'aria-labelledby': 'font-title' },
      h('h2', { id: 'font-title' }, 'Fonts on this device'),
      h('p', {}, 'The font is fully embedded in the PDF, so people type in exactly this typeface. Its license must allow embedding.'),
      search, list,
      h('div.modal-actions', {}, h('button.btn.secondary', { type: 'button', onclick: () => dlg.close() }, 'Cancel')));
    const render = () => {
      const q = norm(search.value);
      const hits = fonts.filter((f) => !q || norm(f.fullName).includes(q)).slice(0, 300);
      list.replaceChildren(...hits.map((f) => h('button.font-item', {
        type: 'button', role: 'option', title: f.fullName,
        onclick: async () => { result = await add(f); dlg.close(); },
      }, h('span.font-sample', { style: `font-family:"${f.family}";font-style:${/italic|oblique/i.test(f.style) ? 'italic' : 'normal'}` }, f.fullName),
        h('span.font-style', {}, f.style))));
      if (!hits.length) list.append(h('p.hint', {}, 'No installed font matches.'));
    };
    search.addEventListener('input', render);
    render();
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    document.body.append(dlg);
    dlg.showModal();
    search.focus();
  });
}
