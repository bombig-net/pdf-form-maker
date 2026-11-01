export type FieldType = 'text' | 'area' | 'check' | 'radio' | 'reset';
export type FormatKind = 'none' | 'email' | 'date' | 'phone' | 'number' | 'zip';
export type Align = 'left' | 'center' | 'right';
export type RGB = [number, number, number];
/** 'Helvetica' | 'Times' | 'Courier' oder 'custom:<id>' */
export type FontFamily = string;

/** Rechteck im PDF-Koordinatensystem der Quellseite (Ursprung unten links, Einheit pt). */
export interface Rect { x: number; y: number; w: number; h: number }

export interface Field {
  id: string;
  pageId: string;
  type: FieldType;
  name: string;
  /** Exportwert eines Radio-Buttons (name = Gruppenname). */
  radioValue: string;
  rect: Rect;
  fontFamily: FontFamily;
  bold: boolean;
  italic: boolean;
  /** 0 = automatisch */
  fontSize: number;
  color: RGB;
  autoContrast: boolean;
  /** Erkannte Hintergrundfarbe unter dem Feld (für Smart Contrast). */
  bgColor: RGB | null;
  align: Align;
  required: boolean;
  maxLength: number;
  format: FormatKind;
  placeholder: string;
  /** Statischen Text innerhalb des Feldes beim Export unsichtbar machen. */
  hideText: boolean;
  tooltip: string;
  /** Beschriftung (nur Reset-Button). */
  label: string;
  buttonBg: RGB;
  source: 'layer' | 'tag' | 'manual' | 'import';
  /** Zusätzliche Bereiche, deren Text beim Export ausgeblendet wird (z. B. der Tag-Text selbst). */
  extraHide: Rect[];
}

export interface PageRef {
  id: string;
  docId: string;
  srcIndex: number;
  /** Zusätzliche Drehung durch den Nutzer (0/90/180/270). */
  rotation: number;
}

export interface SnapLine { v: number; a: number; b: number }
export interface SnapLines { xs: SnapLine[]; ys: SnapLine[] }

export interface TextOpRecord {
  streamKey: string;
  start: number;
  end: number;
  /** Ursprung und geschätztes Ende im User Space */
  x: number; y: number;
  x2: number; y2: number;
  size: number;
  color: RGB | null;
  baseFont: string;
  tr: number;
  oc: string[];
}

export interface PathRecord {
  bbox: [number, number, number, number];
  fill: RGB | null;
  stroke: boolean;
  oc: string[];
}

export interface TextItemLite { str: string; x: number; y: number; w: number; h: number }

export interface ExistingWidget {
  name: string;
  kind: 'text' | 'area' | 'check' | 'radio' | 'button' | 'other';
  rect: [number, number, number, number];
  value?: string;
  required?: boolean;
}

export interface PageAnalysis {
  /** CropBox [x1,y1,x2,y2] */
  view: [number, number, number, number];
  baseRotate: number;
  textOps: TextOpRecord[];
  paths: PathRecord[];
  /** Ebenenname -> Bounding Boxes (je markierter Abschnitt) */
  ocBoxes: Record<string, [number, number, number, number][]>;
  snap: SnapLines;
  texts: TextItemLite[];
  widgets: ExistingWidget[];
}

export interface SourceDoc {
  id: string;
  name: string;
  bytes: Uint8Array;
  pages: PageAnalysis[];
}

export interface CustomFont { id: string; name: string; bytes: Uint8Array }

export interface ExportOptions {
  hidePlaceholderLayers: boolean;
}
