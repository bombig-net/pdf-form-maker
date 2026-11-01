import { store } from '../state';
import { h } from './dom';

/** Notice in the document when no placeholders were found – with the likely cause. */
export function mountEmptyHelp(viewerEl: HTMLElement) {
  let banner: HTMLElement | null = null;
  let dismissedFor = '';
  const remove = () => { banner?.remove(); banner = null; };
  const render = () => {
    const key = store.docs.map((d) => d.id).join(',');
    if (!store.hasDocument || store.fields.length || store.testMode || dismissedFor === key) { remove(); return; }
    if (banner) return;
    const hasText = store.docs.some((d) => d.pages.some((p) => p.texts.length > 0));
    const draw = h('button.btn.primary', { type: 'button', onclick: () => { store.setTool('text'); dismissedFor = key; remove(); } }, 'Draw a text field');
    const close = h('button.btn.secondary', { type: 'button', onclick: () => { dismissedFor = key; remove(); } }, 'Close');
    banner = h('aside.empty-help', { role: 'note', 'aria-labelledby': 'eh-title' },
      h('h2', { id: 'eh-title' }, 'No placeholders found'),
      hasText
        ? h('p', {}, 'This PDF contains no tag like [Form_Text_Name]. Possible reasons:')
        : h('p', {}, 'This PDF contains no recognizable text, for example because it was scanned or the text was converted to outlines. Tags cannot be found in it.'),
      hasText ? h('ul', {},
        h('li', {}, 'The tags are still missing from the layout. Write them as text inside the rectangles, e.g. [Form_Text_FirstName].'),
        h('li', {}, 'The tags are only in layer names, but the export contains no layers. Use text tags instead.'),
        h('li', {}, 'The text was converted to outlines on export. Export with embedded fonts.')) : null,
      h('p', {}, 'You can also draw fields directly on the page: pick a tool above and drag a rectangle.'),
      h('div.empty-help-actions', {}, draw, close));
    viewerEl.prepend(banner);
  };
  store.subscribe((k) => { if (k.has('doc') || k.has('fields') || k.has('mode')) render(); });
}
