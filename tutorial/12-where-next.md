# 12. Where to go next

You've built a language, a compiler, a virtual machine, a WebAssembly bridge, an editor, a debugger with a bit-level inspector, live charts, a 13-level course from IEEE-754 to transformers, and an AI tutor. Every layer is small enough to read in one sitting, which makes it a good base to extend.

## Language and runtime

- **A garbage collector.** Bitlens never frees heap objects. Add mark-and-sweep: the roots are the stack, the globals and the constants; mark everything reachable from them; sweep the rest into a free list. Because the IDE shows heap addresses, you'll *see* objects die. Start with the classic: McCarthy (1960), the first garbage collector.
- **`break` and `continue`.** The compiler needs a stack of loops, each with a list of jumps to patch.
- **Closures.** Let functions capture local variables. Crafting Interpreters' *upvalues* are the standard design.
- **Strings as first-class citizens:** indexing, slicing, `split`.
- **A register machine.** Compile to register-based bytecode (like Lua 5) and compare instruction counts using `steps()`.
- **Bounds-check elimination.** Teach the compiler that `for (let i = 0; i < len(a); ...)` makes `a[i]` safe.

## Machine learning

- **Automatic differentiation.** Every ML level computes gradients by hand. Add a tape-based autodiff: record each operation during the forward pass, then walk the tape backwards. Then delete the hand-written backward pass from level 8.
- **Tensors.** Add a numeric array type stored as raw `f64`s (no NaN-boxing), with built-in `matmul`. Measure the speedup on level 13.
- **Train the transformer.** Level 13 runs one forward pass with random weights. Add cross-entropy over a vocabulary and backprop through attention, and train it on the level 11 corpus.
- **Pre-norm vs post-norm.** Stack four blocks and compare how training behaves (Xiong et al., 2020).

## The IDE

- **Time-travel debugging.** Record every state, or every write, so you can step *backwards*.
- **A memory map.** Draw WebAssembly linear memory as an image, one pixel per byte, and watch the stack and heap grow.
- **Shareable programs.** Encode the source in the URL hash.
- **More levels.** Each new level is one `.bl` file plus one entry in `levels.ts`, and `npm run verify` tells you whether its challenge works. Ideas: binary search, hash tables, Dijkstra's shortest paths, a convolution, a tiny RNN, beam search, temperature sampling for level 11.

## Running the whole test suite

```bash
cd core && cargo test          # the language and every level program
cd ../web && npm run verify    # every challenge, through the real wasm module
cd ../web && npm run check     # TypeScript types
```

## Further reading

- Robert Nystrom, *Crafting Interpreters*: the best book-length guide to building a bytecode VM.
- David Goldberg (1991), *What Every Computer Scientist Should Know About Floating-Point Arithmetic*.
- The WebAssembly specification, and Lin Clark's illustrated introductions to linear memory.
- Andrej Karpathy, *micrograd* and *nanoGPT*: autodiff and transformers in very little code.

Thanks for building along.
