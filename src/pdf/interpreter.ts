import {
  PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, PDFString, PDFHexString,
  decodePDFRawStream, PDFPage, PDFContext,
} from 'pdf-lib';
import { tokenizeOps, isName, type CSObj, type CSOp } from './tokenizer';
import { apply, mul, IDENT, type M6 } from '../util/geom';
import type { PathRecord, RGB, SnapLines, TextOpRecord } from '../types';

/* ------------------------------------------------------------------ */
/* Stream-Zugriff                                                      */
/* ------------------------------------------------------------------ */

export function decodeStream(s: PDFStream): Uint8Array {
  if (s instanceof PDFRawStream) {
    try { return decodePDFRawStream(s).decode(); } catch { return new Uint8Array(0); }
  }
  // PDFContentStream / PDFFlateStream o. ä.
  const anyS = s as unknown as { getUnencodedContents?: () => Uint8Array; getContents: () => Uint8Array };
  return anyS.getUnencodedContents ? anyS.getUnencodedContents() : anyS.getContents();
}

/** Alle Content-Streams einer Seite dekodiert und mit Zeilenumbruch verbunden (deterministisch). */
export function pageContentBytes(page: PDFPage): Uint8Array {
  const ctx = page.doc.context;
  const contents = page.node.get(PDFName.of('Contents'));
  const parts: Uint8Array[] = [];
  const resolved = contents ? ctx.lookup(contents) : undefined;
  if (resolved instanceof PDFArray) {
    for (let i = 0; i < resolved.size(); i++) {
      const s = ctx.lookup(resolved.get(i));
      if (s instanceof PDFStream) parts.push(decodeStream(s));
    }
  } else if (resolved instanceof PDFStream) parts.push(decodeStream(resolved));
  const total = parts.reduce((a, p) => a + p.length + 1, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; out[o++] = 10; }
  return out;
}

export function pageResources(page: PDFPage): PDFDict | undefined {
  let node: PDFDict | undefined = page.node;
  const ctx = page.doc.context;
  for (let guard = 0; node && guard < 32; guard++) {
    const r = ctx.lookup(node.get(PDFName.of('Resources')));
    if (r instanceof PDFDict) return r;
    const parent: unknown = ctx.lookup(node.get(PDFName.of('Parent')));
    node = parent instanceof PDFDict ? parent : undefined;
  }
  return undefined;
}

export function pdfString(o: unknown): string {
  if (o instanceof PDFString || o instanceof PDFHexString) return o.decodeText();
  if (o instanceof PDFName) return o.decodeText();
  return '';
}

const num = (o: CSObj | undefined, d = 0) => (typeof o === 'number' ? o : d);

/* ------------------------------------------------------------------ */
/* Schrift-Metriken                                                    */
/* ------------------------------------------------------------------ */

interface FontMetrics { baseFont: string; twoByte: boolean; width: (code: number) => number }

function buildFontMetrics(ctx: PDFContext, fd: PDFDict | undefined): FontMetrics {
  if (!fd) return { baseFont: '', twoByte: false, width: () => 500 };
  const baseFont = (ctx.lookup(fd.get(PDFName.of('BaseFont'))) as PDFName | undefined)?.decodeText?.() ?? '';
  const subtype = (ctx.lookup(fd.get(PDFName.of('Subtype'))) as PDFName | undefined)?.decodeText?.() ?? '';
  if (subtype === 'Type0') {
    const desc = ctx.lookup(fd.get(PDFName.of('DescendantFonts')));
    const d0 = desc instanceof PDFArray ? ctx.lookup(desc.get(0)) : undefined;
    const map = new Map<number, number>();
    let dw = 1000;
    if (d0 instanceof PDFDict) {
      const dwo = ctx.lookup(d0.get(PDFName.of('DW')));
      if (dwo instanceof PDFNumber) dw = dwo.asNumber();
      const w = ctx.lookup(d0.get(PDFName.of('W')));
      if (w instanceof PDFArray) {
        let k = 0;
        while (k < w.size()) {
          const first = ctx.lookup(w.get(k));
          const second = ctx.lookup(w.get(k + 1));
          if (!(first instanceof PDFNumber)) break;
          if (second instanceof PDFArray) {
            for (let j = 0; j < second.size(); j++) {
              const v = ctx.lookup(second.get(j));
              if (v instanceof PDFNumber) map.set(first.asNumber() + j, v.asNumber());
            }
            k += 2;
          } else {
            const third = ctx.lookup(w.get(k + 2));
            if (second instanceof PDFNumber && third instanceof PDFNumber) {
              for (let c = first.asNumber(); c <= second.asNumber() && c - first.asNumber() < 65536; c++) map.set(c, third.asNumber());
            }
            k += 3;
          }
        }
      }
    }
    // Hinweis: Wir nehmen Identity-H (CID = Code) an – bei Affinity-Exporten der Normalfall.
    return { baseFont, twoByte: true, width: (c) => map.get(c) ?? dw };
  }
  const fc = ctx.lookup(fd.get(PDFName.of('FirstChar')));
  const widths = ctx.lookup(fd.get(PDFName.of('Widths')));
  const first = fc instanceof PDFNumber ? fc.asNumber() : 0;
  let missing = /courier/i.test(baseFont) ? 600 : 500;
  const desc = ctx.lookup(fd.get(PDFName.of('FontDescriptor')));
  if (desc instanceof PDFDict) {
    const mw = ctx.lookup(desc.get(PDFName.of('MissingWidth')));
    if (mw instanceof PDFNumber && mw.asNumber() > 0) missing = mw.asNumber();
  }
  const arr: number[] = [];
  if (widths instanceof PDFArray) {
    for (let j = 0; j < widths.size(); j++) {
      const v = ctx.lookup(widths.get(j));
      arr.push(v instanceof PDFNumber ? v.asNumber() : missing);
    }
  }
  let scale = 1;
  if (subtype === 'Type3') {
    const fm = ctx.lookup(fd.get(PDFName.of('FontMatrix')));
    if (fm instanceof PDFArray) { const a = ctx.lookup(fm.get(0)); if (a instanceof PDFNumber) scale = a.asNumber() * 1000; }
  }
  return { baseFont, twoByte: false, width: (c) => (arr[c - first] ?? missing) * scale };
}

/* ------------------------------------------------------------------ */
/* Interpreter                                                         */
/* ------------------------------------------------------------------ */

interface GState {
  ctm: M6;
  fill: RGB | null;
  fillN: number; // Komponenten des Füll-Farbraums (1/3/4, 0 = Muster/unbekannt)
  font: FontMetrics | null;
  fontSize: number;
  tc: number; tw: number; th: number; tl: number; trise: number; tr: number;
}

export interface InterpretResult {
  textOps: TextOpRecord[];
  paths: PathRecord[];
  ocBoxes: Record<string, [number, number, number, number][]>;
  snap: SnapLines;
}

function cmykToRgb(c: number, m: number, y: number, k: number): RGB {
  return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
}
function colorFromArgs(args: CSObj[], n: number): RGB | null {
  const v = args.filter((a) => typeof a === 'number') as number[];
  const cnt = n || v.length;
  if (cnt === 1 && v.length >= 1) return [v[0], v[0], v[0]];
  if (cnt === 3 && v.length >= 3) return [v[0], v[1], v[2]];
  if (cnt === 4 && v.length >= 4) return cmykToRgb(v[0], v[1], v[2], v[3]);
  return null;
}

type BBox = [number, number, number, number];
const emptyBox = (): BBox => [Infinity, Infinity, -Infinity, -Infinity];
const extend = (b: BBox, x: number, y: number) => {
  if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
};
const validBox = (b: BBox) => b[0] <= b[2] && b[1] <= b[3];

export function interpretPage(page: PDFPage): InterpretResult {
  const ctx = page.doc.context;
  const res: InterpretResult = { textOps: [], paths: [], ocBoxes: {}, snap: { xs: [], ys: [] } };
  const fontCache = new Map<PDFDict, FontMetrics>();
  const visited = new Set<string>();

  const ocStack: { name: string | null; box: BBox }[] = [];
  const activeOc = () => ocStack.filter((e) => e.name).map((e) => e.name!) as string[];
  const markOc = (x: number, y: number) => { for (const e of ocStack) if (e.name) extend(e.box, x, y); };

  const ocNameFromDict = (d: PDFDict | undefined): string | null => {
    if (!d) return null;
    const type = (ctx.lookup(d.get(PDFName.of('Type'))) as PDFName | undefined)?.decodeText?.();
    if (type === 'OCMD') {
      const ocgs = ctx.lookup(d.get(PDFName.of('OCGs')));
      if (ocgs instanceof PDFDict) return ocNameFromDict(ocgs);
      if (ocgs instanceof PDFArray) {
        const names: string[] = [];
        for (let i = 0; i < ocgs.size(); i++) { const g = ctx.lookup(ocgs.get(i)); if (g instanceof PDFDict) { const n = ocNameFromDict(g); if (n) names.push(n); } }
        return names[0] ?? null;
      }
      return null;
    }
    const n = pdfString(ctx.lookup(d.get(PDFName.of('Name'))));
    return n || null;
  };

  const run = (bytes: Uint8Array, streamKey: string, resources: PDFDict | undefined, gsInit: GState, depth: number) => {
    let gs: GState = { ...gsInit };
    const gstack: GState[] = [];
    let tm: M6 = IDENT, tlm: M6 = IDENT;
    // aktueller Pfad
    let pathBox = emptyBox();
    let segs: { x1: number; y1: number; x2: number; y2: number }[] = [];
    let cur: [number, number] = [0, 0];
    let subStart: [number, number] = [0, 0];
    const lookupRes = (cat: string, name: string) => {
      if (!resources) return undefined;
      const d = ctx.lookup(resources.get(PDFName.of(cat)));
      if (!(d instanceof PDFDict)) return undefined;
      return d.get(PDFName.of(name));
    };
    const addPt = (x: number, y: number) => { const p = apply(gs.ctm, x, y); extend(pathBox, p[0], p[1]); return p; };
    const lineTo = (x: number, y: number) => {
      const a = apply(gs.ctm, cur[0], cur[1]); const b = addPt(x, y);
      segs.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
      cur = [x, y];
    };

    const paint = (fill: boolean, stroke: boolean) => {
      if (validBox(pathBox)) {
        res.paths.push({ bbox: [...pathBox] as BBox, fill: fill ? gs.fill : null, stroke, oc: activeOc() });
        markOc(pathBox[0], pathBox[1]); markOc(pathBox[2], pathBox[3]);
        for (const s of segs) {
          if (Math.abs(s.x1 - s.x2) < 0.01 && Math.abs(s.y1 - s.y2) > 2) res.snap.xs.push({ v: s.x1, a: Math.min(s.y1, s.y2), b: Math.max(s.y1, s.y2) });
          else if (Math.abs(s.y1 - s.y2) < 0.01 && Math.abs(s.x1 - s.x2) > 2) res.snap.ys.push({ v: s.y1, a: Math.min(s.x1, s.x2), b: Math.max(s.x1, s.x2) });
        }
      }
      pathBox = emptyBox(); segs = [];
    };

    const showText = (op: CSOp, strings: (Uint8Array | number)[]) => {
      const font = gs.font;
      const trm0 = mul(tm, gs.ctm);
      const o = apply(trm0, 0, gs.trise);
      for (const part of strings) {
        if (typeof part === 'number') {
          const tx = (-part / 1000) * gs.fontSize * gs.th;
          tm = mul([1, 0, 0, 1, tx, 0], tm);
          continue;
        }
        const step = font?.twoByte ? 2 : 1;
        for (let k = 0; k + step - 1 < part.length; k += step) {
          const code = step === 2 ? (part[k] << 8) | part[k + 1] : part[k];
          const w0 = font ? font.width(code) : 500;
          const tx = ((w0 / 1000) * gs.fontSize + gs.tc + (step === 1 && code === 32 ? gs.tw : 0)) * gs.th;
          tm = mul([1, 0, 0, 1, tx, 0], tm);
        }
      }
      const e = apply(mul(tm, gs.ctm), 0, gs.trise);
      const size = Math.hypot(trm0[2], trm0[3]) * gs.fontSize;
      // "Oberkante": Richtung der y-Achse des Textraums
      const up = apply([trm0[0], trm0[1], trm0[2], trm0[3], 0, 0], 0, gs.fontSize * 0.75);
      res.textOps.push({
        streamKey, start: op.start, end: op.end,
        x: o[0], y: o[1], x2: e[0] + up[0], y2: e[1] + up[1],
        size, color: gs.fill, baseFont: font?.baseFont ?? '', tr: gs.tr, oc: activeOc(),
      });
      markOc(o[0], o[1]); markOc(e[0] + up[0], e[1] + up[1]);
    };

    for (const op of tokenizeOps(bytes)) {
      const a = op.args;
      switch (op.op) {
        case 'q': gstack.push({ ...gs }); break;
        case 'Q': if (gstack.length) gs = gstack.pop()!; break;
        case 'cm': if (a.length >= 6) gs.ctm = mul(a.slice(0, 6).map((v) => num(v)) as M6, gs.ctm); break;
        // Farben
        case 'g': gs.fill = colorFromArgs(a, 1); gs.fillN = 1; break;
        case 'rg': gs.fill = colorFromArgs(a, 3); gs.fillN = 3; break;
        case 'k': gs.fill = colorFromArgs(a, 4); gs.fillN = 4; break;
        case 'cs': {
          const nm = isName(a[0]) ? a[0].v : '';
          if (nm === 'DeviceGray' || nm === 'CalGray' || nm === 'G') gs.fillN = 1;
          else if (nm === 'DeviceRGB' || nm === 'CalRGB' || nm === 'RGB') gs.fillN = 3;
          else if (nm === 'DeviceCMYK' || nm === 'CMYK') gs.fillN = 4;
          else if (nm === 'Pattern') gs.fillN = 0;
          else {
            gs.fillN = 0;
            const csObj = ctx.lookup(lookupRes('ColorSpace', nm));
            if (csObj instanceof PDFArray) {
              const kind = (ctx.lookup(csObj.get(0)) as PDFName | undefined)?.decodeText?.();
              if (kind === 'ICCBased') {
                const st = ctx.lookup(csObj.get(1));
                const nn = st instanceof PDFStream ? ctx.lookup(st.dict.get(PDFName.of('N'))) : undefined;
                gs.fillN = nn instanceof PDFNumber ? nn.asNumber() : 3;
              } else if (kind === 'CalRGB' || kind === 'Lab') gs.fillN = 3;
              else if (kind === 'CalGray') gs.fillN = 1;
            }
          }
          gs.fill = gs.fillN === 4 ? [0, 0, 0] : gs.fillN ? [0, 0, 0] : null;
          break;
        }
        case 'sc': case 'scn': gs.fill = gs.fillN ? colorFromArgs(a, gs.fillN) : gs.fill; break;
        // Pfade
        case 'm': cur = [num(a[0]), num(a[1])]; subStart = cur; addPt(cur[0], cur[1]); break;
        case 'l': lineTo(num(a[0]), num(a[1])); break;
        case 'c': addPt(num(a[0]), num(a[1])); addPt(num(a[2]), num(a[3])); addPt(num(a[4]), num(a[5])); cur = [num(a[4]), num(a[5])]; break;
        case 'v': addPt(num(a[0]), num(a[1])); addPt(num(a[2]), num(a[3])); cur = [num(a[2]), num(a[3])]; break;
        case 'y': addPt(num(a[0]), num(a[1])); addPt(num(a[2]), num(a[3])); cur = [num(a[2]), num(a[3])]; break;
        case 'h': lineTo(subStart[0], subStart[1]); break;
        case 're': {
          const x = num(a[0]), y = num(a[1]), w = num(a[2]), h = num(a[3]);
          cur = [x, y]; subStart = cur; addPt(x, y);
          lineTo(x + w, y); lineTo(x + w, y + h); lineTo(x, y + h); lineTo(x, y);
          break;
        }
        case 'S': case 's': paint(false, true); break;
        case 'f': case 'F': case 'f*': paint(true, false); break;
        case 'B': case 'B*': case 'b': case 'b*': paint(true, true); break;
        case 'n': pathBox = emptyBox(); segs = []; break;
        // Text
        case 'BT': tm = IDENT; tlm = IDENT; break;
        case 'Tf': {
          gs.fontSize = num(a[1], gs.fontSize);
          const ref = isName(a[0]) ? lookupRes('Font', a[0].v) : undefined;
          const fd = ctx.lookup(ref);
          if (fd instanceof PDFDict) {
            let m = fontCache.get(fd);
            if (!m) { m = buildFontMetrics(ctx, fd); fontCache.set(fd, m); }
            gs.font = m;
          }
          break;
        }
        case 'Tc': gs.tc = num(a[0]); break;
        case 'Tw': gs.tw = num(a[0]); break;
        case 'Tz': gs.th = num(a[0], 100) / 100; break;
        case 'TL': gs.tl = num(a[0]); break;
        case 'Ts': gs.trise = num(a[0]); break;
        case 'Tr': gs.tr = num(a[0]); break;
        case 'Td': tlm = mul([1, 0, 0, 1, num(a[0]), num(a[1])], tlm); tm = tlm; break;
        case 'TD': gs.tl = -num(a[1]); tlm = mul([1, 0, 0, 1, num(a[0]), num(a[1])], tlm); tm = tlm; break;
        case 'Tm': if (a.length >= 6) { tlm = a.slice(0, 6).map((v) => num(v)) as M6; tm = tlm; } break;
        case 'T*': tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm); tm = tlm; break;
        case 'Tj': { const s = a[0]; if (s && typeof s === 'object' && !Array.isArray(s) && s.t === 'str') showText(op, [s.v]); break; }
        case "'": {
          tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm); tm = tlm;
          const s = a[0]; if (s && typeof s === 'object' && !Array.isArray(s) && s.t === 'str') showText(op, [s.v]);
          break;
        }
        case '"': {
          gs.tw = num(a[0]); gs.tc = num(a[1]);
          tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm); tm = tlm;
          const s = a[2]; if (s && typeof s === 'object' && !Array.isArray(s) && s.t === 'str') showText(op, [s.v]);
          break;
        }
        case 'TJ': {
          const arr = Array.isArray(a[0]) ? a[0] : [];
          const parts: (Uint8Array | number)[] = [];
          for (const it of arr) {
            if (typeof it === 'number') parts.push(it);
            else if (it && typeof it === 'object' && !Array.isArray(it) && it.t === 'str') parts.push(it.v);
          }
          showText(op, parts);
          break;
        }
        // Marked Content / Ebenen
        case 'BMC': ocStack.push({ name: null, box: emptyBox() }); break;
        case 'BDC': {
          let name: string | null = null;
          if (isName(a[0], 'OC')) {
            const p = a[1];
            if (isName(p)) {
              const d = ctx.lookup(lookupRes('Properties', p.v));
              name = ocNameFromDict(d instanceof PDFDict ? d : undefined);
            }
          }
          ocStack.push({ name, box: emptyBox() });
          break;
        }
        case 'EMC': {
          const e = ocStack.pop();
          if (e?.name && validBox(e.box)) (res.ocBoxes[e.name] ??= []).push(e.box);
          break;
        }
        // XObjects
        case 'Do': {
          if (!isName(a[0])) break;
          const raw = lookupRes('XObject', a[0].v);
          const xo = ctx.lookup(raw);
          if (!(xo instanceof PDFStream)) break;
          const sub = (ctx.lookup(xo.dict.get(PDFName.of('Subtype'))) as PDFName | undefined)?.decodeText?.();
          const ocD = ctx.lookup(xo.dict.get(PDFName.of('OC')));
          const ocName = ocD instanceof PDFDict ? ocNameFromDict(ocD) : null;
          if (ocName) ocStack.push({ name: ocName, box: emptyBox() });
          if (sub === 'Image') {
            for (const [ux, uy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const p = apply(gs.ctm, ux, uy); markOc(p[0], p[1]); }
          } else if (sub === 'Form' && depth < 12) {
            const key = raw instanceof PDFRef ? `x${raw.objectNumber}_${raw.generationNumber}` : `x?${depth}`;
            if (!visited.has(key)) {
              visited.add(key);
              const mo = ctx.lookup(xo.dict.get(PDFName.of('Matrix')));
              let m: M6 = IDENT;
              if (mo instanceof PDFArray && mo.size() >= 6) m = Array.from({ length: 6 }, (_, i) => (ctx.lookup(mo.get(i)) as PDFNumber).asNumber?.() ?? 0) as M6;
              const r2 = ctx.lookup(xo.dict.get(PDFName.of('Resources')));
              run(decodeStream(xo), key, r2 instanceof PDFDict ? r2 : resources, { ...gs, ctm: mul(m, gs.ctm) }, depth + 1);
              visited.delete(key);
            }
          }
          if (ocName) {
            const e = ocStack.pop();
            if (e?.name && validBox(e.box)) (res.ocBoxes[e.name] ??= []).push(e.box);
          }
          break;
        }
        default: break;
      }
    }
  };

  const init: GState = { ctm: IDENT, fill: [0, 0, 0], fillN: 1, font: null, fontSize: 0, tc: 0, tw: 0, th: 1, tl: 0, trise: 0, tr: 0 };
  run(pageContentBytes(page), 'page', pageResources(page), init, 0);
  res.snap = dedupeSnap(res.snap);
  return res;
}

function dedupeSnap(s: SnapLines): SnapLines {
  const d = (arr: SnapLines['xs']) => {
    const m = new Map<number, SnapLines['xs'][number]>();
    for (const l of arr) {
      const k = Math.round(l.v * 2) / 2;
      const ex = m.get(k);
      if (ex) { ex.a = Math.min(ex.a, l.a); ex.b = Math.max(ex.b, l.b); } else m.set(k, { v: k, a: l.a, b: l.b });
    }
    return [...m.values()].slice(0, 2000);
  };
  return { xs: d(s.xs), ys: d(s.ys) };
}
