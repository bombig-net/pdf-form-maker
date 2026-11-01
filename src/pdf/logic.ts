import type { Field } from '../types';

/* ------------------------------------------------------------------ */
/* Formulas: field names, numbers, + - * / and parentheses             */
/* ------------------------------------------------------------------ */

export type Node =
  | { k: 'num'; v: number }
  | { k: 'ref'; name: string }
  | { k: 'neg'; a: Node }
  | { k: 'op'; op: '+' | '-' | '*' | '/'; a: Node; b: Node };

/** Parses a formula. Throws an Error with a readable message on invalid input. */
export function parseFormula(src: string, known?: Set<string>): Node {
  const toks = src.match(/\s*(\d+(?:[.,]\d+)?|[A-Za-z_\u00C0-\u024F][\w\u00C0-\u024F]*|[-+*/()]|\S)/g)?.map((t) => t.trim()) ?? [];
  let i = 0;
  const peek = () => toks[i];
  const expr = (): Node => {
    let a = term();
    while (peek() === '+' || peek() === '-') { const op = toks[i++] as '+' | '-'; a = { k: 'op', op, a, b: term() }; }
    return a;
  };
  const term = (): Node => {
    let a = factor();
    while (peek() === '*' || peek() === '/') { const op = toks[i++] as '*' | '/'; a = { k: 'op', op, a, b: factor() }; }
    return a;
  };
  const factor = (): Node => {
    const t = toks[i++];
    if (t === undefined) throw new Error('The formula ends too early.');
    if (t === '-') return { k: 'neg', a: factor() };
    if (t === '(') { const e = expr(); if (toks[i++] !== ')') throw new Error('A closing parenthesis is missing.'); return e; }
    if (/^\d/.test(t)) return { k: 'num', v: parseFloat(t.replace(',', '.')) };
    if (/^[A-Za-z_\u00C0-\u024F]/.test(t)) {
      if (known && !known.has(t)) throw new Error(`There is no field named \u201c${t}\u201d.`);
      return { k: 'ref', name: t };
    }
    throw new Error(`\u201c${t}\u201d is not allowed in a formula.`);
  };
  if (!toks.length) throw new Error('The formula is empty.');
  const n = expr();
  if (i < toks.length) throw new Error(`Unexpected \u201c${toks[i]}\u201d.`);
  return n;
}

export function evalFormula(n: Node, get: (name: string) => number): number {
  switch (n.k) {
    case 'num': return n.v;
    case 'ref': return get(n.name);
    case 'neg': return -evalFormula(n.a, get);
    case 'op': {
      const a = evalFormula(n.a, get), b = evalFormula(n.b, get);
      return n.op === '+' ? a + b : n.op === '-' ? a - b : n.op === '*' ? a * b : b === 0 ? 0 : a / b;
    }
  }
}

export function formulaRefs(n: Node, out = new Set<string>()): Set<string> {
  if (n.k === 'ref') out.add(n.name);
  else if (n.k === 'neg') formulaRefs(n.a, out);
  else if (n.k === 'op') { formulaRefs(n.a, out); formulaRefs(n.b, out); }
  return out;
}

/** Acrobat JavaScript for a formula. */
function formulaJs(n: Node): string {
  switch (n.k) {
    case 'num': return String(n.v);
    case 'ref': return `AFMakeNumber(this.getField(${JSON.stringify(n.name)}).value)`;
    case 'neg': return `(-${formulaJs(n.a)})`;
    case 'op': return n.op === '/' ? `(${formulaJs(n.b)} == 0 ? 0 : ${formulaJs(n.a)} / ${formulaJs(n.b)})` : `(${formulaJs(n.a)} ${n.op} ${formulaJs(n.b)})`;
  }
}

/* ------------------------------------------------------------------ */
/* Calculated fields                                                   */
/* ------------------------------------------------------------------ */

export const CALC_OPS = { sum: 'Sum', product: 'Product', average: 'Average', min: 'Minimum', max: 'Maximum', formula: 'Formula' } as const;
export type CalcOp = keyof typeof CALC_OPS;
const AF_OP: Record<Exclude<CalcOp, 'formula'>, string> = { sum: 'SUM', product: 'PRD', average: 'AVG', min: 'MIN', max: 'MAX' };

/** Field names a calculated field depends on. */
export function calcInputs(f: Field): string[] {
  if (!f.calc) return [];
  if (f.calc.op === 'formula') { try { return [...formulaRefs(parseFormula(f.calc.formula ?? ''))]; } catch { return []; } }
  return f.calc.fields ?? [];
}

/** Acrobat calculate script (/C) of a field, or '' if none or invalid. */
export function calcScript(f: Field): string {
  if (!f.calc) return '';
  if (f.calc.op === 'formula') {
    try { return `event.value = ${formulaJs(parseFormula(f.calc.formula ?? ''))};`; } catch { return ''; }
  }
  const names = (f.calc.fields ?? []).filter(Boolean);
  if (!names.length) return '';
  return `AFSimple_Calculate(${JSON.stringify(AF_OP[f.calc.op])}, new Array(${names.map((n) => JSON.stringify(n)).join(', ')}));`;
}

/** Computes a calculated field in the app (test mode). */
export function computeCalc(f: Field, get: (name: string) => number): number | null {
  if (!f.calc) return null;
  if (f.calc.op === 'formula') {
    try { return evalFormula(parseFormula(f.calc.formula ?? ''), get); } catch { return null; }
  }
  const v = (f.calc.fields ?? []).filter(Boolean).map(get);
  if (!v.length) return null;
  switch (f.calc.op) {
    case 'sum': return v.reduce((a, b) => a + b, 0);
    case 'product': return v.reduce((a, b) => a * b, 1);
    case 'average': return v.reduce((a, b) => a + b, 0) / v.length;
    case 'min': return Math.min(...v);
    case 'max': return Math.max(...v);
  }
}

/* ------------------------------------------------------------------ */
/* Conditional visibility                                              */
/* ------------------------------------------------------------------ */

/** Is a field visible given the current values? (check: true/false, radio/dropdown: selected value) */
export function conditionMet(f: Field, value: (name: string) => string | boolean | undefined): boolean {
  if (!f.showIf?.field) return true;
  const v = value(f.showIf.field);
  if (f.showIf.value === undefined || f.showIf.value === '') return v === true || (typeof v === 'string' && v !== '');
  return v === f.showIf.value;
}

/**
 * Scripts for controlling fields: controller name -> JavaScript that shows/hides its dependents.
 * Checkboxes and radio buttons react on mouse up (/U), dropdowns on validation (/V).
 */
export function conditionScripts(fields: Field[]): Map<string, { kind: Field['type']; js: string }> {
  const byController = new Map<string, Field[]>();
  for (const f of fields) if (f.showIf?.field) {
    const l = byController.get(f.showIf.field) ?? [];
    if (!l.some((x) => x.name === f.name)) l.push(f);
    byController.set(f.showIf.field, l);
  }
  const out = new Map<string, { kind: Field['type']; js: string }>();
  for (const [ctrl, deps] of byController) {
    const c = fields.find((x) => x.name === ctrl && (x.type === 'check' || x.type === 'radio' || x.type === 'dropdown'));
    if (!c) continue;
    const val = c.type === 'check' ? 'event.target.value' : c.type === 'radio' ? `this.getField(${JSON.stringify(ctrl)}).value` : 'event.value';
    const lines = deps.map((d) => {
      const cond = d.showIf!.value ? `v == ${JSON.stringify(d.showIf!.value)}` : c.type === 'check' ? 'v != "Off"' : 'v != "" && v != "Off"';
      return `this.getField(${JSON.stringify(d.name)}).display = (${cond}) ? display.visible : display.hidden;`;
    });
    out.set(ctrl, { kind: c.type, js: `var v = ${val};\n${lines.join('\n')}` });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

/** JavaScript of an email button: opens an email with the filled PDF attached. */
export function mailScript(to: string, subject: string): string {
  return `this.mailDoc({ bUI: true, cTo: ${JSON.stringify(to)}, cSubject: ${JSON.stringify(subject)} });`;
}
