// Bitlens: wires the engine (Rust → WebAssembly) to the editor, the machine
// panels, the lessons and the game.

import "katex/dist/katex.min.css";
import "./style.css";

import { BitsPanel, describe as describeBits } from "./bits.ts";
import { checkChallenge } from "./challenge.ts";
import { Charts } from "./charts.ts";
import { ChatPanel } from "./chat.ts";
import { Editor } from "./editor.ts";
import { loadEngine, type Engine } from "./engine.ts";
import { XP_CHALLENGE, XP_PREDICT, loadProgress, makeQuiz, rank, saveProgress, type Quiz } from "./game.ts";
import { OPCODES, TERMS } from "./glossary.ts";
import { Inspector } from "./inspect.ts";
import { renderLesson } from "./lesson.ts";
import { LEVELS, REGIONS, applySolution, type Level } from "./levels.ts";
import { MachineView, resolveValue } from "./machine.ts";
import { Palette, type SearchItem } from "./search.ts";
import type { Program, Span, State, Val } from "./types.ts";

const SOURCES = Object.fromEntries(
  Object.entries(import.meta.glob("../../examples/*.bl", { query: "?raw", import: "default", eager: true }) as Record<string, string>).map(
    ([path, text]) => [path.split("/").pop()!, text],
  ),
);

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const pad4 = (n: number) => String(n).padStart(4, "0");

// Delay between animated steps, in milliseconds. The last setting runs flat out.
const SPEEDS = [700, 300, 100, 25, 0];
const FULL_SPEED_CHUNK = 50_000;

const progress = loadProgress();
let engine: Engine | null = null;
let level: Level = LEVELS[0];
let program: Program | null = null;
let state: State | null = null;
let running = false;
let quiz: { quiz: Quiz; after: State } | null = null;
let chartsVersion = -1;
let compileTimer = 0;
const breakpoints = new Map<number, Set<number>>();

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

const editor = new Editor($("#editor-host"), {
  tokenize: (src) => engine?.tokenize(src) ?? [],
  onChange(src) {
    progress.code[level.id] = src;
    saveProgress(progress);
    clearTimeout(compileTimer);
    compileTimer = window.setTimeout(compile, 250);
  },
  onToggleBreakpoint(line) {
    const set = bps();
    if (set.has(line)) set.delete(line);
    else set.add(line);
    engine?.setBreakpoints(set);
    editor.setBreakpoints(set);
  },
});

const bits = new BitsPanel($("#bits"), () => engine, (addr) => {
  showTab("machine", "heap");
  machine.flashHeap(addr);
});

const machine = new MachineView(
  { bytecode: $("#bytecode"), stack: $("#stack"), globals: $("#globals"), heap: $("#heap"), output: $("#output") },
  {
    onSelect(target) {
      bits.show(target);
      if (!quiz) showTab("visual", "bits");
    },
    onHoverSource: (span) => editor.setHover(span),
  },
);

const charts = new Charts($("#charts"));
const chat = new ChatPanel($("#chat"), { context: buildContext });

const inspector = new Inspector({
  keyAt(e) {
    const target = e.target as HTMLElement;
    if (target.closest(".inspect-card")) return null;
    if (target.matches("#editor-host textarea")) {
      const offset = editor.offsetAt(e.clientX, e.clientY);
      return offset === null ? null : { key: `src:${offset}`, el: target };
    }
    const el = target.closest<HTMLElement>("[data-ins]");
    return el ? { key: el.dataset.ins!, el } : null;
  },
  describe: describeKey,
  onToggle(active) {
    $("#inspect-btn").classList.toggle("on", active);
    $("#inspect-btn").setAttribute("aria-pressed", String(active));
    if (active) toast("Inspect mode: hover anything to see what's underneath. Click to pin, Esc to leave.");
  },
});

const palette = new Palette({ items: searchItems, extras: webSearchItems });

function bps(): Set<number> {
  if (!breakpoints.has(level.id)) breakpoints.set(level.id, new Set());
  return breakpoints.get(level.id)!;
}

function showTab(group: string, name: string) {
  for (const tab of document.querySelectorAll<HTMLElement>(`[data-tabs="${group}"] [data-tab]`)) {
    const on = tab.dataset.tab === name;
    tab.classList.toggle("on", on);
    tab.setAttribute("aria-selected", String(on));
    document.getElementById(tab.dataset.tab!)!.hidden = !on;
  }
}

function toast(text: string, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = text;
  $("#toasts").appendChild(el);
  setTimeout(() => el.classList.add("out"), 2600);
  setTimeout(() => el.remove(), 3200);
}

function renderXp() {
  const r = rank(progress.xp);
  const pct = r.next ? Math.round(((progress.xp - r.floor) / (r.next - r.floor)) * 100) : 100;
  $("#xp").innerHTML = `<span class="rank">${r.name}</span><span class="xpbar" title="${progress.xp} XP${r.next ? `, next rank at ${r.next}` : ""}"><i style="width:${pct}%"></i></span><span class="xpnum">${progress.xp} XP</span>`;
}

function award(xp: number, why: string) {
  const before = rank(progress.xp).name;
  progress.xp += xp;
  saveProgress(progress);
  renderXp();
  toast(`+${xp} XP · ${why}`, "good");
  const after = rank(progress.xp).name;
  if (after !== before) setTimeout(() => toast(`New rank: ${after}!`, "good"), 600);
}

// ---------------------------------------------------------------------------
// The journey map
// ---------------------------------------------------------------------------

function nextLevel(): Level {
  return LEVELS.find((l) => !progress.done.includes(l.id)) ?? LEVELS[LEVELS.length - 1];
}

function renderMap() {
  const next = nextLevel();
  const r = rank(progress.xp);
  $("#map-stats").innerHTML = `
    <div class="stat"><b>${r.name}</b><span>rank · ${progress.xp} XP</span></div>
    <div class="stat"><b>${progress.done.length}/${LEVELS.length}</b><span>challenges</span></div>
    <div class="stat"><b>${progress.predict.right}/${progress.predict.total}</b><span>predictions · best streak ${progress.predict.best}</span></div>`;
  $<HTMLAnchorElement>("#continue").href = `#/level/${next.id}`;
  $("#continue").textContent = progress.visited.length ? `Continue: Level ${next.id} · ${next.title}` : "Start the journey";
  $("#journey").innerHTML = REGIONS.map((region) => {
      const cards = LEVELS.filter((l) => l.region === region.id)
        .map((l) => {
          const done = progress.done.includes(l.id);
          const paper = l.papers[0]?.cite.match(/^(.*?)\((\d{4})/);
          const tag = paper ? `${paper[1].split(",")[0].replace(/^[A-Z]\.( [A-Z]\.)*-?[A-Z]?\.? ?/, "").trim()} ${paper[2]}` : "";
          return `<a class="level-card${done ? " done" : ""}${l.id === next.id ? " next" : ""}" href="#/level/${l.id}">
            <span class="num">${done ? "✓" : l.id}</span>
            <span class="body"><b>${l.title}</b><span>${l.tagline}</span>${tag ? `<span class="paper-tag">${escapeHtml(tag)}</span>` : ""}</span>
          </a>`;
        })
        .join("");
      return `<section class="region"><header><h2>${region.name}</h2><p>${region.blurb}</p></header><div class="cards">${cards}</div></section>`;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// The lab
// ---------------------------------------------------------------------------

function openLevel(id: number) {
  stop();
  quiz = null;
  level = LEVELS.find((l) => l.id === id) ?? LEVELS[0];
  if (!progress.visited.includes(level.id)) {
    progress.visited.push(level.id);
    saveProgress(progress);
  }
  document.title = `${level.title} · Bitlens`;
  $("#lesson").innerHTML = renderLesson(level, progress.done.includes(level.id));
  $("#lesson").scrollTop = 0;
  $("#file-name").textContent = `examples/${level.file}`;
  machine.selected = null;
  bits.show(null);
  chartsVersion = -1;
  editor.setBreakpoints(bps());
  editor.value = progress.code[level.id] ?? SOURCES[level.file] ?? "";
  showTab("visual", "bits");
  compile();
}

function compile() {
  if (!engine) return;
  stop();
  quiz = null;
  const result = engine.compile(editor.value);
  if (result.ok) {
    program = result;
    engine.setBreakpoints(bps());
    editor.setError(null);
    machine.setProgram(result);
    $("#compile-status").className = "compile-status ok";
    $("#compile-status").textContent = `Compiled: ${result.codeSize} bytes of bytecode, ${result.instrs.length} instructions.`;
  } else {
    program = null;
    machine.setProgram(null);
    const line = editor.value.slice(0, result.error.span[0]).split("\n").length;
    $("#compile-status").className = "compile-status bad";
    $("#compile-status").textContent = `Line ${line}: ${result.error.msg}`;
  }
  refresh();
  if (!result.ok) editor.setError(result.error.span);
}

function refresh() {
  state = engine && program ? engine.state() : null;
  machine.update(state);
  const s = state;
  if (!s) {
    editor.setExec(null);
    $("#explain").innerHTML = `<div class="empty">Fix the compile error to run the program.</div>`;
    $("#status").textContent = "compile error";
    updateButtons();
    return;
  }
  const finished = s.status === "halted" || s.status === "error";
  editor.setExec(finished ? null : s.span, finished ? 0 : s.line);
  if (s.status === "error" && s.error) editor.setError(s.error.span);
  else if (program) editor.setError(null);

  if (s.chartsVersion !== chartsVersion && engine) {
    const hadCharts = charts.count > 0;
    chartsVersion = s.chartsVersion;
    charts.update(engine.charts());
    if (!hadCharts && charts.count > 0 && !machine.selected) showTab("visual", "charts");
  }
  if (!quiz) renderExplain(s);
  const label: Record<string, string> = { ready: "ready", paused: "paused", breakpoint: "breakpoint", halted: "finished", error: "runtime error" };
  $("#status").innerHTML = `<b>${running ? "running" : label[s.status]}</b> · ${s.steps.toLocaleString()} steps${finished ? "" : ` · line ${s.line}`}`;
  updateButtons();
}

function renderExplain(s: State) {
  const ins = program?.instrs.find((i) => i.ip === s.ip);
  const head = ins && s.status !== "halted" && s.status !== "error"
    ? `<div class="next-ins"><span class="muted small">Next instruction</span><div><code>${pad4(ins.ip)}</code> <code class="hexb">${ins.bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ")}</code> <b>${escapeHtml(ins.text)}</b></div></div>`
    : "";
  const error = s.status === "error" && s.error ? `<p class="error-text">${escapeHtml(s.error.msg)}</p>` : "";
  $("#explain").innerHTML = `${head}${error}<p class="explain-text">${escapeHtml(s.explain)}</p>
    ${s.status === "ready" ? `<p class="muted small">Press <b>Step</b> to run one instruction, <b>Step line</b> to run one line, or <b>Run</b>. Turn on <b>Predict</b> to guess each result first.</p>` : ""}`;
}

function updateButtons() {
  const finished = !state || state.status === "halted" || state.status === "error";
  $<HTMLButtonElement>("#run-btn").textContent = running ? "Pause" : finished && state ? "Run again" : "Run";
  $("#run-btn").classList.toggle("running", running);
  for (const id of ["#step-btn", "#line-btn"]) $<HTMLButtonElement>(id).disabled = finished || running || !!quiz;
  $<HTMLButtonElement>("#run-btn").disabled = !state || !!quiz;
  $<HTMLButtonElement>("#reset-btn").disabled = !state || running;
}

function stop() {
  running = false;
}

function run() {
  if (!engine || !state || quiz) return;
  if (running) {
    stop();
    refresh();
    return;
  }
  if (state.status === "halted" || state.status === "error") {
    engine.reset();
    chartsVersion = -1;
  }
  running = true;
  loop();
}

function loop() {
  if (!running || !engine) return;
  const delay = SPEEDS[Number($<HTMLInputElement>("#speed").value)];
  if (delay === 0) {
    // Run as much as fits in ~12 ms, then let the browser paint one frame.
    const start = performance.now();
    do {
      engine.run(FULL_SPEED_CHUNK);
      state = engine.state();
    } while (state?.status === "paused" && performance.now() - start < (document.hidden ? 200 : 12));
  } else {
    const before = state?.line ?? 0;
    engine.step();
    const after = engine.state();
    // Animated runs stop at breakpoints too.
    if (after && after.line !== before && bps().has(after.line) && after.status === "paused") running = false;
  }
  refresh();
  if (!state || state.status === "halted" || state.status === "error" || state.status === "breakpoint") running = false;
  if (state?.status === "halted") celebrateRun();
  if (!running) {
    refresh();
    return;
  }
  // Hidden pages get no animation frames, so keep going on a timer instead.
  if (delay === 0 && !document.hidden) requestAnimationFrame(loop);
  else setTimeout(loop, delay);
}

function celebrateRun() {
  $("#output").classList.remove("flash");
  void $("#output").offsetWidth;
  $("#output").classList.add("flash");
}

function step() {
  if (!engine || !state || running || quiz) return;
  const before = state;
  const ins = program?.instrs.find((i) => i.ip === before.ip);
  engine.step();
  const after = engine.state();
  const q = $<HTMLInputElement>("#predict").checked && ins && after ? makeQuiz(before, after, ins) : null;
  if (q && after) {
    quiz = { quiz: q, after };
    renderQuiz();
    updateButtons();
    return;
  }
  refresh();
}

function renderQuiz() {
  if (!quiz) return;
  const { quiz: q } = quiz;
  $("#explain").innerHTML = `
    <div class="quiz">
      <div class="muted small">Predict · streak ${progress.predict.streak}</div>
      <p><b>${escapeHtml(q.question)}</b></p>
      <div class="options">${q.options.map((o, i) => `<button data-opt="${i}"><kbd>${i + 1}</kbd> ${escapeHtml(o)}</button>`).join("")}</div>
    </div>`;
  showTab("assist", "explain");
}

function answerQuiz(choice: number) {
  if (!quiz) return;
  const { quiz: q } = quiz;
  const right = choice === q.answer;
  const p = progress.predict;
  p.total++;
  if (right) {
    p.right++;
    p.streak++;
    p.best = Math.max(p.best, p.streak);
  } else {
    p.streak = 0;
  }
  saveProgress(progress);
  if (right) award(XP_PREDICT + Math.min(p.streak - 1, 5) * 2, p.streak > 1 ? `streak ${p.streak}` : "correct prediction");
  const buttons = $("#explain").querySelectorAll<HTMLButtonElement>("[data-opt]");
  buttons.forEach((b, i) => {
    b.disabled = true;
    b.classList.toggle("right", i === q.answer);
    b.classList.toggle("wrong", i === choice && !right);
  });
  $("#explain").insertAdjacentHTML(
    "beforeend",
    `<p class="${right ? "good-text" : "error-text"}">${right ? "Correct!" : `Not quite: it's ${escapeHtml(q.options[q.answer])}.`}</p>${q.explain ? `<p class="explain-text">${escapeHtml(q.explain)}</p>` : ""}<button class="primary" data-act="continue">Continue</button>`,
  );
  quiz = null;
  machine.update(engine?.state() ?? null);
  state = engine?.state() ?? null;
  updateButtons();
  $<HTMLButtonElement>("#explain [data-act=continue]").focus();
}

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

function onLessonClick(e: MouseEvent) {
  const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
  if (!act || !engine) return;
  const box = $("#lesson .challenge");
  const result = box.querySelector<HTMLElement>(".result")!;
  if (act === "hint") {
    box.querySelector<HTMLElement>(".hint")!.hidden = false;
  } else if (act === "solution") {
    if (!confirm("Replace your code with a working solution? Your current code will be overwritten.")) return;
    editor.value = applySolution(SOURCES[level.file], level);
    progress.code[level.id] = editor.value;
    saveProgress(progress);
    compile();
    result.textContent = "Solution loaded. Read the changes, then press “Check my code”.";
  } else if (act === "check") {
    stop();
    result.className = "result muted";
    result.textContent = "Running your program to the end…";
    setTimeout(() => {
      const outcome = checkChallenge(engine!, editor.value, level);
      compile();
      result.className = `result ${outcome.passed ? "good-text" : "error-text"}`;
      result.textContent = outcome.message;
      if (outcome.passed && !progress.done.includes(level.id)) {
        progress.done.push(level.id);
        saveProgress(progress);
        award(XP_CHALLENGE, `Level ${level.id} complete`);
        box.classList.add("done");
        box.querySelector(".badge")!.textContent = "✓ Completed";
        const next = LEVELS.find((l) => l.id === level.id + 1);
        if (next) result.insertAdjacentHTML("beforeend", ` <a href="#/level/${next.id}">Next: ${next.title} →</a>`);
      }
    }, 20);
  }
}

// ---------------------------------------------------------------------------
// Inspect mode: what is under the pointer?
// ---------------------------------------------------------------------------

const TOKEN_KINDS: Record<string, string> = {
  kw: "keyword",
  id: "identifier",
  fn: "function name",
  num: "number literal",
  str: "string literal",
  lit: "literal (true, false, nil)",
  op: "operator",
  punct: "punctuation",
  cm: "comment",
  err: "invalid character",
};

const PANELS: Record<string, string> = {
  bytecode: "<b>Bytecode</b>: the compiled program, one row per instruction: address, raw bytes, meaning.<br><span class='muted'>Made by <code>compile()</code> in core/src/compiler.rs, decoded by <code>disassemble()</code>, rendered by web/src/machine.ts.</span>",
  stack: "<b>Value stack</b>, grouped into call frames. Every row is one 64-bit slot of the Rust <code>Vec&lt;Value&gt;</code> inside the VM.<br><span class='muted'>Serialized by <code>state_json()</code> in core/src/inspect.rs, rendered by web/src/machine.ts.</span>",
  globals: "<b>Globals</b>: top-level variables live in their own table, outside the stack. <code>GET_GLOBAL</code> and <code>SET_GLOBAL</code> index into it.",
  heap: "<b>Heap</b>: arrays and strings, addressed @0, @1, … References on the stack and in globals point here.",
  bits: "<b>Bits</b>: one value decoded from its 64-bit pattern, plus its real bytes, read from WebAssembly memory with a JavaScript <code>Uint8Array</code>.",
  charts: "<b>Charts</b> drawn by the program with <code>plot</code>, <code>scatter</code> and <code>heatmap</code>. The VM stores the points; web/src/charts.ts draws them on a canvas.",
  explain: "<b>Explain</b>: a plain-English description of the next instruction, generated by core/src/explain.rs from the live machine state. No AI involved.",
  output: "<b>Output</b>: everything <code>print</code> wrote. <code>print</code> is a built-in implemented in Rust inside the VM.",
  editor: "<b>Editor</b>, built from scratch: a transparent textarea over a colored copy of the text. Colors come from the same Rust lexer the compiler uses.",
  lesson: "<b>Lesson</b>: the story, the math (rendered with KaTeX) and the papers behind this level.",
};

const CONTROLS: Record<string, string> = {
  run: "Runs the program. At full speed it calls the WebAssembly export <code>run(50000)</code> repeatedly for about 12 ms, redraws the panels once, and repeats every animation frame.",
  step: "Executes exactly one instruction: the WebAssembly export <code>step()</code>, one trip around the fetch-decode-execute loop.",
  line: "Runs instructions until the source line changes: <code>step_line()</code> in core/src/vm.rs.",
  reset: "Puts the machine back to instruction 0 with an empty stack and heap: <code>reset()</code>.",
  predict: "Predict mode: before each step's result is shown, guess what the machine will do. Correct guesses earn XP.",
  speed: "Delay between animated steps. The last setting runs flat out, in chunks.",
};

function sourceText(span: Span): string {
  return editor.value.slice(span[0], span[1]);
}

function valueCard(title: string, v: Val, extra = ""): string {
  const b = BigInt("0x" + v.bits);
  return `<h4>${title}</h4>
    <div class="layer"><span class="lbl">Value</span><code>${escapeHtml(v.text)}</code> <span class="chip">${v.kind}</span></div>
    <div class="layer"><span class="lbl">64 bits</span><code>0x${v.bits.toUpperCase()}</code></div>
    <div class="layer"><span class="lbl">Meaning</span>${escapeHtml(describeBits(b))}</div>
    <div class="layer"><span class="lbl">Address</span><code>0x${v.addr.toString(16).padStart(8, "0")}</code> in WebAssembly memory</div>
    ${extra}<p class="muted small">Leave Inspect mode and click it to decode the bits.</p>`;
}

function describeKey(key: string): string | null {
  const [kind, a] = key.split(":");
  if (kind === "src" && engine) {
    const at = Number(a);
    const token = engine.tokenize(editor.value).find(([, s, e]) => s <= at && at < e);
    if (!token) return null;
    const [cls, s, e] = token;
    const instrs = (program?.instrs ?? []).filter((i) => i.span[0] <= at && at < i.span[1]);
    const tightest = instrs.reduce<number>((m, i) => Math.min(m, i.span[1] - i.span[0]), Infinity);
    const own = instrs.filter((i) => i.span[1] - i.span[0] === tightest).slice(0, 6);
    const bytecode = own.length
      ? own.map((i) => `<div><code>${pad4(i.ip)}</code> <code class="hexb">${i.bytes.map((x) => x.toString(16).padStart(2, "0")).join(" ")}</code> ${escapeHtml(i.text)}</div>`).join("")
      : `<span class="muted">${cls === "cm" ? "Comments are thrown away by the parser: no bytecode at all." : "No instruction of its own; it's part of the surrounding statement."}</span>`;
    return `<h4>Source → tokens → bytecode</h4>
      ${own.length ? `<div class="layer"><span class="lbl">Expression</span><code>${escapeHtml(sourceText(own[0].span).slice(0, 80))}</code></div>` : ""}
      <div class="layer"><span class="lbl">Token</span><code>${escapeHtml(editor.value.slice(s, e).slice(0, 40))}</code> · ${TOKEN_KINDS[cls] ?? cls} · chars ${s}–${e}</div>
      <div class="layer"><span class="lbl">Bytecode</span><div>${bytecode}</div></div>
      <p class="muted small">lexer.rs → parser.rs → compiler.rs</p>`;
  }
  if (kind === "instr" && program) {
    const ins = program.instrs.find((i) => i.ip === Number(a));
    if (!ins) return null;
    const op = ins.text.split(" ")[0];
    const operands = ins.bytes.slice(1);
    let decoded = "";
    if (operands.length >= 2 && op !== "BUILTIN") {
      const v = operands[0] | (operands[1] << 8);
      decoded = `<div class="layer"><span class="lbl">Operand</span><code>${operands[0].toString(16).padStart(2, "0")} ${operands[1].toString(16).padStart(2, "0")}</code> little-endian → 0x${v.toString(16).padStart(4, "0")} = ${v}${operands.length === 3 ? `, then argument count ${operands[2]}` : ""}</div>`;
    } else if (op === "BUILTIN") {
      decoded = `<div class="layer"><span class="lbl">Operands</span>built-in id ${operands[0]}, argument count ${operands[1]}</div>`;
    }
    return `<h4>Instruction at ${pad4(ins.ip)}</h4>
      <div class="layer"><span class="lbl">Opcode</span><code>${ins.bytes[0].toString(16).padStart(2, "0")}</code> = ${op}</div>
      ${decoded}
      <div class="layer"><span class="lbl">Does</span>${escapeHtml(OPCODES[op] ?? "")}</div>
      <div class="layer"><span class="lbl">From</span>line ${ins.line}: <code>${escapeHtml(sourceText(ins.span).slice(0, 80))}</code></div>
      <p class="muted small">Executed by <code>Vm::exec</code> in core/src/vm.rs.</p>`;
  }
  if (kind === "stack" || kind === "global" || kind === "heap") {
    const target = resolveValue(key, state);
    if (!target) return null;
    const frame = kind === "stack" ? state!.stack[Number(a)] : null;
    const extra = frame ? `<div class="layer"><span class="lbl">Frame</span>${escapeHtml(state!.frames[frame.frame].name)} (frame ${frame.frame}, slot ${Number(a) - state!.frames[frame.frame].base})</div>` : "";
    return valueCard(target.label, target.val, extra);
  }
  if (kind === "heapobj" && state) {
    const o = state.heap.find((x) => x.addr === Number(a));
    if (!o) return null;
    const first = o.items?.[0];
    return `<h4>Heap object @${o.addr}</h4>
      <div class="layer"><span class="lbl">Type</span>${o.type === "str" ? "string (UTF-8 bytes)" : `array of ${o.len} 64-bit values`}</div>
      ${first ? `<div class="layer"><span class="lbl">Elements</span>start at <code>0x${first.addr.toString(16)}</code>, 8 bytes apart: element i is at base + 8·i</div>` : ""}
      <div class="layer"><span class="lbl">Rust</span><code>Obj::${o.type === "str" ? "Str(String)" : "Array(Vec&lt;Value&gt;)"}</code> in <code>Vm.heap</code></div>
      <p class="muted small">Any value whose bits are 0xFFFC…${o.addr.toString(16).padStart(4, "0")} points here.</p>`;
  }
  if (kind === "frame" && state) {
    const f = state.frames[Number(a)];
    if (!f) return null;
    return `<h4>Call frame ${a}: ${escapeHtml(f.name)}</h4>
      <div class="layer"><span class="lbl">Base</span>stack index ${f.base}: its slot 0 (the first parameter)</div>
      <div class="layer"><span class="lbl">Returns to</span>${Number(a) === 0 ? "nothing: this is the main program" : pad4(f.ret)}</div>
      <p class="muted small"><code>struct Frame { func, base, ret_ip }</code> in core/src/vm.rs</p>`;
  }
  if (kind === "panel") return PANELS[a] ? `<h4>Behind this panel</h4><p>${PANELS[a]}</p>` : null;
  if (kind === "ctl") return CONTROLS[a] ? `<h4>Behind this control</h4><p>${CONTROLS[a]}</p>` : null;
  if (kind === "challenge") {
    return `<h4>How challenges are checked</h4><p>The IDE appends a few lines of Bitlens to your program, compiles everything, runs it to the end, and reads the global <code>__check</code>. Your program is graded by the same machine that runs it.</p><pre class="code-block">${escapeHtml(level.challenge.check)}</pre>`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Search and the AI tutor's context
// ---------------------------------------------------------------------------

const BUILTIN_DOCS: [string, string][] = [
  ["print(...)", "Write values to the output."],
  ["len(a)", "Number of elements in an array or characters in a string."],
  ["push(a, v)", "Append to an array."],
  ["array(n, v)", "New array of n copies of v."],
  ["exp, log, sqrt, abs, floor, sin, cos, tanh, pow, min, max", "Math built-ins."],
  ["random()", "Deterministic pseudo-random number in [0, 1)."],
  ["steps()", "Instructions executed so far."],
  ["plot(chart, x, y[, series])", "Add a point to a line chart."],
  ["scatter(chart, x, y, group)", "Add a dot to a scatter chart; group −1 is a centroid."],
  ["heatmap(chart, rows)", "Draw a 2D array as colors."],
  ["clearplot(chart)", "Erase a chart."],
];

function searchItems(): SearchItem[] {
  const go = (id: number) => () => (location.hash = `#/level/${id}`);
  return [
    ...LEVELS.map((l) => ({ kind: "Level", title: `${l.id}. ${l.title}`, detail: l.tagline, run: go(l.id) })),
    ...TERMS.map((t) => ({ kind: "Concept", title: t.term, detail: t.def, run: t.level ? go(t.level) : () => {} })),
    ...Object.entries(OPCODES).map(([op, d]) => ({ kind: "Instruction", title: op, detail: d, run: () => palette.open(op) })),
    ...BUILTIN_DOCS.map(([n, d]) => ({ kind: "Built-in", title: n, detail: d, run: () => palette.open(n) })),
    ...LEVELS.flatMap((l) =>
      l.papers.map((p) => ({
        kind: "Paper",
        title: p.cite,
        detail: `Level ${l.id}: ${l.title}`,
        run: () => (p.url ? window.open(p.url, "_blank", "noopener") : go(l.id)()),
      })),
    ),
    ...LEVELS.flatMap((l) => l.formulas.map((f) => ({ kind: "Formula", title: f.caption, detail: `Level ${l.id}: ${l.title}`, run: go(l.id) }))),
  ];
}

function webSearchItems(q: string): SearchItem[] {
  const e = encodeURIComponent(q);
  const open = (url: string) => () => window.open(url, "_blank", "noopener");
  const items: SearchItem[] = [
    { kind: "Web", title: `Search the web for “${q}”`, detail: "google.com", run: open(`https://www.google.com/search?q=${e}`) },
    { kind: "Papers", title: `Search arXiv for “${q}”`, detail: "arxiv.org", run: open(`https://arxiv.org/search/?query=${e}&searchtype=all`) },
    { kind: "Papers", title: `Search Google Scholar for “${q}”`, detail: "scholar.google.com", run: open(`https://scholar.google.com/scholar?q=${e}`) },
  ];
  if (chat.enabled && !$("#lab-view").hidden) {
    items.unshift({
      kind: "AI",
      title: `Ask the tutor: “${q}”`,
      detail: "uses web search and your live machine state",
      run: () => {
        showTab("assist", "chat");
        chat.ask(q);
      },
    });
  }
  return items;
}

function buildContext(): string {
  const s = state;
  const lines = [`Level ${level.id}: ${level.title}. Challenge: ${level.challenge.goal}`];
  if (!s) {
    lines.push(`The program does not compile: ${$("#compile-status").textContent}`);
  } else {
    const ins = program?.instrs.find((i) => i.ip === s.ip);
    lines.push(`Machine: ${s.status}, ${s.steps} instructions executed, source line ${s.line}.`);
    if (ins && s.status !== "halted") lines.push(`Next instruction: ${pad4(ins.ip)} ${ins.text}. ${s.explain}`);
    if (s.error) lines.push(`Runtime error: ${s.error.msg}`);
    const stack = s.stack.slice(-12).reverse().map((v) => `${v.name ?? "temp"} = ${v.text} (0x${v.bits})`);
    lines.push(`Stack, top first (${s.stack.length} values, ${s.frames.length} frames): ${stack.join("; ") || "empty"}`);
    lines.push(`Globals: ${s.globals.slice(0, 30).map((g) => `${g.name} = ${g.text.slice(0, 80)}`).join("; ") || "none"}`);
    if (machine.selected) {
      const t = resolveValue(machine.selected, s);
      if (t) lines.push(`Selected in the Bits panel: ${t.label} = ${t.val.text}, bits 0x${t.val.bits}`);
    }
    const out = s.output.trim().split("\n").slice(-15).join("\n");
    if (out) lines.push(`Output (last lines):\n${out}`);
  }
  const numbered = editor.value.split("\n").map((l, i) => `${String(i + 1).padStart(3)}  ${l}`).join("\n");
  lines.push(`Program source:\n${numbered.slice(0, 12000)}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Routing, controls, startup
// ---------------------------------------------------------------------------

function route() {
  const m = location.hash.match(/^#\/level\/(\d+)/);
  const inLab = !!m;
  $("#map-view").hidden = inLab;
  $("#lab-view").hidden = !inLab;
  $("#lab-controls").hidden = !inLab;
  document.body.classList.toggle("in-lab", inLab);
  if (m) openLevel(Number(m[1]));
  else {
    stop();
    document.title = "Bitlens: build your own IDE";
    renderMap();
  }
}

function applyTheme(t: string) {
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = t;
  $("#theme-btn").textContent = t === "dark" ? "Dark" : t === "light" ? "Light" : "Auto";
  try {
    localStorage.setItem("bitlens.theme", t);
  } catch {
    // not remembered
  }
  charts.draw();
}

function wire() {
  $("#run-btn").addEventListener("click", run);
  $("#step-btn").addEventListener("click", step);
  $("#line-btn").addEventListener("click", () => {
    engine?.stepLine();
    refresh();
  });
  $("#reset-btn").addEventListener("click", () => {
    stop();
    engine?.reset();
    chartsVersion = -1;
    refresh();
  });
  $("#reset-code").addEventListener("click", () => {
    if (!confirm("Discard your edits and restore the original program?")) return;
    delete progress.code[level.id];
    saveProgress(progress);
    editor.value = SOURCES[level.file];
    compile();
  });
  $("#lesson").addEventListener("click", onLessonClick);
  $("#explain").addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const opt = t.closest<HTMLElement>("[data-opt]")?.dataset.opt;
    if (opt !== undefined) answerQuiz(Number(opt));
    if (t.closest("[data-act=continue]")) refresh();
  });
  $("#inspect-btn").addEventListener("click", () => inspector.toggle());
  $("#search-btn").addEventListener("click", () => palette.open());
  $("#lesson-toggle").addEventListener("click", () => {
    const collapsed = $(".lesson-panel").classList.toggle("collapsed");
    $("#lesson-toggle").textContent = collapsed ? "Show" : "Hide";
  });
  for (const tab of document.querySelectorAll<HTMLElement>("[data-tab]")) {
    tab.addEventListener("click", () => showTab(tab.closest<HTMLElement>("[data-tabs]")!.dataset.tabs!, tab.dataset.tab!));
  }
  const themes = ["system", "light", "dark"];
  $("#theme-btn").addEventListener("click", () => {
    let current = "system";
    try {
      current = localStorage.getItem("bitlens.theme") ?? "system";
    } catch {
      // default
    }
    applyTheme(themes[(themes.indexOf(current) + 1) % themes.length]);
  });
  document.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      palette.open();
    } else if (!$("#lab-view").hidden && mod && e.key === "Enter") {
      e.preventDefault();
      run();
    } else if (!$("#lab-view").hidden && mod && e.key === "'") {
      e.preventDefault();
      if (e.shiftKey) $("#line-btn").click();
      else step();
    } else if (quiz && /^[1-4]$/.test(e.key) && !(e.target as HTMLElement).matches("textarea, input")) {
      answerQuiz(Number(e.key) - 1);
    }
  });
  window.addEventListener("hashchange", route);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => charts.draw());
}

async function start() {
  wire();
  renderXp();
  let theme = "system";
  try {
    theme = localStorage.getItem("bitlens.theme") ?? "system";
  } catch {
    // default
  }
  applyTheme(theme);
  try {
    engine = await loadEngine(fetch(`${import.meta.env.BASE_URL}bitlens.wasm`));
  } catch (err) {
    document.body.insertAdjacentHTML(
      "afterbegin",
      `<div class="fatal">Couldn't load the engine (bitlens.wasm): ${escapeHtml(String(err))}. Run <code>npm run wasm</code> in web/ first.</div>`,
    );
    return;
  }
  route();
}

start();
