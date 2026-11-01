import { store, type ChangeKind } from '../state';
import type { Field } from '../types';
import { h, icons } from './dom';
import type { Viewer } from './viewer';
import { sortForTabOrder } from '../util/tabOrder';

const KIND: Record<Field['type'], string> = {
  text: 'Text field', area: 'Text area', check: 'Checkbox', radio: 'Radio button',
  dropdown: 'Dropdown', reset: 'Button', signature: 'Signature',
};

/**
 * "Fields" tab of the left sidebar: every field grouped by page, in tab order,
 * with its type, logic badges and a search for long forms. A click selects the field.
 */
export class FieldList {
  private list: HTMLElement;
  private search: HTMLInputElement;
  private empty: HTMLElement;
  private query = '';

  constructor(host: HTMLElement, private viewer: Viewer) {
    this.search = h<HTMLInputElement>('input.field-search', { type: 'search', placeholder: 'Find a field', 'aria-label': 'Find a field' });
    this.search.addEventListener('input', () => { this.query = this.search.value.trim().toLowerCase(); this.render(); });
    this.list = h('div.fl-list');
    this.empty = h('p.fl-empty');
    host.append(this.search, this.list, this.empty);
    store.subscribe((k: Set<ChangeKind>) => { if (k.has('fields') || k.has('pages') || k.has('selection') || k.has('doc')) this.render(); });
  }

  private render() {
    const total = store.fields.length;
    this.search.hidden = total < 8;
    const q = this.query;
    const match = (f: Field) => !q || `${f.name} ${f.tooltip} ${f.label} ${f.radioValue}`.toLowerCase().includes(q);
    const groups: HTMLElement[] = [];
    store.pages.forEach((p, i) => {
      const a = store.analysis(p);
      const rot = (((a.baseRotate + p.rotation) % 360) + 360) % 360;
      const fields = sortForTabOrder(store.fields.filter((f) => f.pageId === p.id), (f) => f.rect, rot).filter(match);
      if (!fields.length) return;
      groups.push(h('div.fl-group', {},
        h('div.fl-page', {}, `Page ${i + 1}`, h('span', {}, String(fields.length))),
        ...fields.map((f) => this.row(f))));
    });
    this.list.replaceChildren(...groups);
    this.empty.textContent = total === 0
      ? 'No fields yet. Draw one with the tools, or use Auto-detect.'
      : groups.length ? '' : 'No field matches your search.';
    this.empty.hidden = !this.empty.textContent;
  }

  private row(f: Field): HTMLElement {
    const icon = h('span.fl-icon', { 'aria-hidden': 'true' });
    icon.innerHTML = icons[f.type];
    const name = f.type === 'radio' ? `${f.name} · ${f.radioValue}` : f.type === 'reset' ? f.label || f.name : f.name;
    const row = h('button.fl-row', {
      type: 'button', 'data-type': f.type, 'aria-pressed': String(store.selection.has(f.id)),
      title: `${KIND[f.type]}${f.tooltip ? `: ${f.tooltip}` : ''}`,
      onclick: (ev: Event) => {
        const e = ev as MouseEvent;
        if (e.shiftKey || e.metaKey || e.ctrlKey) store.toggleSelect(f.id);
        else { store.select(f.id); this.viewer.scrollToField(f.id); }
      },
    },
      icon,
      h('span.fl-name', {}, name || KIND[f.type]),
      f.source === 'auto' ? h('span.fl-badge.auto', { title: 'Suggested' }, 'new') : null,
      f.calc ? h('span.fl-badge', { title: 'Calculated' }, 'fx') : null,
      f.showIf?.field ? h('span.fl-badge', { title: `Only visible if ${f.showIf.field}` }, 'if') : null,
      f.required ? h('span.fl-req', { title: 'Required' }, '*') : null);
    return row;
  }
}
