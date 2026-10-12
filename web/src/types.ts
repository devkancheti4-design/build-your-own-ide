// The JSON shapes produced by core/src/inspect.rs.

export type Kind = "num" | "nil" | "bool" | "str" | "array" | "ref";

/** One 64-bit machine value. `bits` is hex because JSON numbers can't hold 64 bits exactly. */
export interface Val {
  bits: string;
  kind: Kind;
  /** Real address of these 8 bytes in WebAssembly memory. */
  addr: number;
  text: string;
  /** Heap address, for references. */
  ref?: number;
}

export interface StackSlot extends Val {
  frame: number;
  name: string | null;
}

export interface GlobalVal extends Val {
  name: string;
}

export interface HeapObj {
  addr: number;
  type: "str" | "array";
  len: number;
  text?: string;
  bytes?: number[];
  items?: Val[];
}

export interface Frame {
  name: string;
  base: number;
  ip: number;
  ret: number;
}

export type Span = [number, number];

export type Status = "ready" | "paused" | "breakpoint" | "halted" | "error";

export interface State {
  status: Status;
  ip: number;
  steps: number;
  line: number;
  span: Span;
  error: { msg: string; span: Span } | null;
  explain: string;
  frames: Frame[];
  stack: StackSlot[];
  globals: GlobalVal[];
  heap: HeapObj[];
  heapTotal: number;
  chartsVersion: number;
  output: string;
}

export interface Instr {
  ip: number;
  bytes: number[];
  text: string;
  span: Span;
  line: number;
}

export interface Program {
  ok: true;
  instrs: Instr[];
  functions: { name: string; entry: number; arity: number }[];
  constants: { text: string; bits: string | null }[];
  codeSize: number;
}

export interface CompileFailure {
  ok: false;
  error: { msg: string; span: Span };
}

export type CompileResult = Program | CompileFailure;

export interface Chart {
  name: string;
  kind: "line" | "scatter" | "heatmap";
  /** `[x, y, group]`; `null` stands in for Infinity or NaN. */
  points: [number | null, number | null, number | null][];
  series: string[];
  matrix: (number | null)[][];
}

/** `[cssClass, start, end]` for syntax highlighting. */
export type TokenTuple = [string, number, number];
