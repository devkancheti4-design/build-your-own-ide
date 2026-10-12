# Bitlens: build your own IDE, from bits to transformers

**Bitlens** is a programming environment you build from scratch to see what's really going on inside a computer. You write a program, compile it to bytecode, and step through a virtual machine one instruction at a time, clicking any value to see its 64 bits. Then you climb a 13-level journey from floating-point rounding to backpropagation, Adam and attention, running every formula yourself.

**▶ [Play it in your browser](https://devkancheti4-design.github.io/build-your-own-ide/)** · **📖 [Start the tutorial](tutorial/00-introduction.md)**

It comes with a **step-by-step tutorial** that walks through building every part:

- a language with its own **lexer, parser and bytecode compiler** (Rust, zero dependencies),
- a **stack-based virtual machine** that can pause after any instruction, with NaN-boxed 64-bit values, call frames and a heap,
- a **WebAssembly bridge** written by hand, so the browser can read the machine's raw memory,
- a browser **IDE**: an editor built from scratch, breakpoints, a bytecode view, call stack, globals, heap, a bit-level inspector, live charts and a plain-English explainer,
- a **game layer**: 13 levels with formulas from the original papers, challenges graded by the machine itself, a predict-the-next-value quiz, XP and ranks, a DevTools-style **Inspect mode** and ⌘K search,
- an optional **AI tutor** that sees the live machine state and can search the web for papers.

## The tutorial

0. [Introduction](tutorial/00-introduction.md)
1. [Values and bits](tutorial/01-values-and-bits.md): IEEE-754 doubles and NaN-boxing
2. [The lexer](tutorial/02-lexer.md)
3. [The parser](tutorial/03-parser.md): recursive descent, precedence, spans and error messages
4. [The compiler](tutorial/04-compiler.md): bytecode, stack slots, jumps and backpatching, functions
5. [The virtual machine](tutorial/05-virtual-machine.md): fetch-decode-execute, frames, heap, breakpoints
6. [The WebAssembly bridge](tutorial/06-webassembly-bridge.md): sharing linear memory with JavaScript
7. [The editor](tutorial/07-the-editor.md): a code editor from a textarea and a paint layer
8. [Inspecting the machine](tutorial/08-inspecting-the-machine.md): the bit inspector and the explainer
9. [Charts and machine learning](tutorial/09-charts-and-ml.md): from gradient descent to a transformer block
10. [The game layer](tutorial/10-the-game-layer.md): levels, self-checking challenges, Predict and Inspect modes
11. [The AI tutor](tutorial/11-the-ai-tutor.md)
12. [Where to go next](tutorial/12-where-next.md)

## The journey

| # | Level | What you see happen | From the papers |
|---|---|---|---|
| 1 | Hello, machine | fetch-decode-execute, the value stack | von Neumann 1945 |
| 2 | Numbers are bits | why 0.1 + 0.2 ≠ 0.3, bit by bit | Goldberg 1991; IEEE 754 |
| 3 | The call stack | frames, return addresses, exponential recursion | Dijkstra 1960 |
| 4 | Pointers and the heap | references, aliasing | McCarthy 1960 |
| 5 | Gradient descent | the loss falling, and the exact step size where it explodes | Cauchy 1847; Robbins & Monro 1951 |
| 6 | The perceptron | the 1958 neuron learns AND (and fails at XOR) | Rosenblatt 1958; Novikoff 1962 |
| 7 | k-means | clusters forming | Lloyd 1957/1982 |
| 8 | Backpropagation | a hidden layer learns XOR | Rumelhart, Hinton & Williams 1986 |
| 9 | Softmax and cross-entropy | numerically stable softmax, p − y gradients | Bridle 1990; Shannon 1948 |
| 10 | Adam | Adam vs gradient descent in the Rosenbrock valley | Kingma & Ba 2014 |
| 11 | A tiny language model | bigram counts, sampling, perplexity | Shannon 1948; Bengio et al. 2003 |
| 12 | Attention | softmax(QKᵀ/√d)V as a heatmap | Vaswani et al. 2017; Bahdanau et al. 2014 |
| 13 | A transformer block | positions, attention, residuals, LayerNorm, MLP, causal mask | Vaswani et al. 2017; Ba et al. 2016; Xiong et al. 2020 |

## Run it

You need [Rust](https://rustup.rs) with the WebAssembly target and [Node.js](https://nodejs.org) 22.18 or newer.

```bash
rustup target add wasm32-unknown-unknown
cd web
npm install
npm run dev
```

Or run programs in the terminal:

```bash
cd core
cargo run --release -- ../examples/08_backprop_xor.bl
cargo run --release -- ../examples/01_hello.bl --disasm --trace
```

## Test it

```bash
cd core && cargo test           # the language, the VM, and every level program
cd web && npm run verify        # every challenge fails on the starting code and passes with its solution
cd web && npm run check         # TypeScript types
```

## The language in one screen

```js
let xs = [1, 2, 3];              // numbers (64-bit floats), strings, arrays, true/false/nil
fn square(x) {                   // functions at the top level, recursion allowed
  return x * x;
}
for (let i = 0; i < len(xs); i += 1) {
  if (xs[i] % 2 == 1 && true) { print(xs[i], "->", square(xs[i])); } else { print("even"); }
}
let n = 0;
while (n < 3) { n += 1; }
plot("growth", n, square(n));    // draws a live chart in the IDE
```

Built-ins: `print`, `len`, `push`, `array`, `exp`, `log`, `sqrt`, `abs`, `floor`, `sin`, `cos`, `tanh`, `pow`, `min`, `max`, `random` (seeded, so runs are reproducible), `steps`, `plot`, `scatter`, `heatmap` and `clearplot`.

## The AI tutor is optional

Everything works offline. The **Ask AI** tab only does something once you paste your own Anthropic API key. It's sent from your browser straight to `api.anthropic.com`, and usage is billed to your account.

## Project layout

```text
core/        Rust: lexer, parser, compiler, VM, explainer, JSON snapshots, wasm exports, CLI
examples/    the 13 level programs
web/         TypeScript IDE (Vite): editor, panels, bit inspector, charts, levels, game, search, AI tutor
tutorial/    the step-by-step guide
```

## License

[MIT](LICENSE)
