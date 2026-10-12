# 10. The game layer

An IDE you *can* explore is good. One that pulls you through 13 levels, quizzes you on what the machine will do next, and checks your solutions is better. This chapter adds the game: levels, self-checking challenges, predict mode, Inspect mode and search.

## Levels are data

`web/src/levels.ts` describes each level as plain data: which program to load, a short story, what's under the hood, formulas in LaTeX (rendered with KaTeX), the papers they come from, and a challenge.

```ts
{
  id: 5,
  file: "05_gradient_descent.bl",
  region: "learning",
  title: "Gradient descent",
  tagline: "Roll downhill on a loss surface until the line fits.",
  formulas: [
    { tex: tex`\theta \leftarrow \theta - \eta\, \nabla_{\theta}\mathcal{L}`, caption: "The update rule (Cauchy, 1847)." },
    // ...
  ],
  papers: [{ cite: "H. Robbins, S. Monro (1951). A Stochastic Approximation Method. ...", url: "https://doi.org/10.1214/aoms/1177729586" }],
  challenge: {
    goal: "Get the loss below 0.00001 in the same 300 epochs, by changing only lr.",
    check: "let __check = loss < 0.00001;",
    hint: "Bigger steps converge faster, up to the stability limit η < 0.0845 derived above.",
    solution: [["let lr = 0.02;", "let lr = 0.08;"]],
  },
}
```

`tex` is just `String.raw`, so LaTeX backslashes survive without escaping. Every paper has a DOI or arXiv link where one exists, plus one-click Google Scholar and arXiv searches.

## Challenges graded by the machine

How do you check that someone's gradient descent converged, or that their transformer has a causal mask? Let the machine run their program and ask it. Each challenge has a few lines of Bitlens that set a global `__check`. We append them to the learner's code, run everything to the end, and read the answer out of the final state:

```ts
export function checkChallenge(engine: Engine, source: string, level: Level): CheckResult {
  engine.setBreakpoints([]);
  const program = engine.compile(`${source}\n\n// challenge check\n${level.challenge.check}\n`);
  if (!program.ok) {
    return { passed: false, message: `The check couldn't compile with your code: ${program.error.msg}.` };
  }
  let state = engine.state();
  while (state && state.status !== "halted" && state.status !== "error" && state.steps < MAX_STEPS) {
    engine.run(5_000_000);
    state = engine.state();
  }
  // ... report errors and timeouts
  const result = state.globals.find((g) => g.name === "__check");
  const truthy = !!result && result.kind !== "nil" && !(result.kind === "bool" && result.text === "false");
  // ...
}
```

Checks can be as rich as the language. Level 3 uses the `steps()` built-in to demand an *efficient* Fibonacci (fewer than 3,000 instructions, which rules out the exponential recursive version), and level 7 loops over the cluster assignments:

```js
let __n2 = 0;
for (let i = 0; i < len(group); i += 1) {
  if (group[i] == 2) {
    __n2 += 1;
  }
}
let __check = k == 3 && len(cx) == 3 && __n2 > 0;
```

## Every challenge is tested

Each level also stores a **solution** as text replacements on the starting program. That enables a "Show a solution" button, and, more importantly, an automated test. `web/scripts/verify.ts` runs in Node against the real wasm module and asserts, for every level, that the starting program runs cleanly but **fails** its challenge, and that the solution **passes**:

```ts
for (const level of LEVELS) {
  const source = readFileSync(new URL(`../examples/${level.file}`, root), "utf8");
  const before = checkChallenge(engine, source, level);
  const after = checkChallenge(engine, applySolution(source, level), level);
  const ok = !before.passed && after.passed && !before.message.includes("error");
  // ...
}
```

Run it with `npm run verify`. If you edit a level program and accidentally make its challenge impossible (or trivially passed), this tells you.

## Predict mode

Predict mode turns stepping into a quiz. When it's on, pressing **Step** runs the instruction but holds back the result, asks what will be on top of the stack (or, for `JUMP_IF_FALSE`, whether it will jump), and only then shows the new state.

The correct answer comes from the real "after" state. The wrong options are designed to tempt: the results of *other* operations on the same two operands (`a - b` vs `b - a`, `a * b` vs `a / b`), values already on the stack, values of other variables:

```ts
const nums = before.stack.slice(-2).filter((v) => v.kind === "num").map((v) => Number(v.text));
if (nums.length === 2) {
  const [a, b] = nums;
  for (const n of [a + b, a - b, b - a, a * b, a / b, b / a, a % b]) pool.add(formatNumber(n));
}
```

Correct answers earn XP, streaks earn bonuses, and ranks climb from *Bit* through *Nibble*, *Byte*, *Word* and *Register* up to *Transformer*. Progress lives in `localStorage`, wrapped in `try/catch` so a private window still works.

## Inspect mode: DevTools for the machine

Browsers have "Inspect element". We'll have **Inspect anything**. With Inspect mode on, hovering over any part of the IDE shows the layer underneath it:

- a **token in the editor** → its kind, its character range, and the exact bytecode it compiled to;
- a **bytecode row** → the opcode byte, the little-endian operand decoded (`2e 00` → 0x002e = 46), and the source it came from;
- a **stack slot** → its 64 bits, what NaN-boxing makes of them, its frame, and its real address in wasm memory;
- a **heap object** → its Rust type and where its elements start;
- a **panel or button** → which Rust function produced the data and which TypeScript file draws it.

The mechanism is small. Elements carry a `data-ins` key (`instr:46`, `stack:3`, `panel:heap`, …), a document-level `mousemove` finds the closest one, and a `describe(key)` function in `main.ts` builds the card from the current program and state. The editor is special because its text sits in a textarea, so it uses `offsetAt()` from chapter 7 to turn the mouse position into a source offset.

## Search

**⌘K** (or Ctrl+K) opens a palette that searches levels, glossary concepts, every instruction, every built-in, every paper and every formula caption. Results are scored by where the words match (title start > title > anywhere). Any query also offers "Search the web", "Search arXiv" and "Search Google Scholar", and, when the AI tutor is on, "Ask the tutor".

## Checkpoint

Play level 1 with Predict on, finish a challenge, and watch your rank change. Then turn on Inspect and hover over a number in the editor, its `CONST` instruction, and the value it pushes: three layers of the same thing.

Next: [The AI tutor →](11-the-ai-tutor.md)
