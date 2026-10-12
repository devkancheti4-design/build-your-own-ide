# 7. The editor

Most web IDEs embed a large editor component. We'll build ours from scratch in about 220 lines (`web/src/editor.ts`), using a classic trick that gets the hard parts (cursor, selection, undo, copy and paste, IME input, accessibility) for free.

## Set up the web project

```bash
mkdir web && cd web
npm init -y
npm install --save-dev vite typescript
npm install katex
```

Add scripts to `package.json` that build the wasm module and copy it where Vite serves static files:

```json
"scripts": {
  "wasm": "cd ../core && cargo build --lib --release --target wasm32-unknown-unknown && cp target/wasm32-unknown-unknown/release/bitlens_core.wasm ../web/public/bitlens.wasm",
  "dev": "npm run wasm && vite",
  "build": "npm run wasm && tsc --noEmit && vite build"
}
```

## Two layers, perfectly aligned

The editor is two elements stacked on top of each other:

```html
<div class="editor">
  <div class="gutter"><div class="gutter-inner"></div></div>
  <div class="code">
    <div class="paint" aria-hidden="true"></div>              <!-- colored copy, underneath -->
    <textarea spellcheck="false" wrap="off"></textarea>        <!-- real input, on top -->
  </div>
</div>
```

The `<textarea>` is the real editor. Its text is **transparent** but its caret and selection aren't, so you type into it normally. Underneath, `.paint` shows the same text with colors. As long as both use the same font, size, line height, padding and `white-space: pre`, every character lines up exactly:

```css
.paint,
.editor textarea {
  position: absolute;
  top: 0;
  left: 0;
  margin: 0;
  padding: 10px 12px;
  font: inherit;          /* 13px/20px monospace from .editor */
  line-height: 20px;
  white-space: pre;
  tab-size: 2;
}

.editor textarea {
  width: 100%;
  height: 100%;
  background: transparent;
  color: transparent;
  caret-color: var(--text);
  border: 0;
  outline: none;
  resize: none;
}
```

Only the textarea scrolls, so the paint layer and the line-number gutter follow it:

```ts
private syncScroll() {
  this.paint.style.transform = `translate(${-this.input.scrollLeft}px, ${-this.input.scrollTop}px)`;
  this.gutter.style.transform = `translateY(${-this.input.scrollTop}px)`;
}
```

## Painting: one class per character

On every change we rebuild the paint layer. The approach is simple and plenty fast for programs of a few hundred lines:

1. Ask the **Rust lexer** for tokens through wasm (chapter 2's `class()` gives each a CSS class).
2. Fill an array with one class string per character.
3. Layer extra marks on top: the expression **being executed** (`exec`), the bytecode row being **hovered** (`hov`), and a compile **error** (`err-mark`).
4. Group runs of identical classes into `<span>`s, one `<div>` per line.

```ts
render() {
  const src = this.input.value;
  const classes: string[] = new Array(src.length).fill("");
  const tokens = this.opts.tokenize(src);
  for (const [cls, start, end] of tokens) {
    for (let i = start; i < end && i < src.length; i++) classes[i] = cls;
  }
  const mark = (span: Span | null, cls: string) => {
    if (!span) return;
    for (let i = span[0]; i < span[1] && i < src.length; i++) classes[i] += " " + cls;
  };
  mark(this.hover, "hov");
  mark(this.exec, "exec");
  mark(this.error, "err-mark");
  // ... group runs of equal classes into <span>s, one <div class="l"> per line,
  //     adding "exec-line" and "bp-line" to the current line and to breakpoint lines
}
```

Because the highlighting comes from the compiler's own lexer, colors can never disagree with what the compiler understands. If you type an unterminated string, the rest of the line turns red exactly where the parser will complain.

The **exec** mark is the debugger's "you are here". Every instruction carries the span of the source that produced it (chapter 4), so when the VM is about to run `MUL`, the editor highlights `w * x[i]`, not just the line.

## Little things that make it feel like an editor

```ts
private onKey(e: KeyboardEvent) {
  const ta = this.input;
  if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    this.insert("  ");
  } else if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    // Keep the current indentation, and indent one more level after `{`.
    e.preventDefault();
    const before = ta.value.slice(0, ta.selectionStart);
    const line = before.slice(before.lastIndexOf("\n") + 1);
    const indent = line.match(/^\s*/)![0] + (line.trimEnd().endsWith("{") ? "  " : "");
    this.insert("\n" + indent);
  }
  // ... typing `}` on a blank line steps back one level
}

/** Insert text at the cursor in a way the browser can undo. */
private insert(text: string) {
  if (!document.execCommand("insertText", false, text)) {
    this.input.setRangeText(text, this.input.selectionStart, this.input.selectionEnd, "end");
    this.input.dispatchEvent(new Event("input"));
  }
}
```

`execCommand("insertText")` is old, but it's the one way to insert text that the browser's **undo** stack records. Assigning `textarea.value` would wipe undo history.

**Breakpoints** live in the gutter: clicking a line number calls back into the app, which updates the VM (`setBreakpoints`) and redraws the red dots.

## From screen position to source offset

Inspect mode (chapter 10) needs to know which character is under the mouse. With a monospace font that's arithmetic:

```ts
offsetAt(clientX: number, clientY: number): number | null {
  const box = this.input.getBoundingClientRect();
  const style = getComputedStyle(this.input);
  const lineHeight = parseFloat(style.lineHeight);
  const charWidth = this.charWidth();          // measured once from a hidden run of "0"s
  const x = clientX - box.left - parseFloat(style.paddingLeft) + this.input.scrollLeft;
  const y = clientY - box.top - parseFloat(style.paddingTop) + this.input.scrollTop;
  // row = floor(y / lineHeight), col = floor(x / charWidth), then convert to an offset
}
```

## Checkpoint

Wire the editor to the engine in `main.ts`: recompile 250 ms after the last keystroke, show compile errors under the code, and put the current instruction's span on screen after every step:

```ts
const editor = new Editor($("#editor-host"), {
  tokenize: (src) => engine?.tokenize(src) ?? [],
  onChange(src) {
    clearTimeout(compileTimer);
    compileTimer = window.setTimeout(compile, 250);
  },
  onToggleBreakpoint(line) { /* update the set, engine.setBreakpoints, editor.setBreakpoints */ },
});
```

Run `npm run dev`, type a mistake, and watch the wavy underline land exactly where the parser says.

## Exercises

1. Highlight matching brackets next to the cursor.
2. Re-render only the lines that changed. How large does a program need to be before it matters?

Next: [Inspecting the machine →](08-inspecting-the-machine.md)
