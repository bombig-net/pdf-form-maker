/**
 * Minimal, robust tokenizer for PDF content streams.
 * Yields operators with their operands and byte offsets (for later rewriting).
 */

export type CSName = { t: 'name'; v: string };
export type CSStr = { t: 'str'; v: Uint8Array };
export type CSDict = { t: 'dict'; v: Record<string, CSObj> };
export type CSObj = number | boolean | null | CSName | CSStr | CSDict | CSObj[];

export interface CSOp {
  op: string;
  args: CSObj[];
  /** Offset of the first operand (or of the operator if it has no operands) */
  start: number;
  /** Offset right after the operator */
  end: number;
}

const WS = new Uint8Array(256);
[0, 9, 10, 12, 13, 32].forEach((c) => (WS[c] = 1));
const DELIM = new Uint8Array(256);
'()<>[]{}/%'.split('').forEach((c) => (DELIM[c.charCodeAt(0)] = 1));

const isName = (o: CSObj, v?: string): o is CSName =>
  typeof o === 'object' && o !== null && !Array.isArray(o) && (o as CSName).t === 'name' && (v === undefined || (o as CSName).v === v);
export { isName };

export function* tokenizeOps(buf: Uint8Array): Generator<CSOp> {
  const n = buf.length;
  let i = 0;
  // Operand stack with container stack
  let stack: CSObj[] = [];
  const containers: { kind: 'arr' | 'dict'; items: CSObj[] }[] = [];
  let opStart = -1;

  const push = (o: CSObj, at: number) => {
    if (containers.length) containers[containers.length - 1].items.push(o);
    else {
      if (opStart < 0) opStart = at;
      stack.push(o);
    }
  };

  while (i < n) {
    const c = buf[i];
    if (WS[c]) { i++; continue; }
    if (c === 37 /* % */) { while (i < n && buf[i] !== 10 && buf[i] !== 13) i++; continue; }
    const tokStart = i;
    if (c === 47 /* / */) {
      i++;
      let s = '';
      while (i < n && !WS[buf[i]] && !DELIM[buf[i]]) {
        if (buf[i] === 35 /* # */ && i + 2 < n) {
          const h = parseInt(String.fromCharCode(buf[i + 1], buf[i + 2]), 16);
          if (!isNaN(h)) { s += String.fromCharCode(h); i += 3; continue; }
        }
        s += String.fromCharCode(buf[i]); i++;
      }
      push({ t: 'name', v: s }, tokStart);
      continue;
    }
    if (c === 40 /* ( */) {
      i++;
      let depth = 1;
      const out: number[] = [];
      while (i < n) {
        const ch = buf[i];
        if (ch === 92 /* \ */) {
          const nx = buf[i + 1];
          i += 2;
          switch (nx) {
            case 110: out.push(10); break; // n
            case 114: out.push(13); break; // r
            case 116: out.push(9); break; // t
            case 98: out.push(8); break; // b
            case 102: out.push(12); break; // f
            case 13: if (buf[i] === 10) i++; break; // line continuation
            case 10: break;
            default:
              if (nx >= 48 && nx <= 55) {
                let v = nx - 48; let k = 0;
                while (k < 2 && buf[i] >= 48 && buf[i] <= 55) { v = v * 8 + (buf[i] - 48); i++; k++; }
                out.push(v & 255);
              } else if (nx !== undefined) out.push(nx);
          }
          continue;
        }
        if (ch === 40) depth++;
        else if (ch === 41) { depth--; if (depth === 0) { i++; break; } }
        out.push(ch); i++;
      }
      push({ t: 'str', v: Uint8Array.from(out) }, tokStart);
      continue;
    }
    if (c === 60 /* < */) {
      if (buf[i + 1] === 60) {
        i += 2;
        if (!containers.length && opStart < 0) opStart = tokStart;
        containers.push({ kind: 'dict', items: [] });
        continue;
      }
      i++;
      let hex = '';
      while (i < n && buf[i] !== 62) { if (!WS[buf[i]]) hex += String.fromCharCode(buf[i]); i++; }
      i++;
      if (hex.length % 2) hex += '0';
      const out = new Uint8Array(hex.length / 2);
      for (let k = 0; k < out.length; k++) out[k] = parseInt(hex.substr(k * 2, 2), 16) || 0;
      push({ t: 'str', v: out }, tokStart);
      continue;
    }
    if (c === 62 /* > */) {
      i += buf[i + 1] === 62 ? 2 : 1;
      const cont = containers.pop();
      if (cont && cont.kind === 'dict') {
        const d: Record<string, CSObj> = {};
        for (let k = 0; k + 1 < cont.items.length; k += 2) {
          const key = cont.items[k];
          if (isName(key)) d[key.v] = cont.items[k + 1];
        }
        push({ t: 'dict', v: d }, tokStart);
      }
      continue;
    }
    if (c === 91 /* [ */) {
      i++;
      if (!containers.length && opStart < 0) opStart = tokStart;
      containers.push({ kind: 'arr', items: [] });
      continue;
    }
    if (c === 93 /* ] */) {
      i++;
      const cont = containers.pop();
      if (cont) push(cont.items, tokStart);
      continue;
    }
    if (c === 123 || c === 125 || c === 41) { i++; continue; }

    // Number or keyword
    let s = '';
    while (i < n && !WS[buf[i]] && !DELIM[buf[i]]) { s += String.fromCharCode(buf[i]); i++; }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) { push(parseFloat(s), tokStart); continue; }
    if (s === 'true' || s === 'false') { push(s === 'true', tokStart); continue; }
    if (s === 'null') { push(null, tokStart); continue; }
    if (containers.length) continue; // unexpected – ignore

    if (s === 'BI') {
      // Skip inline image: up to "ID", then up to "EI" (surrounded by whitespace)
      const start = opStart >= 0 ? opStart : tokStart;
      const idPos = findKeyword(buf, i, 'ID');
      let j = idPos < 0 ? n : idPos + 3;
      while (j < n) {
        if (buf[j] === 69 && buf[j + 1] === 73 && WS[buf[j - 1]] && (j + 2 >= n || WS[buf[j + 2]] || DELIM[buf[j + 2]])) { j += 2; break; }
        j++;
      }
      i = j;
      yield { op: 'BI', args: [], start, end: i };
      stack = []; opStart = -1;
      continue;
    }
    yield { op: s, args: stack, start: opStart >= 0 ? opStart : tokStart, end: i };
    stack = []; opStart = -1;
  }
}

function findKeyword(buf: Uint8Array, from: number, kw: string): number {
  const a = kw.charCodeAt(0), b = kw.charCodeAt(1);
  for (let j = from; j < buf.length - 1; j++) {
    if (buf[j] === a && buf[j + 1] === b && (j === 0 || WS[buf[j - 1]]) && (j + 2 >= buf.length || WS[buf[j + 2]])) return j;
  }
  return -1;
}

export function latin1(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}
