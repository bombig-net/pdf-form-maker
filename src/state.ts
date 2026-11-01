import type { CustomFont, Field, FieldType, PageRef, SourceDoc } from './types';
import type { PDFDocumentProxy } from './pdf/pdfjs';

export type Tool = 'select' | FieldType;
export type ChangeKind = 'doc' | 'pages' | 'fields' | 'selection' | 'tool' | 'zoom' | 'options' | 'history';

export interface Options {
  hidePlaceholderLayers: boolean;
  showTabOrder: boolean;
  snap: boolean;
}

interface Snapshot { pages: PageRef[]; fields: Field[] }

class Store {
  docs: SourceDoc[] = [];
  proxies = new Map<string, PDFDocumentProxy>();
  pages: PageRef[] = [];
  fields: Field[] = [];
  customFonts: CustomFont[] = [];
  selectedId: string | null = null;
  tool: Tool = 'select';
  zoom = 1;
  fileName = '';
  options: Options = { hidePlaceholderLayers: false, showTabOrder: false, snap: true };

  private listeners = new Set<(kinds: Set<ChangeKind>) => void>();
  private pending = new Set<ChangeKind>();
  private scheduled = false;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private coalesceKey = '';
  private coalesceAt = 0;

  subscribe(fn: (kinds: Set<ChangeKind>) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  emit(...kinds: ChangeKind[]) {
    kinds.forEach((k) => this.pending.add(k));
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      const ks = new Set(this.pending);
      this.pending.clear();
      this.listeners.forEach((l) => l(ks));
    });
  }

  get hasDocument() { return this.docs.length > 0; }
  get selected(): Field | undefined { return this.fields.find((f) => f.id === this.selectedId); }
  page(id: string) { return this.pages.find((p) => p.id === id); }
  analysis(p: PageRef) { return this.docs.find((d) => d.id === p.docId)!.pages[p.srcIndex]; }
  pageNumber(pageId: string) { return this.pages.findIndex((p) => p.id === pageId) + 1; }

  private snapshot(): Snapshot {
    return { pages: structuredClone(this.pages), fields: structuredClone(this.fields) };
  }

  /**
   * Änderung mit Verlauf. `coalesce` fasst schnelle Folgeänderungen (z. B. Tippen) zu einem Schritt zusammen.
   */
  commit(mutate: () => void, kinds: ChangeKind[] = ['fields'], coalesce?: string) {
    const now = Date.now();
    const merge = coalesce && coalesce === this.coalesceKey && now - this.coalesceAt < 1200;
    if (!merge) {
      this.undoStack.push(this.snapshot());
      if (this.undoStack.length > 200) this.undoStack.shift();
      this.redoStack = [];
    }
    this.coalesceKey = coalesce ?? '';
    this.coalesceAt = now;
    mutate();
    this.emit(...kinds, 'history');
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  undo() {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(this.snapshot());
    this.restore(s);
  }
  redo() {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this.snapshot());
    this.restore(s);
  }
  private restore(s: Snapshot) {
    this.pages = s.pages; this.fields = s.fields;
    if (this.selectedId && !this.fields.some((f) => f.id === this.selectedId)) this.selectedId = null;
    this.coalesceKey = '';
    this.emit('pages', 'fields', 'selection', 'history');
  }

  select(id: string | null) {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.coalesceKey = '';
    this.emit('selection');
  }
  setTool(t: Tool) { this.tool = t; this.emit('tool'); }
  setZoom(z: number) { this.zoom = Math.min(4, Math.max(0.25, z)); this.emit('zoom'); }

  reset() {
    this.proxies.forEach((p) => p.destroy());
    this.docs = []; this.proxies.clear(); this.pages = []; this.fields = [];
    this.selectedId = null; this.tool = 'select'; this.undoStack = []; this.redoStack = [];
    this.fileName = '';
    this.emit('doc', 'pages', 'fields', 'selection', 'history');
  }
}

export const store = new Store();
