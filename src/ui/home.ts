import { store } from '../state';
import { h, svg } from './dom';
import { filesFromList, openPdfs } from './actions';
import { listProjects, deleteProject, openProject, openProjectFile, isProjectFile, PROJECT_EXT, type ProjectSummary } from './recent';
import { madeBy } from './brand';

const I = {
  home: svg('<path d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-6h4v6"/>'),
  file: svg('<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/>'),
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  book: svg('<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/>'),
  upload: svg('<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>', 22),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', 15),
  lock: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', 14),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 15),
};

/** Naming guide: each tag as it looks in a layout app, and what it becomes in the exported PDF. */
interface GuideRow { type: string; code: string; desc: string }
const GUIDE: GuideRow[] = [
  { type: 'text', code: '[Form_Text_FirstName]', desc: 'Text field' },
  { type: 'area', code: '[Form_Area_Message]', desc: 'Multi-line text field' },
  { type: 'check', code: '[Form_Check_Terms]', desc: 'Checkbox. The tag can sit next to the box.' },
  { type: 'radio', code: '[Form_Radio_Salutation_Ms]', desc: 'Radio button: group name, then the value' },
  { type: 'dropdown', code: '[Form_Dropdown_Country]', desc: 'Dropdown. You add the options in the editor.' },
  { type: 'signature', code: '[Form_Signature_Applicant]', desc: 'Signature field, signed in Acrobat Reader' },
  { type: 'reset', code: '[Form_Button_Send]', desc: 'Button: Send, Print, Save or Reset. Your box color becomes the button color.' },
];

const handles = () => ['tl', 'tr', 'bl', 'br'].map((p) => h(`span.mini-handle.${p}`));
const tag = (t: string) => h('span.mini-tag', {}, t);
const tick = svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 12);

/** Mini artboard: the placeholder as drawn in a layout app (selected, with handles). */
function layoutMini(r: GuideRow): HTMLElement {
  const box = (cls: string, ...kids: (Node | string)[]) => h(`div.mini-box${cls}`, {}, ...kids);
  switch (r.type) {
    case 'text': return h('div.mini', {}, h('span.mini-label', {}, 'First name'), box('.sel', tag(r.code), ...handles()));
    case 'area': return h('div.mini', {}, h('span.mini-label', {}, 'Message'), box('.sel.tall', tag(r.code), ...handles()));
    case 'dropdown': return h('div.mini', {}, h('span.mini-label', {}, 'Country'), box('.sel', tag(r.code), ...handles()));
    case 'check': return h('div.mini', {}, h('div.mini-line', {}, h('span.mini-square'), h('span', {}, 'I accept the terms'), tag(r.code)));
    case 'signature': return h('div.mini', {}, h('span.mini-label', {}, 'Signature'), box('.sel.sig', tag(r.code), ...handles()));
    case 'reset': return h('div.mini', {}, box('.sel.btn-box', tag(r.code), ...handles()));
    default: return h('div.mini', {},
      h('div.mini-line', {}, h('span.mini-circle'), h('span.mini-opt', {}, 'Ms'), tag('[Form_Radio_Salutation_Ms]')),
      h('div.mini-line', {}, h('span.mini-circle'), h('span.mini-opt', {}, 'Mr'), tag('[Form_Radio_Salutation_Mr]')));
  }
}

/** Mini artboard: the same spot in the exported PDF, as a filled-in form field. */
function pdfMini(r: GuideRow): HTMLElement {
  const field = (cls: string, ...kids: (Node | string)[]) => h(`div.mini-box.mini-field${cls}`, {}, ...kids);
  const caret = () => h('span.mini-caret');
  switch (r.type) {
    case 'text': return h('div.mini', {}, h('span.mini-label', {}, 'First name'), field('', h('span', {}, 'Anna Berg'), caret()));
    case 'area': return h('div.mini', {}, h('span.mini-label', {}, 'Message'), field('.tall', h('span', {}, 'Looking forward to Friday.'), caret()));
    case 'dropdown': {
      const chev = h('span.mini-chev'); chev.innerHTML = svg('<path d="M7 10l5 5 5-5"/>', 12);
      return h('div.mini', {}, h('span.mini-label', {}, 'Country'), field('.select', h('span', {}, 'Germany'), chev));
    }
    case 'signature': return h('div.mini', {}, h('span.mini-label', {}, 'Signature'), field('.sig', h('span.mini-script', {}, 'Anna Berg')));
    case 'reset': return h('div.mini', {}, h('div.mini-box.btn-box.mini-button', {}, h('span', {}, 'Send form')));
    case 'check': {
      const sq = h('span.mini-square.mini-field.on'); sq.innerHTML = tick;
      return h('div.mini', {}, h('div.mini-line', {}, sq, h('span', {}, 'I accept the terms')));
    }
    default: return h('div.mini', {},
      h('div.mini-line', {}, h('span.mini-circle.mini-field.on'), h('span.mini-opt', {}, 'Ms')),
      h('div.mini-line', {}, h('span.mini-circle.mini-field'), h('span.mini-opt', {}, 'Mr')));
  }
}

/** Short caption shown on phones, where the column headings are hidden. */
const tagMini = (el: HTMLElement, cap: string) => { el.dataset.cap = cap; return el; };

function guideRow(r: GuideRow): HTMLElement {
  const arrow = h('span.guide-arrow', { 'aria-hidden': 'true' });
  arrow.innerHTML = svg('<path d="M5 12h13M13 7l5 5-5 5"/>', 18);
  return h('div.guide-row', { 'data-type': r.type },
    h('div.guide-tag', {}, h('span.dot'), h('div', {}, h('code', {}, r.code), h('span.guide-desc', {}, r.desc))),
    h('figure.guide-pair', { 'aria-label': `${r.desc}: placeholder in the layout and the resulting form field` },
      tagMini(layoutMini(r), 'Layout'), arrow, tagMini(pdfMini(r), 'PDF')));
}

type Theme = 'system' | 'light' | 'dark';
export function applyTheme(t?: Theme) {
  let theme: Theme = t ?? 'system';
  if (!t) { try { theme = (localStorage.getItem('pfm-theme') as Theme) || 'system'; } catch { /* ignore */ } }
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('pfm-theme', theme); } catch { /* ignore */ }
  return theme;
}

function ago(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
  const hh = Math.round(m / 60); if (hh < 24) return `${hh} h ago`;
  const d = Math.round(hh / 24); if (d < 7) return `${d} ${d === 1 ? 'day' : 'days'} ago`;
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Opens dropped or chosen files: a project file, or one or more PDFs. */
async function openFiles(list: FileList | File[]) {
  const files = Array.from(list);
  const project = files.find((f) => isProjectFile(f.name));
  if (project) { await openProjectFile(project); return; }
  await openPdfs(await filesFromList(files), 'replace');
}

export function buildHome(openSample: () => void): HTMLElement {
  const fileIn = h<HTMLInputElement>('input', { type: 'file', accept: `application/pdf,.pdf,${PROJECT_EXT}`, hidden: true });
  fileIn.addEventListener('change', async () => { if (fileIn.files?.length) await openFiles(fileIn.files); fileIn.value = ''; });
  const pick = () => fileIn.click();
  const projectIn = h<HTMLInputElement>('input', { type: 'file', accept: PROJECT_EXT, hidden: true });
  projectIn.addEventListener('change', async () => { const f = projectIn.files?.[0]; if (f) await openProjectFile(f); projectIn.value = ''; });

  // Sidebar
  const nav = (icon: string, label: string, on: () => void, active = false) => {
    const b = h('button.side-link', { type: 'button', 'aria-current': active ? 'page' : undefined, onclick: on });
    b.innerHTML = `${icon}<span>${label}</span>`;
    return b;
  };
  // Theme switch: in the sidebar on wide screens, at the end of the page on phones
  const themeSelects: HTMLSelectElement[] = [];
  const themeSelect = () => {
    const sel = h<HTMLSelectElement>('select', { 'aria-label': 'Theme', onchange: (e: Event) => {
      const t = applyTheme((e.target as HTMLSelectElement).value as Theme);
      for (const s of themeSelects) s.value = t;
    } }, ...(['system', 'light', 'dark'] as Theme[]).map((t) => h('option', { value: t }, t === 'system' ? 'System theme' : t === 'light' ? 'Light' : 'Dark')));
    sel.value = applyTheme();
    themeSelects.push(sel);
    return sel;
  };
  const logo = h('div.side-logo', {}, h('span.logo-mark', { 'aria-hidden': 'true' }), h('span', {}, 'PDF Form Maker'));
  const side = h('aside.home-side', { 'aria-label': 'Navigation' },
    logo,
    h('nav.side-nav', {},
      nav(I.home, 'Home', () => main.scrollTo({ top: 0, behavior: 'smooth' }), true),
      nav(I.file, 'Open sample', openSample),
      nav(I.folder, 'Open project file', () => projectIn.click()),
      nav(I.book, 'Naming guide', () => main.querySelector('#guide')?.scrollIntoView({ behavior: 'smooth' }))),
    h('div.side-foot', {}, themeSelect(), (() => { const p = h('p.side-note'); p.innerHTML = `${I.lock}<span>Files stay on your device.</span>`; return p; })(), madeBy('side')));

  // Main
  const points = h('ul.hero-points', {}, ...['Nothing is uploaded', 'Works with any layout app', 'Ready for Acrobat Reader'].map((t) => {
    const li = h('li'); li.innerHTML = `${I.check}<span>${t}</span>`; return li;
  }));
  const drop = h('button.home-drop', { type: 'button', onclick: pick, 'aria-label': 'Choose a PDF' });
  drop.innerHTML = `<span class="drop-icon">${I.upload}</span><strong>Drop a PDF to make it fillable</strong><span>or click to choose a file</span>`;
  const recentGrid = h('div.recent-grid');
  const recentCount = h('span.section-meta');
  const guide = h('section.home-guide', { id: 'guide', 'aria-labelledby': 'guide-title' },
    h('h2.section-head', { id: 'guide-title' }, 'How to name placeholders'),
    h('p.guide-lead', {}, 'In your layout app, draw a rectangle where the field should go and type one of these tags inside it as text. On export the tag disappears and the rectangle becomes a real form field.'),
    h('div.guide-cols', { 'aria-hidden': 'true' }, h('span'), h('div.guide-pair', {}, h('span', {}, 'In your layout app'), h('span'), h('span', {}, 'In the exported PDF'))),
    h('div.guide-list', {}, ...GUIDE.map(guideRow)),
    h('p.guide-note', {}, 'Alternatively, put the rectangle on a layer with that name, as long as your app exports layers to the PDF. You can also draw fields directly on the page in the editor.'));
  const main = h('section.home-main', {},
    h('header.home-hero', {},
      h('h1', {}, 'Make any PDF fillable'),
      h('p.hero-lead', {}, 'Drop in a PDF from Affinity, InDesign, Canva or Word. Placeholders like [Form_Text_Name] turn into real form fields automatically. Then adjust them, test the form and export it.'),
      points),
    drop,
    h('section.home-recent', { 'aria-labelledby': 'recent-title' },
      h('div.section-row', {}, h('h2.section-head', { id: 'recent-title' }, 'Recent'), recentCount),
      recentGrid),
    guide,
    h('div.home-foot', {}, themeSelect(), madeBy('foot')),
    fileIn,
    projectIn);

  const card = (p: ProjectSummary) => {
    const del = h('button.icon-btn.recent-del', { type: 'button', title: 'Remove from recent', 'aria-label': `Remove ${p.name} from recent`, onclick: async (e: Event) => { e.stopPropagation(); await deleteProject(p.id); renderRecent(); } });
    del.innerHTML = I.trash;
    const thumb = h('div.recent-thumb', {}, p.thumb ? h('img', { src: p.thumb, alt: '' }) : null);
    return h('div.recent-card', {},
      h('button.recent-open', { type: 'button', 'aria-label': `Open ${p.name}`, onclick: () => openProject(p.id) },
        thumb,
        h('span.recent-name', {}, p.name),
        h('span.recent-meta', {}, `${p.fieldCount} ${p.fieldCount === 1 ? 'field' : 'fields'} \u00b7 ${p.pageCount} ${p.pageCount === 1 ? 'page' : 'pages'} \u00b7 ${ago(p.updatedAt)}`)),
      del);
  };
  const renderRecent = async () => {
    const list = await listProjects();
    recentCount.textContent = list.length ? String(list.length) : '';
    recentGrid.replaceChildren(...(list.length
      ? list.map(card)
      : [h('p.recent-empty', {}, 'Forms you open appear here, with all their fields. They are saved only in this browser.')]));
  };
  renderRecent();
  store.subscribe((k) => { if (k.has('doc') && !store.hasDocument) renderRecent(); });

  const home = h('main.home', {}, side, main);
  let depth = 0;
  home.addEventListener('dragenter', (e) => { if (!e.dataTransfer?.types.includes('Files')) return; e.preventDefault(); depth++; home.classList.add('dropping'); });
  home.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  home.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) home.classList.remove('dropping'); });
  home.addEventListener('drop', async (e) => {
    e.preventDefault(); depth = 0; home.classList.remove('dropping');
    const files = e.dataTransfer?.files;
    if (files?.length) await openFiles(files);
  });
  return home;
}
