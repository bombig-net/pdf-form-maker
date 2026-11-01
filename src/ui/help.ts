import { store } from '../state';
import { h } from './dom';

/** Hinweis im Dokument, wenn keine Platzhalter erkannt wurden – mit der wahrscheinlichen Ursache. */
export function mountEmptyHelp(viewerEl: HTMLElement) {
  let banner: HTMLElement | null = null;
  let dismissedFor = '';
  const remove = () => { banner?.remove(); banner = null; };
  const render = () => {
    const key = store.docs.map((d) => d.id).join(',');
    if (!store.hasDocument || store.fields.length || store.testMode || dismissedFor === key) { remove(); return; }
    if (banner) return;
    const hasText = store.docs.some((d) => d.pages.some((p) => p.texts.length > 0));
    const draw = h('button.btn.primary', { type: 'button', onclick: () => { store.setTool('text'); dismissedFor = key; remove(); } }, 'Textfeld zeichnen');
    const close = h('button.btn.secondary', { type: 'button', onclick: () => { dismissedFor = key; remove(); } }, 'Schließen');
    banner = h('aside.empty-help', { role: 'note', 'aria-labelledby': 'eh-title' },
      h('h2', { id: 'eh-title' }, 'Keine Platzhalter gefunden'),
      hasText
        ? h('p', {}, 'In dieser PDF steht kein Tag wie [Form_Text_Name]. Das kann diese Ursachen haben:')
        : h('p', {}, 'Diese PDF enthält keinen erkennbaren Text, zum Beispiel weil sie gescannt wurde oder die Schrift in Pfade umgewandelt ist. Tags können darin nicht gefunden werden.'),
      hasText ? h('ul', {},
        h('li', {}, 'Die Tags fehlen noch im Layout. Schreib sie als Text in die Rechtecke, z. B. [Form_Text_Vorname].'),
        h('li', {}, 'Die Tags stehen nur im Ebenennamen, der Export enthält aber keine Ebenen. Dann hilft der Text-Tag.'),
        h('li', {}, 'Die Schrift wurde beim Export in Pfade umgewandelt. Exportiere mit eingebetteter Schrift.')) : null,
      h('p', {}, 'Du kannst Felder auch direkt auf der Seite aufziehen: Werkzeug oben wählen und Rechteck ziehen.'),
      h('div.empty-help-actions', {}, draw, close));
    viewerEl.prepend(banner);
  };
  store.subscribe((k) => { if (k.has('doc') || k.has('fields') || k.has('mode')) render(); });
}
