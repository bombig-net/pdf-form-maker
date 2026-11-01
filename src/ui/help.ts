import { store } from '../state';
import { h } from './dom';
import { suggestAllFields } from './extras';

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
    const suggest = h('button.btn.primary', { type: 'button', onclick: () => { dismissedFor = key; remove(); suggestAllFields(); } }, 'Suggest fields');
    const draw = h('button.btn.secondary', { type: 'button', onclick: () => { store.setTool('text'); dismissedFor = key; remove(); } }, 'Draw a text field');
    const close = h('button.btn.secondary', { type: 'button', onclick: () => { dismissedFor = key; remove(); } }, 'Close');
    banner = h('aside.empty-help', { role: 'note', 'aria-labelledby': 'eh-title' },
      h('h2', { id: 'eh-title' }, 'No placeholders found'),
      hasText ? h('p', {}, 'PDF Form Maker can look for empty boxes, lines and checkboxes and suggest fields for them. You can check and adjust every suggestion.') : null,
      hasText
        ? h('p', {}, 'If you meant to use tags like [Form_Text_Name], these are possible reasons why none were found:')
        : h('p', {}, 'This PDF contains no recognizable text, for example because it was scanned or the text was converted to outlines. Tags cannot be found in it.'),
      hasText ? h('ul', {},
        h('li', {}, 'The tags are still missing from the layout. Write them as text inside the rectangles, e.g. [Form_Text_FirstName].'),
        h('li', {}, 'The tags are only in layer names, but the export contains no layers. Use text tags instead.'),
        h('li', {}, 'The text was converted to outlines on export. Export with embedded fonts.')) : null,
      h('p', {}, 'You can also draw fields directly on the page: pick a tool above and drag a rectangle.'),
      h('div.empty-help-actions', {}, hasText ? suggest : null, draw, close));
    viewerEl.prepend(banner);
  };
  store.subscribe((k) => { if (k.has('doc') || k.has('fields') || k.has('mode')) render(); });
}
