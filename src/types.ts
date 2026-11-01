export type FieldType = 'text' | 'area' | 'check' | 'radio' | 'reset';
export type FormatKind = 'none' | 'email' | 'date' | 'phone' | 'number' | 'zip';
export type Align = 'left' | 'center' | 'right';
export type RGB = [number, number, number];
/** 'Helvetica' | 'Times' | 'Courier' or 'custom:<id>' */
export type FontFamily = string;

/** Rectangle in the source page's PDF coordinate system (origin bottom left, unit pt). */
export interface Rect { x: number; y: number; w: number; h: number }

export interface Field {
  id: string;
  pageId: string;
  type: FieldType;
  name: string;
  /** Export value of a radio button (name = group name). */
  radioValue: string;
  rect: Rect;
  fontFamily: FontFamily;
  bold: boolean;
  italic: boolean;
  /** 0 = auto */
  fontSize: number;
  color: RGB;
  autoContrast: boolean;
  /** Detected background color under the field (for Smart Contrast). */
  bgColor: RGB | null;
  align: Align;
  required: boolean;
  maxLength: number;
  format: FormatKind;
  placeholder: string;
  /** Make static text inside the field invisible on export. */
  hideText: boolean;
  tooltip: string;
  /** Caption (reset button only). */
  label: string;
  buttonBg: RGB;
  source: 'layer' | 'tag' | 'manual' | 'import';
  /** Additional areas whose text is hidden on export (e.g. the tag text itself). */
  extraHide: Rect[];
}

export interface PageRef {
  id: string;
  docId: string;
  srcIndex: number;
  /** Additional rotation applied by the user (0/90/180/270). */
  rotation: number;
}

export interface SnapLine { v: number; a: number; b: number }
export interface SnapLines { xs: SnapLine[]; ys: SnapLine[] }

export interface TextOpRecord {
  streamKey: string;
  start: number;
  end: number;
  /** Origin and estimated end in user space */
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
  /** Layer name -> bounding boxes (one per marked section) */
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
  /** Regional formats (see util/locale.ts); default Europe. */
  locale?: string;
}
