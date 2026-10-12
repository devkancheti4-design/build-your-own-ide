// The Bits panel: one 64-bit value, decoded field by field, plus the real
// bytes read back out of WebAssembly memory. Click any bit to flip it in a
// "what if" copy and see what number those bits would mean.

import type { Engine } from "./engine.ts";
import type { Val } from "./types.ts";

const QNAN = 0x7ffc_0000_0000_0000n;
const SIGN = 1n << 63n;
const MANT = (1n << 52n) - 1n;

export interface BitsTarget {
  key: string;
  label: string;
  val: Val;
}

const hex = (b: bigint) => "0x" + b.toString(16).toUpperCase().padStart(16, "0");

export function bitsToNumber(bits: bigint): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, bits);
  return view.getFloat64(0);
}

export function numberToBits(n: number): bigint {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, n);
  return view.getBigUint64(0);
}

export function formatNumber(n: number): string {
  if (Number.isNaN(n)) return "NaN";
  if (!Number.isFinite(n)) return n > 0 ? "Infinity" : "-Infinity";
  if (Object.is(n, -0)) return "-0";
  const a = Math.abs(n);
  return a !== 0 && (a < 1e-6 || a >= 1e21) ? n.toExponential() : String(n);
}

/** The exact decimal value of a double: every double is a finite binary fraction. */
export function exactDecimal(bits: bigint): string {
  const negative = (bits & SIGN) !== 0n;
  const exp = Number((bits >> 52n) & 0x7ffn);
  const mant = bits & MANT;
  if (exp === 0x7ff) return mant ? "NaN" : negative ? "-Infinity" : "Infinity";
  // value = n × 2^e2, with n an integer
  const n = exp === 0 ? mant : mant | (1n << 52n);
  const e2 = exp === 0 ? -1074 : exp - 1075;
  if (n === 0n) return negative ? "-0" : "0";
  let text: string;
  if (e2 >= 0) {
    text = (n << BigInt(e2)).toString();
  } else {
    // n / 2^k = n × 5^k / 10^k
    const k = -e2;
    const digits = (n * 5n ** BigInt(k)).toString().padStart(k + 1, "0");
    const whole = digits.slice(0, digits.length - k);
    const frac = digits.slice(digits.length - k).replace(/0+$/, "");
    text = frac ? `${whole}.${frac}` : whole;
  }
  return (negative ? "-" : "") + text;
}

function neighbours(bits: bigint): { down: bigint | null; up: bigint | null } {
  const n = bitsToNumber(bits);
  if (Number.isNaN(n)) return { down: null, up: null };
  if (n === 0) return { down: SIGN | 1n, up: 1n };
  const toward0 = bits - 1n;
  const away = bits + 1n;
  const isNeg = (bits & SIGN) !== 0n;
  const ok = (b: bigint) => !Number.isNaN(bitsToNumber(b));
  const up = isNeg ? toward0 : away;
  const down = isNeg ? away : toward0;
  return { down: ok(down) ? down : null, up: ok(up) ? up : null };
}

/** What a 64-bit word means to Bitlens (see core/src/value.rs). */
export function describe(bits: bigint): string {
  if ((bits & QNAN) !== QNAN) return formatNumber(bitsToNumber(bits));
  if (bits & SIGN) return `reference to heap @${bits & 0xffff_ffffn}`;
  const tag = bits & 0xffff_ffffn;
  return tag === 1n ? "nil" : tag === 2n ? "false" : tag === 3n ? "true" : "unused NaN pattern";
}

export class BitsPanel {
  private target: BitsTarget | null = null;
  private whatIf: bigint | null = null;
  private host: HTMLElement;
  private engine: () => Engine | null;
  private onFollow: (heapAddr: number) => void;

  constructor(host: HTMLElement, engine: () => Engine | null, onFollow: (heapAddr: number) => void) {
    this.host = host;
    this.engine = engine;
    this.onFollow = onFollow;
    host.addEventListener("click", (e) => this.onClick(e));
  }

  show(target: BitsTarget | null) {
    if (target?.key !== this.target?.key || target?.val.bits !== this.target?.val.bits) this.whatIf = null;
    this.target = target;
    this.render();
  }

  private onClick(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!el || !this.target) return;
    const base = this.whatIf ?? BigInt("0x" + this.target.val.bits);
    const act = el.dataset.act!;
    if (act === "flip") this.whatIf = base ^ (1n << BigInt(el.dataset.bit!));
    else if (act === "reset") this.whatIf = null;
    else if (act === "set") this.whatIf = BigInt(el.dataset.bits!);
    else if (act === "follow") return this.onFollow(Number(el.dataset.addr));
    if (this.whatIf === BigInt("0x" + this.target.val.bits)) this.whatIf = null;
    this.render();
  }

  private render() {
    const t = this.target;
    if (!t) {
      this.host.innerHTML = `<div class="empty">Click any value on the stack, in Globals or in the Heap to see its 64 bits.</div>`;
      return;
    }
    const original = BigInt("0x" + t.val.bits);
    const bits = this.whatIf ?? original;
    const boxed = (bits & QNAN) === QNAN;
    const isNum = !boxed;

    const cells: string[] = [];
    for (let i = 63; i >= 0; i--) {
      const on = (bits >> BigInt(i)) & 1n;
      const changed = ((bits ^ original) >> BigInt(i)) & 1n;
      const field = isNum ? (i === 63 ? "f-sign" : i >= 52 ? "f-exp" : "f-mant") : i === 63 ? "f-sign" : i >= 50 ? "f-exp" : "f-mant";
      const gap = i === 63 || i === 52 ? " gap" : "";
      cells.push(
        `<button class="bit ${field}${gap}${changed ? " changed" : ""}" data-act="flip" data-bit="${i}" title="bit ${i}: click to flip" aria-label="bit ${i} is ${on}">${on}</button>`,
      );
    }
    const legend = isNum
      ? `<span class="k f-sign">sign · 1 bit</span><span class="k f-exp">exponent · 11 bits</span><span class="k f-mant">mantissa · 52 bits</span>`
      : `<span class="k f-sign">${bits & SIGN ? "pointer flag" : "sign 0"}</span><span class="k f-exp">quiet-NaN pattern · bits 62–50</span><span class="k f-mant">payload · bits 49–0</span>`;

    let decode = "";
    if (isNum) {
      const s = Number(bits >> 63n);
      const e = Number((bits >> 52n) & 0x7ffn);
      const m = bits & MANT;
      const mBits = m.toString(2).padStart(52, "0");
      const special = e === 0x7ff ? (m ? "all ones + nonzero mantissa: NaN" : "all ones + zero mantissa: Infinity") : e === 0 ? (m ? "all zeros: subnormal (no hidden 1, exponent −1022)" : "all zeros + zero mantissa: zero") : `${e} − 1023 = ${e - 1023}`;
      // Same mantissa bits with exponent 1023 (2^0): exactly 1.m.
      const significand = exactDecimal(m | (1023n << 52n));
      const nb = neighbours(bits);
      const value = bitsToNumber(bits);
      decode = `
        <table class="decode">
          <tr><th>sign</th><td><code>${s}</code></td><td>${s ? "negative (−)" : "positive (+)"}</td></tr>
          <tr><th>exponent</th><td><code>${((bits >> 52n) & 0x7ffn).toString(2).padStart(11, "0")}</code></td><td>= ${special}</td></tr>
          <tr><th>mantissa</th><td><code class="wrap">${mBits}</code></td><td>${e === 0 || e === 0x7ff ? "" : `significand 1.m = ${significand}`}</td></tr>
          <tr><th>shortest</th><td colspan="2"><b>${formatNumber(value)}</b> <span class="muted">(what print shows: the shortest decimal that rounds back to these bits)</span></td></tr>
          <tr><th>exact</th><td colspan="2"><code class="wrap exact">${exactDecimal(bits)}</code></td></tr>
        </table>
        <div class="nb">
          ${nb.down !== null ? `<button data-act="set" data-bits="${nb.down}">◀ next double down: ${formatNumber(bitsToNumber(nb.down))}</button>` : ""}
          ${nb.up !== null ? `<button data-act="set" data-bits="${nb.up}">next double up: ${formatNumber(bitsToNumber(nb.up))} ▶</button>` : ""}
        </div>
        ${nb.up !== null && Number.isFinite(value) ? `<div class="muted small">Gap to the next double (1 ulp): ${formatNumber(bitsToNumber(nb.up) - value)}. Nothing in between can be stored.</div>` : ""}`;
    } else {
      const ref = (bits & SIGN) !== 0n;
      const payload = bits & 0xffff_ffffn;
      decode = `<p>${
        ref
          ? `Bits 62–50 all set means <b>not a number</b>, so the machine reads this as a boxed value. The sign bit is 1, so it's a <b>pointer</b>: the low 32 bits are heap address <b>@${payload}</b>. <button class="link" data-act="follow" data-addr="${payload}">Show @${payload} in the heap →</button>`
          : `Bits 62–50 all set means <b>not a number</b>, so the low bits are a tag: <b>1 = nil, 2 = false, 3 = true</b>. This word has tag ${payload}, so it means <b>${describe(bits)}</b>.`
      }</p>`;
    }

    const engine = this.engine();
    let memory = "";
    if (engine && t.val.addr > 0 && t.val.addr + 8 <= engine.memorySize()) {
      const raw = engine.readBytes(t.val.addr, 8);
      const fromMemory = [...raw].reduceRight((acc, b) => (acc << 8n) | BigInt(b), 0n);
      const matches = fromMemory === original;
      memory = `
        <h4>In memory</h4>
        <p class="muted small">Read just now from WebAssembly linear memory at address <code>0x${t.val.addr.toString(16).padStart(8, "0")}</code>. The lowest byte comes first: that's little-endian order.</p>
        <div class="bytes">${[...raw].map((b, i) => `<span class="byte" title="address 0x${(t.val.addr + i).toString(16)}">${b.toString(16).padStart(2, "0")}</span>`).join("")}</div>
        ${matches ? "" : `<p class="muted small">These bytes have changed since this value was captured.</p>`}`;
    }

    this.host.innerHTML = `
      <div class="bits-head">
        <div><span class="muted">${t.label}</span> <b class="mono">${escapeHtml(t.val.text)}</b> <span class="chip">${t.val.kind}</span></div>
        <code class="mono">${hex(bits)}</code>
      </div>
      ${this.whatIf !== null ? `<div class="whatif">What if: you flipped ${popcount(bits ^ original)} bit(s). These bits would mean <b>${escapeHtml(describe(bits))}</b>. <button data-act="reset">Reset</button></div>` : ""}
      <div class="bitgrid" role="group" aria-label="64 bits, most significant first">${cells.join("")}</div>
      <div class="bit-legend">${legend}</div>
      ${decode}
      ${memory}`;
  }
}

function popcount(b: bigint): number {
  let n = 0;
  for (; b; b >>= 1n) n += Number(b & 1n);
  return n;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
