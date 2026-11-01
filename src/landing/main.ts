import '@fontsource-variable/inter/wght.css';
import './landing.css';

// The installed app used to start here: send it straight to the app
const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
if (standalone) location.replace('app/');

// Same light/dark choice as in the app
try {
  const t = localStorage.getItem('pfm-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch { /* ignore */ }

/* ---------- Demo: layout with tags <-> fillable form ---------- */
const sheet = document.querySelector<HTMLElement>('.sheet');
const switches = [...document.querySelectorAll<HTMLButtonElement>('.demo-switch button')];
const note = document.querySelector<HTMLElement>('.demo-note');
const NOTES = {
  layout: 'These are the tags in your layout. Switch to <em>Fillable PDF</em> to see the form they become.',
  form: 'This is the fillable PDF. Type a different quantity: the total updates like it does in Acrobat Reader.',
};
let touched = false;

function show(state: 'layout' | 'form') {
  if (!sheet) return;
  sheet.dataset.state = state;
  for (const b of switches) b.setAttribute('aria-checked', String(b.dataset.show === state));
  if (note) note.innerHTML = NOTES[state];
  // Fields can only be reached with Tab while they are visible
  sheet.querySelectorAll<HTMLElement>('input, select').forEach((el) => { el.tabIndex = state === 'form' ? 0 : -1; });
}
for (const b of switches) b.addEventListener('click', () => { touched = true; show(b.dataset.show as 'layout' | 'form'); });

// Live calculation, like the exported PDF does it in Acrobat (European number format, as in the app)
const num = (v: string) => { const n = parseFloat(v.replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); return isNaN(n) ? 0 : n; };
const qty = document.querySelector<HTMLInputElement>('[data-calc="qty"]');
const price = document.querySelector<HTMLInputElement>('[data-calc="price"]');
const total = document.querySelector<HTMLOutputElement>('[data-calc="total"]');
const recalc = () => {
  if (!qty || !price || !total) return;
  total.textContent = (num(qty.value) * num(price.value)).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
qty?.addEventListener('input', recalc);
price?.addEventListener('input', recalc);

// One orchestrated moment: when the sheet comes into view, the tags turn into fields once
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (sheet && !reduced && 'IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    io.disconnect();
    setTimeout(() => { if (!touched) show('form'); }, 1400);
  }, { threshold: 0.6 });
  io.observe(sheet);
}
