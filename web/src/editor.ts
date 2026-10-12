// A code editor from scratch: a transparent <textarea> for typing, laid
// exactly on top of a colored copy of the same text. The browser handles the
// cursor, selection, undo and IME input; we only paint the layer underneath.

import type { Span, TokenTuple } from "./types.ts";

export interface EditorOptions {
  tokenize(src: string): TokenTuple[];
  onChange(src: string): void;
  onToggleBreakpoint(line: number): void;
}

const escapeHtml = (s: string) => s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));

export class Editor {
  readonly root: HTMLElement;
  private input: HTMLTextAreaElement;
  private paint: HTMLElement;
  private gutter: HTMLElement;
  private exec: Span | null = null;
  private error: Span | null = null;
  private hover: Span | null = null;
  private breakpoints = new Set<number>();
  private execLine = 0;
  private opts: EditorOptions;

  constructor(host: HTMLElement, opts: EditorOptions) {
    this.opts = opts;
    host.innerHTML = `
      <div class="editor">
        <div class="gutter" aria-hidden="true"><div class="gutter-inner"></div></div>
        <div class="code">
          <div class="paint" aria-hidden="true"></div>
          <textarea spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" aria-label="Program source code"></textarea>
        </div>
      </div>`;
    this.root = host.querySelector(".editor")!;
    this.input = host.querySelector("textarea")!;
    this.paint = host.querySelector(".paint")!;
    this.gutter = host.querySelector(".gutter-inner")!;

    this.input.addEventListener("input", () => {
      this.render();
      this.opts.onChange(this.input.value);
    });
    this.input.addEventListener("scroll", () => this.syncScroll());
    this.input.addEventListener("keydown", (e) => this.onKey(e));
    this.gutter.addEventListener("click", (e) => {
      const line = (e.target as HTMLElement).closest<HTMLElement>("[data-line]")?.dataset.line;
      if (line) this.opts.onToggleBreakpoint(Number(line));
    });
  }

  get value(): string {
    return this.input.value;
  }

  set value(src: string) {
    this.input.value = src;
    this.render();
  }

  setExec(span: Span | null, line = 0) {
    this.exec = span && span[0] < span[1] ? span : null;
    this.execLine = line;
    this.render();
    if (line > 0) this.revealLine(line);
  }

  setError(span: Span | null) {
    this.error = span ? [span[0], Math.max(span[1], span[0] + 1)] : null;
    this.render();
  }

  setHover(span: Span | null) {
    this.hover = span;
    this.render();
  }

  setBreakpoints(lines: Set<number>) {
    this.breakpoints = lines;
    this.render();
  }

  focus() {
    this.input.focus();
  }

  /** Character offset under a screen position, for Inspect mode. */
  offsetAt(clientX: number, clientY: number): number | null {
    const box = this.input.getBoundingClientRect();
    const style = getComputedStyle(this.input);
    const lineHeight = parseFloat(style.lineHeight);
    const charWidth = this.charWidth();
    const x = clientX - box.left - parseFloat(style.paddingLeft) + this.input.scrollLeft;
    const y = clientY - box.top - parseFloat(style.paddingTop) + this.input.scrollTop;
    if (x < 0 || y < 0) return null;
    const lines = this.input.value.split("\n");
    const row = Math.floor(y / lineHeight);
    if (row >= lines.length) return null;
    const col = Math.floor(x / charWidth);
    if (col >= lines[row].length) return null;
    return lines.slice(0, row).reduce((n, l) => n + l.length + 1, 0) + col;
  }

  private charWidth(): number {
    const probe = document.createElement("span");
    probe.textContent = "0".repeat(100);
    probe.style.visibility = "hidden";
    this.paint.appendChild(probe);
    const width = probe.getBoundingClientRect().width / 100;
    probe.remove();
    return width;
  }

  private revealLine(line: number) {
    const lineHeight = parseFloat(getComputedStyle(this.input).lineHeight);
    const top = (line - 1) * lineHeight;
    const view = this.input.clientHeight;
    if (top < this.input.scrollTop + lineHeight || top > this.input.scrollTop + view - 2 * lineHeight) {
      this.input.scrollTop = Math.max(0, top - view / 3);
    }
  }

  private syncScroll() {
    this.paint.style.transform = `translate(${-this.input.scrollLeft}px, ${-this.input.scrollTop}px)`;
    this.gutter.style.transform = `translateY(${-this.input.scrollTop}px)`;
  }

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
    } else if (e.key === "}" && /^\s+$/.test(ta.value.slice(ta.value.lastIndexOf("\n", ta.selectionStart - 1) + 1, ta.selectionStart))) {
      // Typing `}` on an indentation-only line steps back one level.
      e.preventDefault();
      const start = ta.selectionStart;
      const lineStart = ta.value.lastIndexOf("\n", start - 1) + 1;
      ta.setSelectionRange(Math.max(lineStart, start - 2), start);
      this.insert("}");
    }
  }

  /** Insert text at the cursor in a way the browser can undo. */
  private insert(text: string) {
    if (!document.execCommand("insertText", false, text)) {
      this.input.setRangeText(text, this.input.selectionStart, this.input.selectionEnd, "end");
      this.input.dispatchEvent(new Event("input"));
    }
  }

  render() {
    const src = this.input.value;
    const classes: string[] = new Array(src.length).fill("");
    const tokens = this.opts.tokenize(src);
    for (const [cls, start, end] of tokens) {
      for (let i = start; i < end && i < src.length; i++) classes[i] = cls;
    }
    // Identifiers followed by `(` are function calls.
    for (const [cls, , end] of tokens) {
      if (cls === "id" && /^\s*\(/.test(src.slice(end, end + 20))) {
        let i = end - 1;
        while (i >= 0 && classes[i] === "id") classes[i--] = "fn";
      }
    }
    const mark = (span: Span | null, cls: string) => {
      if (!span) return;
      for (let i = span[0]; i < span[1] && i < src.length; i++) classes[i] += " " + cls;
    };
    mark(this.hover, "hov");
    mark(this.exec, "exec");
    mark(this.error, "err-mark");

    const lines: string[] = [];
    let html = "";
    let run = "";
    let runClass: string | null = null;
    const flush = () => {
      if (run) html += runClass ? `<span class="${runClass}">${escapeHtml(run)}</span>` : escapeHtml(run);
      run = "";
    };
    for (let i = 0; i <= src.length; i++) {
      if (i === src.length || src[i] === "\n") {
        flush();
        lines.push(html);
        html = "";
        runClass = null;
        continue;
      }
      if (classes[i] !== runClass) {
        flush();
        runClass = classes[i];
      }
      run += src[i];
    }
    this.paint.innerHTML = lines
      .map((l, i) => {
        const n = i + 1;
        const cls = ["l", n === this.execLine ? "exec-line" : "", this.breakpoints.has(n) ? "bp-line" : ""].join(" ");
        return `<div class="${cls}">${l || " "}</div>`;
      })
      .join("");
    this.gutter.innerHTML = lines
      .map((_, i) => {
        const n = i + 1;
        const cls = [this.breakpoints.has(n) ? "bp" : "", n === this.execLine ? "cur" : ""].join(" ");
        return `<div class="gl ${cls}" data-line="${n}" title="Toggle breakpoint">${n}</div>`;
      })
      .join("");
    this.syncScroll();
  }
}
