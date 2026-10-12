# Build your own IDE: from bits to transformers

In this tutorial you'll build **Bitlens**, a small but complete programming environment that shows you everything that normally happens out of sight:

- a **programming language** with its own lexer, parser and bytecode compiler,
- a **virtual machine** you can pause after every single instruction,
- a browser **IDE** with an editor, breakpoints, a bytecode view, a call stack, a heap view and a bit-level value inspector,
- **live charts**, so programs can plot loss curves, clusters and attention maps,
- a **game layer** of 13 levels that climbs from floating-point bits to a transformer block, with formulas from the original papers and challenges the machine checks itself,
- an optional **AI tutor** that reads the live machine state.

The core is written in **Rust** with zero dependencies and compiled to **WebAssembly**. The IDE is plain **TypeScript**: no UI framework and no editor component. Every piece is something you write yourself.

## What you'll understand by the end

- How text becomes tokens, then a tree, then bytecode.
- How a stack machine runs that bytecode, and how function calls, local variables and the heap really work.
- How a 64-bit floating-point number is laid out, why `0.1 + 0.2 != 0.3`, and how a VM can pack every kind of value into 64 bits (NaN-boxing).
- How JavaScript and WebAssembly share memory, so a web page can read the machine's raw bytes.
- How gradient descent, backpropagation, softmax, Adam, attention and LayerNorm work, because you'll run them one instruction at a time.

## The architecture

```text
            ┌──────────────────────── core/ (Rust → WebAssembly) ────────────────────────┐
 source ──▶ │ lexer.rs ──▶ parser.rs ──▶ compiler.rs ──▶ bytecode ──▶ vm.rs ──▶ inspect.rs │ ──▶ JSON
 text       │  tokens        AST          + debug info               steps     explain.rs │
            └──────────────────────────────────────────────────────────────────────────────┘
                                         ▲ alloc / compile / step / state ▼
            ┌──────────────────────── web/ (TypeScript) ───────────────────────────────────┐
            │ engine.ts  editor.ts  machine.ts  bits.ts  charts.ts  levels.ts  chat.ts ... │
            └──────────────────────────────────────────────────────────────────────────────┘
```

The Rust side never touches the DOM, and the TypeScript side never interprets a program. They talk through a handful of WebAssembly functions and JSON snapshots.

## Prerequisites

- Comfortable reading Rust and TypeScript. You don't need to be an expert in either.
- [Rust](https://rustup.rs) with the WebAssembly target: `rustup target add wasm32-unknown-unknown`
- [Node.js](https://nodejs.org) 22.18 or newer (the verify script runs TypeScript files directly).
- No machine learning background. The ML levels explain the math as they go.

## How to follow along

Each chapter builds one layer and ends with a checkpoint you can run. The complete code is in this repository; the chapters walk through it in the order you'd write it, explaining each decision. If you're building alongside, create the files as each chapter introduces them; if you're reading, open the file next to the chapter.

1. [Values and bits](01-values-and-bits.md): the 64-bit value representation everything else rests on.
2. [The lexer](02-lexer.md): characters to tokens.
3. [The parser](03-parser.md): tokens to a syntax tree, with precise error locations.
4. [The compiler](04-compiler.md): the tree to bytecode for a stack machine.
5. [The virtual machine](05-virtual-machine.md): execute, pause, step and inspect.
6. [The WebAssembly bridge](06-webassembly-bridge.md): run the Rust core in the browser and share its memory.
7. [The editor](07-the-editor.md): a code editor from scratch, with highlighting from our own lexer.
8. [Inspecting the machine](08-inspecting-the-machine.md): bytecode, stack frames, heap, the bit inspector and the explainer.
9. [Charts and machine learning](09-charts-and-ml.md): plotting from inside the VM, then gradient descent through transformers.
10. [The game layer](10-the-game-layer.md): levels, self-checking challenges, predict mode, Inspect mode and search.
11. [The AI tutor](11-the-ai-tutor.md): an optional assistant that sees the machine state.
12. [Where to go next](12-where-next.md): garbage collection, closures, autodiff and more.

## Project layout

```text
core/                 the engine (Rust, no dependencies)
  src/value.rs        NaN-boxed 64-bit values
  src/lexer.rs        tokens
  src/parser.rs       syntax tree
  src/op.rs           the instruction set
  src/builtins.rs     built-in function table
  src/compiler.rs     bytecode + debug info + disassembler
  src/vm.rs           the virtual machine
  src/explain.rs      plain-English explanations of the next instruction
  src/inspect.rs      JSON snapshots for the IDE
  src/lib.rs          the WebAssembly interface
  src/main.rs         `bitlens` command-line runner
  tests/              language tests and one test per level
examples/             the 13 level programs (*.bl)
web/                  the IDE (TypeScript + Vite)
  src/engine.ts       loads the WebAssembly module
  src/editor.ts       the code editor
  src/machine.ts      bytecode, stack, globals, heap, output panels
  src/bits.ts         the bit inspector
  src/charts.ts       canvas charts
  src/levels.ts       lessons, formulas, papers and challenges
  src/challenge.ts    self-checking challenges
  src/game.ts         XP, ranks, predict mode
  src/inspect.ts      Inspect mode
  src/search.ts       the ⌘K palette
  src/chat.ts         the optional AI tutor
  src/main.ts         wiring
  scripts/verify.ts   checks every level and challenge from the command line
tutorial/             you are here
```

## Checkpoint: run the finished thing

Before building it, see where you're headed:

```bash
cd web
npm install
npm run dev
```

Open the printed URL and press **Start the journey**.

Next: [Values and bits →](01-values-and-bits.md)
