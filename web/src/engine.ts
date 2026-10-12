// The bridge between JavaScript and the Rust core compiled to WebAssembly.
//
// A WebAssembly function only takes and returns numbers. Strings travel
// through the module's linear memory: to send one, we ask Rust for a buffer
// (`alloc`), copy UTF-8 bytes into it and pass (pointer, length). To receive
// one, Rust leaves JSON in a buffer and tells us where (`out_ptr`, `out_len`).

import type { Chart, CompileResult, State, TokenTuple } from "./types.ts";

interface Exports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  out_ptr(): number;
  out_len(): number;
  tokenize(ptr: number, len: number): void;
  compile(ptr: number, len: number): number;
  reset(): void;
  run(max: number): number;
  step(): number;
  step_line(max: number): number;
  set_breakpoints(ptr: number, len: number): void;
  state(): void;
  charts(): void;
}

export interface Engine {
  tokenize(src: string): TokenTuple[];
  compile(src: string): CompileResult;
  reset(): void;
  /** Run up to `max` instructions, stopping at breakpoints. */
  run(max: number): void;
  step(): void;
  stepLine(max?: number): void;
  setBreakpoints(lines: Iterable<number>): void;
  state(): State | null;
  charts(): Chart[];
  /** Read raw bytes straight out of WebAssembly memory. */
  readBytes(addr: number, count: number): Uint8Array;
  /** Total size of WebAssembly memory in bytes. */
  memorySize(): number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function loadEngine(wasm: BufferSource | Response | Promise<Response>): Promise<Engine> {
  const { instance } =
    wasm instanceof Response || wasm instanceof Promise
      ? await WebAssembly.instantiateStreaming(wasm, {})
      : await WebAssembly.instantiate(wasm, {});
  const ex = instance.exports as unknown as Exports;

  // Always build a fresh view: when memory grows, old views are detached.
  const bytes = () => new Uint8Array(ex.memory.buffer);

  /** Copy a string into wasm memory; Rust takes ownership of the buffer. */
  function send(text: string, fn: (ptr: number, len: number) => number | void): number | void {
    const data = encoder.encode(text);
    const ptr = ex.alloc(data.length);
    bytes().set(data, ptr);
    return fn(ptr, data.length);
  }

  function receive<T>(): T {
    const ptr = ex.out_ptr();
    const len = ex.out_len();
    return JSON.parse(decoder.decode(bytes().subarray(ptr, ptr + len))) as T;
  }

  return {
    tokenize(src) {
      send(src, ex.tokenize);
      return receive<TokenTuple[]>();
    },
    compile(src) {
      send(src, ex.compile);
      return receive<CompileResult>();
    },
    reset: () => ex.reset(),
    run: (max) => void ex.run(max),
    step: () => void ex.step(),
    stepLine: (max = 1_000_000) => void ex.step_line(max),
    setBreakpoints(lines) {
      send([...lines].join(","), ex.set_breakpoints);
    },
    state() {
      ex.state();
      return receive<State | null>();
    },
    charts() {
      ex.charts();
      return receive<Chart[]>();
    },
    readBytes(addr, count) {
      return bytes().slice(addr, addr + count);
    },
    memorySize: () => ex.memory.buffer.byteLength,
  };
}
