// Panels that show the machine itself: bytecode, stack frames, globals,
// heap and program output. Every value is clickable and opens in Bits.

import type { BitsTarget } from "./bits.ts";
import type { Program, Span, State, Val } from "./types.ts";

export interface MachineElements {
  bytecode: HTMLElement;
  stack: HTMLElement;
  globals: HTMLElement;
  heap: HTMLElement;
  output: HTMLElement;
}

export interface MachineHandlers {
  onSelect(target: BitsTarget): void;
  onHoverSource(span: Span | null): void;
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const hex2 = (b: number) => b.toString(16).padStart(2, "0");

/** Find the value a selection key points at in a (possibly newer) state. */
export function resolveValue(key: string, state: State | null): BitsTarget | null {
  if (!state) return null;
  const [kind, a, b] = key.split(":");
  if (kind === "stack") {
    const slot = state.stack[Number(a)];
    return slot ? { key, label: `stack[${a}]${slot.name ? " " + slot.name : ""}`, val: slot } : null;
  }
  if (kind === "global") {
    const g = state.globals.find((x) => x.name === a);
    return g ? { key, label: `global ${a}`, val: g } : null;
  }
  if (kind === "heap") {
    const item = state.heap.find((o) => o.addr === Number(a))?.items?.[Number(b)];
    return item ? { key, label: `@${a}[${b}]`, val: item } : null;
  }
  return null;
}

export class MachineView {
  private program: Program | null = null;
  private prevBits = new Map<string, string>();
  private lastOutput = "";
  selected: string | null = null;
  private el: MachineElements;
  private handlers: MachineHandlers;

  constructor(el: MachineElements, handlers: MachineHandlers) {
    this.el = el;
    this.handlers = handlers;
    for (const host of [el.stack, el.globals, el.heap]) {
      host.addEventListener("click", (e) => {
        const key = (e.target as HTMLElement).closest<HTMLElement>("[data-key]")?.dataset.key;
        if (key) this.select(key);
      });
    }
    el.bytecode.addEventListener("mouseover", (e) => {
      const ip = (e.target as HTMLElement).closest<HTMLElement>("[data-ip]")?.dataset.ip;
      const instr = ip ? this.program?.instrs.find((i) => i.ip === Number(ip)) : null;
      this.handlers.onHoverSource(instr ? instr.span : null);
    });
    el.bytecode.addEventListener("mouseleave", () => this.handlers.onHoverSource(null));
  }

  private state: State | null = null;

  select(key: string) {
    this.selected = key;
    const target = resolveValue(key, this.state);
    if (target) this.handlers.onSelect(target);
    for (const n of document.querySelectorAll(".sel")) n.classList.remove("sel");
    for (const n of document.querySelectorAll(`[data-key="${CSS.escape(key)}"]`)) n.classList.add("sel");
  }

  setProgram(program: Program | null) {
    this.program = program;
    this.prevBits.clear();
    if (!program) {
      this.el.bytecode.innerHTML = `<div class="empty">Fix the error in the code to see its bytecode.</div>`;
      return;
    }
    const entries = new Map(program.functions.map((f) => [f.entry, f]));
    this.el.bytecode.innerHTML =
      `<div class="bc-meta">${program.codeSize} bytes of bytecode · ${program.constants.length} constants</div>` +
      program.instrs
        .map((ins) => {
          const fn = entries.get(ins.ip);
          const label = fn && (ins.ip > 0 || fn.name === "<main>") ? `<div class="fnlabel">${fn.name === "<main>" ? "&lt;main&gt;" : `fn ${escapeHtml(fn.name)}/${fn.arity}`}</div>` : "";
          const [op, ...rest] = ins.text.split(" ");
          return `${label}<div class="ins" data-ip="${ins.ip}" data-ins="instr:${ins.ip}"><span class="ip">${String(ins.ip).padStart(4, "0")}</span><span class="hexb">${ins.bytes.map(hex2).join(" ")}</span><span class="txt"><b>${op}</b> ${escapeHtml(rest.join(" "))}</span></div>`;
        })
        .join("");
  }

  update(state: State | null) {
    this.state = state;
    if (!state) {
      for (const host of [this.el.stack, this.el.globals, this.el.heap]) host.innerHTML = "";
      this.el.output.textContent = "";
      return;
    }
    this.renderBytecodeCursor(state);
    this.renderStack(state);
    this.renderGlobals(state);
    this.renderHeap(state);
    if (state.output !== this.lastOutput) {
      this.el.output.textContent = state.output || "";
      this.el.output.scrollTop = this.el.output.scrollHeight;
      this.lastOutput = state.output;
    }
    const next = new Map<string, string>();
    state.stack.forEach((s, i) => next.set(`stack:${i}`, s.bits));
    state.globals.forEach((g) => next.set(`global:${g.name}`, g.bits));
    this.prevBits = next;
    if (this.selected) this.select(this.selected);
  }

  private changed(key: string, bits: string) {
    const before = this.prevBits.get(key);
    return before !== undefined && before !== bits ? " changed" : before === undefined && this.prevBits.size ? " changed" : "";
  }

  private valueRow(key: string, idx: string, name: string, v: Val, extra = "") {
    return `<div class="slot${this.changed(key, v.bits)}${this.selected === key ? " sel" : ""}" data-key="${key}" data-ins="${key}" title="Click to see the bits">
      <span class="idx">${idx}</span><span class="name">${name}</span><span class="val k-${v.kind}">${escapeHtml(v.text)}</span><span class="hexs">${v.bits}</span>${extra}</div>`;
  }

  private renderBytecodeCursor(state: State) {
    for (const n of this.el.bytecode.querySelectorAll(".cur")) n.classList.remove("cur");
    const row = this.el.bytecode.querySelector<HTMLElement>(`[data-ip="${state.ip}"]`);
    if (!row || state.status === "ready") return;
    row.classList.add("cur");
    const box = this.el.bytecode.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    if (r.top < box.top + 24 || r.bottom > box.bottom - 8) this.el.bytecode.scrollTop += r.top - box.top - box.height / 3;
  }

  private renderStack(state: State) {
    if (state.stack.length === 0 && state.frames.length <= 1) {
      this.el.stack.innerHTML = `<div class="empty">The stack is empty. Values appear here as instructions push them.</div>`;
      return;
    }
    let html = "";
    // Newest frame first, top of the stack at the top.
    for (let f = state.frames.length - 1; f >= 0; f--) {
      const frame = state.frames[f];
      const end = f + 1 < state.frames.length ? state.frames[f + 1].base : state.stack.length;
      const name = frame.name === "<main>" ? "&lt;main&gt;" : `fn ${escapeHtml(frame.name)}`;
      const ret = f === 0 ? "" : ` · returns to ${String(frame.ret).padStart(4, "0")}`;
      html += `<div class="frame${f === state.frames.length - 1 ? " top" : ""}"><div class="frame-head" data-ins="frame:${f}">${name} <span class="muted">frame ${f} · base ${frame.base}${ret}</span></div>`;
      for (let i = end - 1; i >= frame.base; i--) {
        const s = state.stack[i];
        const name = s.name ? `<b>${escapeHtml(s.name)}</b>` : `<span class="muted">temp</span>`;
        html += this.valueRow(`stack:${i}`, String(i), name, s, i === state.stack.length - 1 ? `<span class="top-tag">top</span>` : "");
      }
      if (end === frame.base) html += `<div class="muted small pad">no values yet</div>`;
      html += `</div>`;
    }
    this.el.stack.innerHTML = html;
  }

  private renderGlobals(state: State) {
    this.el.globals.innerHTML = state.globals.length
      ? state.globals.map((g, i) => this.valueRow(`global:${g.name}`, String(i), `<b>${escapeHtml(g.name)}</b>`, g)).join("")
      : `<div class="empty">This program has no global variables.</div>`;
  }

  private renderHeap(state: State) {
    if (state.heap.length === 0) {
      this.el.heap.innerHTML = `<div class="empty">The heap is empty. Arrays and strings are allocated here.</div>`;
      return;
    }
    const more = state.heapTotal > state.heap.length ? `<div class="muted small pad">Showing the first ${state.heap.length} of ${state.heapTotal} objects. Nothing is ever freed: there's no garbage collector.</div>` : "";
    this.el.heap.innerHTML =
      state.heap
        .map((o) => {
          if (o.type === "str") {
            return `<div class="obj" id="heap-${o.addr}" data-ins="heapobj:${o.addr}"><div class="obj-head"><b>@${o.addr}</b> string · ${o.len} chars</div><div class="mono">${escapeHtml(o.text ?? "")}</div><div class="bytes small">${(o.bytes ?? []).map((b) => `<span class="byte" title="${b < 128 ? JSON.stringify(String.fromCharCode(b)) : "UTF-8 byte"}">${hex2(b)}</span>`).join("")}</div></div>`;
          }
          const items = (o.items ?? [])
            .map((v, j) => {
              const key = `heap:${o.addr}:${j}`;
              return `<button class="item k-${v.kind}${this.selected === key ? " sel" : ""}" data-key="${key}" data-ins="${key}"><span class="muted">${j}</span> ${escapeHtml(v.text)}</button>`;
            })
            .join("");
          const cut = o.len > (o.items?.length ?? 0) ? `<span class="muted small">… ${o.len - (o.items?.length ?? 0)} more</span>` : "";
          return `<div class="obj" id="heap-${o.addr}" data-ins="heapobj:${o.addr}"><div class="obj-head"><b>@${o.addr}</b> array · ${o.len} element${o.len === 1 ? "" : "s"}</div><div class="items">${items}${cut}</div></div>`;
        })
        .join("") + more;
  }

  flashHeap(addr: number) {
    const el = this.el.heap.querySelector<HTMLElement>(`#heap-${addr}`);
    if (!el) return;
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  }
}
