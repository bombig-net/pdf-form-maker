import {
  PDFDocument, PDFPage, PDFName, PDFDict, PDFArray, PDFRef, PDFStream, PDFHexString, PDFFont,
  StandardFonts, TextAlignment, degrees, rgb, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFButton, PDFNumber,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { CustomFont, ExportOptions, Field, PageRef, Rect, RGB, SourceDoc, TextOpRecord } from '../types';
import { decodeStream, pageContentBytes } from './interpreter';
import { rectContainsPoint } from '../util/geom';
import { parseTag } from './detect';
import { effectiveColor } from '../util/color';
import { sortForTabOrder } from '../util/tabOrder';
import { locale, type LocaleFormat } from '../util/locale';
import { buttonScript, calcScript, conditionMet, conditionScripts } from './logic';

export interface ExportInput {
  docs: SourceDoc[];
  pages: PageRef[];
  fields: Field[];
  customFonts: CustomFont[];
  options: ExportOptions;
}
export interface ExportResult { bytes: Uint8Array; warnings: string[]; fieldCount: number }

const enc = new TextEncoder();
const N = (s: string) => PDFName.of(s);

/* ------------------------------------------------------------------ */
/* Hiding text (rewriting content streams)                             */
/* ------------------------------------------------------------------ */

export function opsToHide(ops: TextOpRecord[], rects: Rect[]): TextOpRecord[] {
  if (!rects.length) return [];
  return ops.filter((op) => {
    if (op.tr === 3) return false;
    const mx = (op.x + op.x2) / 2, my = (op.y + op.y2) / 2;
    const oy = op.y + op.size * 0.3;
    return rects.some((r) => rectContainsPoint(r, op.x + 0.3, oy, 0.75) || (rectContainsPoint(r, mx, my, 0.75) && rectContainsPoint(r, op.x + 0.3, op.y + op.size * 0.3, op.size)));
  });
}

export function rewriteHidden(bytes: Uint8Array, ops: TextOpRecord[]): Uint8Array {
  const sorted = [...ops].sort((a, b) => a.start - b.start);
  const chunks: Uint8Array[] = [];
  let pos = 0;
  for (const op of sorted) {
    if (op.start < pos) continue;
    chunks.push(bytes.subarray(pos, op.start));
    chunks.push(enc.encode('\n3 Tr\n'));
    chunks.push(bytes.subarray(op.start, op.end));
    chunks.push(enc.encode(`\n${op.tr} Tr\n`));
    pos = op.end;
  }
  chunks.push(bytes.subarray(pos));
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

function applyHiding(lib: PDFDocument, page: PDFPage, ops: TextOpRecord[]) {
  const ctx = lib.context;
  const byKey = new Map<string, TextOpRecord[]>();
  for (const op of ops) { const l = byKey.get(op.streamKey) ?? []; l.push(op); byKey.set(op.streamKey, l); }
  for (const [key, list] of byKey) {
    if (key === 'page') {
      const nb = rewriteHidden(pageContentBytes(page), list);
      const s = ctx.flateStream(nb);
      page.node.set(N('Contents'), ctx.register(s));
    } else {
      const m = /^x(\d+)_(\d+)$/.exec(key);
      if (!m) continue;
      const ref = PDFRef.of(+m[1], +m[2]);
      const old = ctx.lookup(ref);
      if (!(old instanceof PDFStream)) continue;
      const nb = rewriteHidden(decodeStream(old), list);
      const s = ctx.flateStream(nb);
      for (const [k, v] of old.dict.entries()) {
        const kn = k.decodeText();
        if (kn === 'Filter' || kn === 'DecodeParms' || kn === 'Length') continue;
        s.dict.set(k, v);
      }
      ctx.assign(ref, s);
    }
  }
}

function stripWidgets(lib: PDFDocument, page: PDFPage) {
  const ctx = lib.context;
  const annots = ctx.lookup(page.node.get(N('Annots')));
  if (!(annots instanceof PDFArray)) return;
  const keep = PDFArray.withContext(ctx);
  for (let i = 0; i < annots.size(); i++) {
    const ref = annots.get(i);
    const a = ctx.lookup(ref);
    const sub = a instanceof PDFDict ? (ctx.lookup(a.get(N('Subtype'))) as PDFName | undefined)?.decodeText?.() : '';
    if (sub !== 'Widget') keep.push(ref);
  }
  if (keep.size()) page.node.set(N('Annots'), keep); else page.node.delete(N('Annots'));
}

/* ------------------------------------------------------------------ */
/* JavaScript for formats & placeholders                               */
/* ------------------------------------------------------------------ */

const jsStr = (s: string) => JSON.stringify(s);

export function buildScripts(f: Field, color: RGB, loc: LocaleFormat = locale()): { K?: string; F?: string; V?: string } {
  const out: { K?: string; F?: string; V?: string } = {};
  let fmt = '';
  switch (f.format) {
    case 'date':
      out.K = `AFDate_KeystrokeEx("${loc.date}");`;
      fmt = `AFDate_FormatEx("${loc.date}");`;
      break;
    case 'number':
      out.K = `AFNumber_Keystroke(2, ${loc.sepStyle}, 0, 0, "", true);`;
      fmt = `AFNumber_Format(2, ${loc.sepStyle}, 0, 0, "", true);`;
      break;
    case 'email':
      out.V = 'if (event.value && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(event.value)) { app.alert("Please enter a valid email address."); event.rc = false; }';
      break;
    case 'phone':
      out.K = 'if (!event.willCommit && event.change && !/^[0-9+()\\/\\-\\s]*$/.test(event.change)) event.rc = false;';
      out.V = 'if (event.value && !/^[+]?[0-9()\\/\\-\\s]{5,}$/.test(event.value)) { app.alert("Please enter a valid phone number."); event.rc = false; }';
      break;
    case 'zip':
      out.K = `if (!event.willCommit && event.change && !/${loc.zipKeys}/.test(event.change)) event.rc = false;`;
      out.V = `if (event.value && !/${loc.zip}/.test(event.value)) { app.alert("Please enter a valid postal code."); event.rc = false; }`;
      break;
  }
  if (f.placeholder && (f.type === 'text' || f.type === 'area')) {
    const c = `["RGB",${color.map((v) => +v.toFixed(3)).join(',')}]`;
    out.F = `if (event.value === "") { event.value = ${jsStr(f.placeholder)}; event.target.textColor = ["G",0.6]; } else { event.target.textColor = ${c}; ${fmt} }`;
  } else if (fmt) out.F = fmt;
  return out;
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

const STD: Record<string, { font: StandardFonts; res: string }> = {
  'Helvetica|0|0': { font: StandardFonts.Helvetica, res: 'Helv' },
  'Helvetica|1|0': { font: StandardFonts.HelveticaBold, res: 'HeBo' },
  'Helvetica|0|1': { font: StandardFonts.HelveticaOblique, res: 'HeOb' },
  'Helvetica|1|1': { font: StandardFonts.HelveticaBoldOblique, res: 'HeBO' },
  'Times|0|0': { font: StandardFonts.TimesRoman, res: 'TiRo' },
  'Times|1|0': { font: StandardFonts.TimesRomanBold, res: 'TiBo' },
  'Times|0|1': { font: StandardFonts.TimesRomanItalic, res: 'TiIt' },
  'Times|1|1': { font: StandardFonts.TimesRomanBoldItalic, res: 'TiBI' },
  'Courier|0|0': { font: StandardFonts.Courier, res: 'Cour' },
  'Courier|1|0': { font: StandardFonts.CourierBold, res: 'CoBo' },
  'Courier|0|1': { font: StandardFonts.CourierOblique, res: 'CoOb' },
  'Courier|1|1': { font: StandardFonts.CourierBoldOblique, res: 'CoBO' },
};

function sanitizeName(n: string): string {
  return (n || 'Field').replace(/[.\s]+/g, '_').replace(/[()<>[\]{}/%#]/g, '').slice(0, 120) || 'Field';
}

export async function exportPdf(input: ExportInput): Promise<ExportResult> {
  const { docs, pages, fields, options } = input;
  const warnings: string[] = [];
  if (!pages.length) throw new Error('The document has no pages.');
  const docById = new Map(docs.map((d) => [d.id, d]));

  // 1) Load the sources fresh
  const libs = new Map<string, PDFDocument>();
  for (const id of new Set(pages.map((p) => p.docId))) {
    const d = docById.get(id)!;
    libs.set(id, await PDFDocument.load(d.bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false }));
  }
  const base = libs.get(pages[0].docId)!;
  base.registerFontkit(fontkit);

  // 2) Hide text + remove old widgets
  const fieldsByPage = new Map<string, Field[]>();
  for (const f of fields) { const l = fieldsByPage.get(f.pageId) ?? []; l.push(f); fieldsByPage.set(f.pageId, l); }
  for (const pr of pages) {
    const lib = libs.get(pr.docId)!;
    const page = lib.getPage(pr.srcIndex);
    const an = docById.get(pr.docId)!.pages[pr.srcIndex];
    const rects: Rect[] = [];
    for (const f of fieldsByPage.get(pr.id) ?? []) {
      if (f.hideText && f.type !== 'reset') rects.push(f.rect);
      rects.push(...f.extraHide);
    }
    const ops = opsToHide(an.textOps, rects);
    if (ops.length) applyHiding(lib, page, ops);
    stripWidgets(lib, page);
  }
  for (const lib of libs.values()) lib.catalog.delete(N('AcroForm'));

  // 3) Assemble pages (order, rotation, merging)
  const finalPages: PDFPage[] = new Array(pages.length);
  const baseDocId = pages[0].docId;
  pages.forEach((pr, i) => { if (pr.docId === baseDocId) finalPages[i] = base.getPage(pr.srcIndex); });
  for (const [docId, lib] of libs) {
    if (docId === baseDocId) continue;
    const idx = pages.map((p, i) => ({ p, i })).filter((x) => x.p.docId === docId);
    const copied = await base.copyPages(lib, idx.map((x) => x.p.srcIndex));
    idx.forEach((x, k) => (finalPages[x.i] = copied[k]));
  }
  for (let i = base.getPageCount() - 1; i >= 0; i--) base.removePage(i);
  finalPages.forEach((p) => base.addPage(p));
  // Widget rotation follows the original page rotation: when the user rotates a page, fields rotate with the content.
  const pageRot = new Map<string, number>();
  const viewRot = new Map<string, number>();
  pages.forEach((pr, i) => {
    const an = docById.get(pr.docId)!.pages[pr.srcIndex];
    const r = (((an.baseRotate + pr.rotation) % 360) + 360) % 360;
    finalPages[i].setRotation(degrees(r));
    pageRot.set(pr.id, ((an.baseRotate % 360) + 360) % 360);
    viewRot.set(pr.id, r);
  });
  const pageObj = new Map(pages.map((pr, i) => [pr.id, finalPages[i]]));

  // Hide placeholder layers
  if (options.hidePlaceholderLayers) hideFormLayers(base);

  // 4) Form fields
  const form = base.getForm();
  const drFonts = ensureDRFonts(base);
  const fontCache = new Map<string, { font: PDFFont; res: string }>();
  const getFont = async (f: Field) => {
    const key = f.fontFamily.startsWith('custom:') ? f.fontFamily : `${f.fontFamily}|${+f.bold}|${+f.italic}`;
    let e = fontCache.get(key);
    if (e) return e;
    if (f.fontFamily.startsWith('custom:')) {
      const cf = input.customFonts.find((c) => 'custom:' + c.id === f.fontFamily);
      if (cf) {
        try {
          const font = await base.embedFont(cf.bytes, { subset: false });
          e = { font, res: 'CF' + (fontCache.size + 1) };
        } catch { warnings.push(`Font “${cf.name}” could not be embedded – Helvetica was used instead.`); }
      }
    }
    if (!e) {
      const s = STD[`${f.fontFamily.startsWith('custom:') ? 'Helvetica' : f.fontFamily}|${+f.bold}|${+f.italic}`] ?? STD['Helvetica|0|0'];
      e = { font: await base.embedFont(s.font), res: s.res };
    }
    drFonts.set(N(e.res), e.font.ref);
    fontCache.set(key, e);
    return e;
  };
  const zadb = await base.embedFont(StandardFonts.ZapfDingbats);
  drFonts.set(N('ZaDb'), zadb.ref);

  // Group by name (same name = synchronized fields)
  const placed = fields.filter((f) => pageObj.has(f.pageId));
  const groups = new Map<string, Field[]>();
  let resetNo = 0;
  for (const f of placed) {
    let name = f.type === 'reset' ? sanitizeName(f.name || `Reset_${++resetNo}`) : sanitizeName(f.name);
    let g = groups.get(name);
    if (g && (g[0].type !== f.type || f.type === 'reset')) {
      const alt = `${name}_${f.type}`;
      if (f.type !== 'reset') warnings.push(`“${name}” is used for different field types – renamed to “${alt}”.`);
      name = f.type === 'reset' ? `${name}_${++resetNo}` : alt;
      g = groups.get(name);
    }
    if (!g) { g = []; groups.set(name, g); }
    g.push(f);
  }

  const rectOpts = (r: Rect, rot: number) => {
    switch (rot) {
      case 90: return { x: r.x + r.w, y: r.y, width: r.h, height: r.w };
      case 180: return { x: r.x + r.w, y: r.y + r.h, width: r.w, height: r.h };
      case 270: return { x: r.x, y: r.y + r.h, width: r.h, height: r.w };
      default: return { x: r.x, y: r.y, width: r.w, height: r.h };
    }
  };
  // Inner padding: the field area is inset so the text keeps some distance from the printed frame
  const pad = Math.max(0, options.padding ?? 0);
  const inset = (r: Rect, vertical: boolean): Rect => {
    let { x, y, w, h } = r;
    if (pad && w > pad * 2 + 6) { x += pad; w -= pad * 2; }
    if (pad && vertical && h > pad * 2 + 6) { y += pad; h -= pad * 2; }
    return { x, y, w, h };
  };
  const fmtColor = (c: RGB) => c.map((v) => +Math.min(1, Math.max(0, v)).toFixed(3)).join(' ');
  const noStyle = { textColor: undefined, backgroundColor: undefined, borderColor: undefined, borderWidth: 0 };

  let fieldCount = 0;
  /** Font of each text field and dropdown, to draw filled-in values with it. */
  const fieldFonts = new Map<string, PDFFont>();
  const calcRefs: PDFRef[] = [];
  for (const [name, group] of groups) {
    const f0 = group[0];
    const color = effectiveColor(f0);
    try {
      if (f0.type === 'text' || f0.type === 'area') {
        const tf = form.createTextField(name);
        const { font, res } = await getFont(f0);
        fieldFonts.set(name, font);
        tf.acroField.setDefaultAppearance(`/${res} ${f0.fontSize || 0} Tf ${fmtColor(color)} rg`);
        if (f0.type === 'area') tf.enableMultiline(); else tf.disableMultiline();
        tf.setAlignment(f0.align === 'center' ? TextAlignment.Center : f0.align === 'right' ? TextAlignment.Right : TextAlignment.Left);
        if (f0.maxLength > 0) tf.setMaxLength(f0.maxLength);
        if (f0.comb && f0.type === 'text' && f0.maxLength > 0) tf.enableCombing();
        if (f0.required) tf.enableRequired();
        if (f0.readOnly) tf.enableReadOnly();
        if (f0.format !== 'none' && f0.type === 'text') tf.disableRichFormatting();
        const def = f0.defaultValue && !f0.calc ? cleanForFont(font, f0.defaultValue).slice(0, f0.maxLength > 0 ? f0.maxLength : undefined) : '';
        for (const f of group) {
          const rot = pageRot.get(f.pageId)!;
          // Comb fields keep their exact size, so the boxes still match the layout
          const r = f0.comb && f0.type === 'text' && f0.maxLength > 0 ? f.rect : inset(f.rect, f0.type === 'area');
          tf.addToPage(pageObj.get(f.pageId)!, { ...rectOpts(r, rot), ...noStyle, font, rotate: degrees(rot) });
        }
        // Placeholder as ghost text in the appearance (for viewers without JavaScript)
        const ph = f0.placeholder ? cleanForFont(font, f0.type === 'area' ? f0.placeholder : f0.placeholder.replace(/\s*\n\s*/g, ' ')) : '';
        if (ph && !def) {
          const text = f0.maxLength > 0 ? ph.slice(0, f0.maxLength) : ph;
          tf.acroField.setDefaultAppearance(`/${res} ${f0.fontSize || 0} Tf 0.6 g`);
          tf.setText(text);
          tf.updateAppearances(font);
          tf.acroField.dict.delete(N('V'));
        }
        finalizeDA(tf.acroField, `/${res} ${f0.fontSize || 0} Tf ${fmtColor(color)} rg`);
        // Default value: filled in when the form opens, and what \u201cReset\u201d goes back to
        if (def) { tf.setText(def); tf.updateAppearances(font); tf.acroField.dict.set(N('DV'), PDFHexString.fromText(def)); }
        setTooltip(tf.acroField.dict, f0.tooltip);
        const scripts: Record<string, string | undefined> = buildScripts(f0, color, locale(options.locale));
        const calc = calcScript(f0);
        if (calc) { scripts.C = calc; tf.enableReadOnly(); calcRefs.push(tf.acroField.ref); }
        setActions(base, tf.acroField.dict, scripts);
      } else if (f0.type === 'dropdown') {
        const dd = form.createDropdown(name);
        const { font, res } = await getFont(f0);
        fieldFonts.set(name, font);
        const opts = [...new Set((f0.choices ?? []).map((c) => cleanForFont(font, c).trim()).filter(Boolean))];
        if (opts.length) dd.setOptions(opts);
        if (f0.required) dd.enableRequired();
        if (f0.readOnly) dd.enableReadOnly();
        for (const f of group) {
          const rot = pageRot.get(f.pageId)!;
          dd.addToPage(pageObj.get(f.pageId)!, { ...rectOpts(inset(f.rect, false), rot), ...noStyle, font, rotate: degrees(rot) });
        }
        finalizeDA(dd.acroField, `/${res} ${f0.fontSize || 0} Tf ${fmtColor(color)} rg`);
        const ddDef = f0.defaultValue ? cleanForFont(font, f0.defaultValue).trim() : '';
        if (ddDef && opts.includes(ddDef)) { dd.select(ddDef); dd.updateAppearances(font); dd.acroField.dict.set(N('DV'), PDFHexString.fromText(ddDef)); }
        setTooltip(dd.acroField.dict, f0.tooltip);
      } else if (f0.type === 'check') {
        const cb = form.createCheckBox(name);
        cb.acroField.setDefaultAppearance(`/ZaDb 0 Tf ${fmtColor(color)} rg`);
        if (f0.required) cb.enableRequired();
        for (const f of group) {
          const rot = pageRot.get(f.pageId)!;
          cb.addToPage(pageObj.get(f.pageId)!, { ...rectOpts(f.rect, rot), ...noStyle, rotate: degrees(rot) });
        }
        setCaption(cb, '4');
        finalizeDA(cb.acroField, `/ZaDb 0 Tf ${fmtColor(color)} rg`);
        if (f0.readOnly) cb.enableReadOnly();
        if (f0.defaultValue === 'on') { cb.check(); cb.acroField.dict.set(N('DV'), cb.acroField.dict.get(N('V'))!); }
        setTooltip(cb.acroField.dict, f0.tooltip);
      } else if (f0.type === 'radio') {
        const rg = form.createRadioGroup(name);
        rg.acroField.setDefaultAppearance(`/ZaDb 0 Tf ${fmtColor(color)} rg`);
        if (f0.required) rg.enableRequired();
        const used = new Set<string>();
        for (const f of group) {
          let v = sanitizeName(f.radioValue || 'Option');
          let k = 2; while (used.has(v)) v = `${sanitizeName(f.radioValue || 'Option')}_${k++}`;
          used.add(v);
          const rot = pageRot.get(f.pageId)!;
          rg.addOptionToPage(v, pageObj.get(f.pageId)!, { ...rectOpts(f.rect, rot), ...noStyle, rotate: degrees(rot) });
        }
        rg.acroField.setFlagTo(1 << 14, true); // NoToggleToOff
        setCaption(rg, 'l');
        if (f0.readOnly) rg.enableReadOnly();
        const rDef = group.find((f) => f.defaultValue)?.defaultValue;
        if (rDef) { try { rg.select(sanitizeName(rDef)); rg.acroField.dict.set(N('DV'), rg.acroField.dict.get(N('V'))!); } catch { /* option was renamed */ } }
        finalizeDA(rg.acroField, `/ZaDb 0 Tf ${fmtColor(color)} rg`);
        setTooltip(rg.acroField.dict, f0.tooltip);
      } else if (f0.type === 'signature') {
        // Signature field (/FT /Sig): Acrobat and Reader let people sign here
        const ctx = base.context;
        const fieldRef = ctx.nextRef();
        const kids: PDFRef[] = [];
        for (const f of group) {
          const page = pageObj.get(f.pageId)!;
          const r = f.rect;
          const ap = ctx.register(ctx.stream('', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, r.w, r.h] }));
          const widget = ctx.register(ctx.obj({
            Type: 'Annot', Subtype: 'Widget', Rect: [r.x, r.y, r.x + r.w, r.y + r.h], F: 4, P: page.ref, Parent: fieldRef, AP: { N: ap },
          }));
          page.node.addAnnot(widget);
          kids.push(widget);
        }
        const dict = ctx.obj({ FT: 'Sig', T: PDFHexString.fromText(name), Kids: kids, Ff: f0.required ? 2 : 0 });
        setTooltip(dict, f0.tooltip);
        ctx.assign(fieldRef, dict);
        form.acroForm.addField(fieldRef);
      } else if (f0.type === 'reset') {
        for (const f of group) {
          const btn = form.createButton(group.length > 1 ? `${name}_${fieldCount}` : name);
          const { font, res } = await getFont(f);
          btn.acroField.setDefaultAppearance(`/${res} ${f.fontSize || 0} Tf`);
          const rot = pageRot.get(f.pageId)!;
          btn.addToPage(cleanForFont(font, f.label || 'Reset'), pageObj.get(f.pageId)!, {
            ...rectOpts(f.rect, rot), font, rotate: degrees(rot),
            textColor: rgb(...effectiveColor({ ...f, bgColor: f.buttonBg })), backgroundColor: rgb(...f.buttonBg), borderColor: undefined, borderWidth: 0,
          });
          finalizeDA(btn.acroField, `/${res} ${f.fontSize || 0} Tf ${fmtColor(effectiveColor({ ...f, bgColor: f.buttonBg }))} rg`);
          const ws = btn.acroField.getWidgets();
          const hideAll = placed.filter((x) => x.showIf?.field).map((x) => `this.getField(${JSON.stringify(sanitizeName(x.name))}).display = display.hidden;`).join('\n');
          const js = buttonScript(f.buttonAction, f.mailTo ?? '', f.mailSubject ?? '');
          const action = js
            ? base.context.obj({ S: 'JavaScript', JS: PDFHexString.fromText(js) })
            : base.context.obj(hideAll ? { S: 'ResetForm', Next: base.context.obj({ S: 'JavaScript', JS: PDFHexString.fromText(hideAll) }) } : { S: 'ResetForm' });
          ws[ws.length - 1].dict.set(N('A'), action);
          setTooltip(btn.acroField.dict, f.tooltip || f.label);
          fieldCount++;
        }
        continue;
      }
      fieldCount += group.length;
    } catch (e) {
      warnings.push(`Field “${name}” could not be created: ${(e as Error).message}`);
    }
  }

  // Calculation order: in the order the fields were created
  if (calcRefs.length) form.acroForm.dict.set(N('CO'), base.context.obj(calcRefs));

  // Conditional visibility: dependents start hidden, controllers show/hide them
  for (const f of placed) {
    if (!f.showIf?.field) continue;
    try {
      for (const w of form.getField(sanitizeName(f.name)).acroField.getWidgets()) {
        const fl = w.dict.get(N('F'));
        w.dict.set(N('F'), PDFNumber.of((fl instanceof PDFNumber ? fl.asNumber() : 4) | 2));
      }
    } catch { /* field was renamed or not created */ }
  }
  for (const [ctrl, { kind, js }] of conditionScripts(placed)) {
    try {
      const field = form.getField(sanitizeName(ctrl));
      const action = base.context.obj({ Type: 'Action', S: 'JavaScript', JS: PDFHexString.fromText(js) });
      if (kind === 'dropdown') {
        const aa = base.context.obj({}) as PDFDict;
        aa.set(N('V'), action);
        field.acroField.dict.set(N('AA'), aa);
      } else {
        for (const w of field.acroField.getWidgets()) {
          const aa = base.context.obj({}) as PDFDict;
          aa.set(N('U'), action);
          w.dict.set(N('AA'), aa);
        }
      }
    } catch { warnings.push(`The visibility rule for \u201c${ctrl}\u201d could not be added.`); }
  }

  // Filled-in copy: values from test mode, conditional fields shown or removed accordingly
  if (options.values || options.flatten) fillAndFlatten(form, placed, groups, fieldFonts, options, warnings);

  // 5) Tab order: sort widgets on each page from top left to bottom right
  pages.forEach((pr) => {
    const page = pageObj.get(pr.id)!;
    sortAnnotsForTabOrder(base, page, viewRot.get(pr.id)!);
  });

  base.setProducer('PDF Form Maker');
  const bytes = await base.save({ updateFieldAppearances: false, useObjectStreams: true });
  return { bytes, warnings, fieldCount };
}

/**
 * Writes values into the fields (as typed in test mode) and, with flatten, bakes them into the page.
 * Conditional fields whose condition is met become visible; when flattening, the others and all
 * buttons and signature fields are removed, so the result is a plain printable PDF.
 */
function fillAndFlatten(form: ReturnType<PDFDocument['getForm']>, placed: Field[], groups: Map<string, Field[]>, fonts: Map<string, PDFFont>, options: ExportOptions, warnings: string[]) {
  const values = options.values ?? {};
  const value = (n: string) => values[n];
  for (const [name, group] of groups) {
    const f0 = group[0];
    const v = value(f0.name);
    try {
      if (f0.type === 'text' || f0.type === 'area') {
        const tf = form.getTextField(name);
        const font = fonts.get(name);
        let text = typeof v === 'string' ? v : '';
        if (font) text = cleanForFont(font, text);
        if (f0.maxLength > 0) text = text.slice(0, f0.maxLength);
        // Empty fields lose their gray ghost text in a filled-in copy
        if (text || options.flatten) { tf.setText(text || undefined); if (font) tf.updateAppearances(font); }
      } else if (f0.type === 'dropdown' && typeof v === 'string' && v) {
        const dd = form.getDropdown(name);
        dd.select(v);
        const font = fonts.get(name);
        if (font) dd.updateAppearances(font);
      } else if (f0.type === 'check' && v === true) {
        form.getCheckBox(name).check();
      } else if (f0.type === 'radio' && typeof v === 'string' && v) {
        form.getRadioGroup(name).select(sanitizeName(v));
      }
    } catch { warnings.push(`The value of \u201c${name}\u201d could not be filled in.`); }
  }
  // Conditional fields: visible when the condition is met by the filled-in values
  for (const f of placed) {
    if (!f.showIf?.field) continue;
    try {
      const field = form.getField(sanitizeName(f.name));
      if (conditionMet(f, value)) {
        for (const w of field.acroField.getWidgets()) {
          const fl = w.dict.get(N('F'));
          if (fl instanceof PDFNumber) w.dict.set(N('F'), PDFNumber.of(fl.asNumber() & ~2));
        }
      } else if (options.flatten) form.removeField(field);
    } catch { /* already removed */ }
  }
  if (!options.flatten) return;
  for (const field of form.getFields()) {
    const ft = field.acroField.dict.lookup(N('FT'));
    const isButton = field instanceof PDFButton;
    if (isButton || (ft instanceof PDFName && ft.decodeText() === 'Sig')) form.removeField(field);
  }
  form.acroForm.dict.delete(N('CO'));
  form.flatten({ updateFieldAppearances: false });
}

function cleanForFont(font: PDFFont, text: string): string {
  try {
    const set = new Set(font.getCharacterSet());
    let out = '';
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (ch === '\n' || set.has(cp)) out += ch;
      else if (/[„“”]/.test(ch)) out += '"';
      else if (/[‚‘’]/.test(ch)) out += "'";
      else if (/[–—]/.test(ch)) out += '-';
      else out += '';
    }
    return out;
  } catch { return text.replace(/[^\x20-\x7E\n\u00A0-\u00FF]/g, ''); }
}

function ensureDRFonts(doc: PDFDocument): PDFDict {
  const form = doc.getForm();
  const ctx = doc.context;
  const af = form.acroForm.dict;
  let dr = ctx.lookup(af.get(N('DR')));
  if (!(dr instanceof PDFDict)) { dr = ctx.obj({}); af.set(N('DR'), dr as PDFDict); }
  let fonts = ctx.lookup((dr as PDFDict).get(N('Font')));
  if (!(fonts instanceof PDFDict)) { fonts = ctx.obj({}); (dr as PDFDict).set(N('Font'), fonts as PDFDict); }
  if (!af.get(N('DA'))) af.set(N('DA'), PDFHexString.fromText('/Helv 0 Tf 0 g'));
  return fonts as PDFDict;
}

/** pdf-lib overwrites /DA with internal font names – we set the clean value (font from /DR, size 0 = auto). */
function finalizeDA(acro: { setDefaultAppearance(da: string): void; getWidgets(): { dict: PDFDict }[] }, da: string) {
  acro.setDefaultAppearance(da);
  for (const w of acro.getWidgets()) w.dict.delete(N('DA'));
}

function setTooltip(dict: PDFDict, text: string) {
  if (text && text.trim()) dict.set(N('TU'), PDFHexString.fromText(text.trim()));
}

function setCaption(field: PDFCheckBox | PDFRadioGroup, ch: string) {
  for (const w of field.acroField.getWidgets()) {
    const mk = w.getOrCreateAppearanceCharacteristics();
    mk.dict.set(N('CA'), PDFHexString.fromText(ch));
  }
}

function setActions(doc: PDFDocument, dict: PDFDict, scripts: Record<string, string | undefined>) {
  const entries = Object.entries(scripts).filter(([, v]) => v);
  if (!entries.length) return;
  const aa = doc.context.obj({}) as PDFDict;
  for (const [k, js] of entries) {
    aa.set(N(k), doc.context.obj({ Type: 'Action', S: 'JavaScript', JS: PDFHexString.fromText(js!) }));
  }
  dict.set(N('AA'), aa);
}

function hideFormLayers(doc: PDFDocument) {
  const ctx = doc.context;
  const ocp = ctx.lookup(doc.catalog.get(N('OCProperties')));
  if (!(ocp instanceof PDFDict)) return;
  const ocgs = ctx.lookup(ocp.get(N('OCGs')));
  const d = ctx.lookup(ocp.get(N('D')));
  if (!(ocgs instanceof PDFArray) || !(d instanceof PDFDict)) return;
  let off = ctx.lookup(d.get(N('OFF')));
  if (!(off instanceof PDFArray)) { off = PDFArray.withContext(ctx); d.set(N('OFF'), off as PDFArray); }
  const on = ctx.lookup(d.get(N('ON')));
  for (let i = 0; i < ocgs.size(); i++) {
    const ref = ocgs.get(i);
    const g = ctx.lookup(ref);
    if (!(g instanceof PDFDict)) continue;
    const nameObj = g.lookup(N('Name'));
    const name = nameObj instanceof PDFHexString || (nameObj && 'decodeText' in (nameObj as object)) ? (nameObj as PDFHexString).decodeText() : '';
    if (parseTag(name)) {
      (off as PDFArray).push(ref);
      if (on instanceof PDFArray) {
        const idx = on.indexOf(ref);
        if (idx !== undefined && idx >= 0) on.remove(idx);
      }
    }
  }
}

function sortAnnotsForTabOrder(doc: PDFDocument, page: PDFPage, rotation: number) {
  const ctx = doc.context;
  const annots = ctx.lookup(page.node.get(N('Annots')));
  if (!(annots instanceof PDFArray)) return;
  const widgets: { ref: ReturnType<PDFArray['get']>; rect: Rect }[] = [];
  const others: ReturnType<PDFArray['get']>[] = [];
  for (let i = 0; i < annots.size(); i++) {
    const ref = annots.get(i);
    const a = ctx.lookup(ref);
    if (a instanceof PDFDict && (ctx.lookup(a.get(N('Subtype'))) as PDFName | undefined)?.decodeText?.() === 'Widget') {
      const r = ctx.lookup(a.get(N('Rect')));
      const nums = r instanceof PDFArray ? [0, 1, 2, 3].map((k) => (ctx.lookup(r.get(k)) as PDFNumber).asNumber()) : [0, 0, 0, 0];
      widgets.push({ ref, rect: { x: Math.min(nums[0], nums[2]), y: Math.min(nums[1], nums[3]), w: Math.abs(nums[2] - nums[0]), h: Math.abs(nums[3] - nums[1]) } });
    } else others.push(ref);
  }
  const sorted = sortForTabOrder(widgets, (w) => w.rect, rotation);
  const arr = PDFArray.withContext(ctx);
  for (const w of sorted) arr.push(w.ref);
  for (const o of others) arr.push(o);
  page.node.set(N('Annots'), arr);
}

export type { PDFTextField, PDFButton };
