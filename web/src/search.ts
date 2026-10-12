// The command palette (⌘K / Ctrl+K): search levels, concepts, instructions
// and papers, or send the query to the web.

export interface SearchItem {
  kind: string;
  title: string;
  detail: string;
  run(): void;
}

export interface PaletteOptions {
  items(): SearchItem[];
  /** Actions offered for any query, like web searches. */
  extras(query: string): SearchItem[];
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export class Palette {
  private root: HTMLElement;
  private input: HTMLInputElement;
  private list: HTMLElement;
  private results: SearchItem[] = [];
  private cursor = 0;
  private opts: PaletteOptions;
  private returnFocus: HTMLElement | null = null;

  constructor(opts: PaletteOptions) {
    this.opts = opts;
    this.root = document.createElement("div");
    this.root.className = "palette-backdrop";
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="palette" role="dialog" aria-modal="true" aria-label="Search">
        <input type="search" placeholder="Search levels, concepts, instructions, papers… or the web" aria-label="Search">
        <div class="palette-list" role="listbox"></div>
        <div class="palette-foot muted small">↑↓ to move · Enter to open · Esc to close</div>
      </div>`;
    document.body.appendChild(this.root);
    this.input = this.root.querySelector("input")!;
    this.list = this.root.querySelector(".palette-list")!;
    this.input.addEventListener("input", () => this.search());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        this.cursor = (this.cursor + (e.key === "ArrowDown" ? 1 : -1) + this.results.length) % Math.max(1, this.results.length);
        this.paint();
      } else if (e.key === "Enter") {
        e.preventDefault();
        this.choose(this.cursor);
      } else if (e.key === "Escape") {
        this.close();
      }
    });
    this.root.addEventListener("mousedown", (e) => {
      if (e.target === this.root) this.close();
    });
    this.list.addEventListener("click", (e) => {
      const i = (e.target as HTMLElement).closest<HTMLElement>("[data-i]")?.dataset.i;
      if (i) this.choose(Number(i));
    });
  }

  open(query = "") {
    this.returnFocus = document.activeElement as HTMLElement | null;
    this.root.hidden = false;
    this.input.value = query;
    this.search();
    this.input.focus();
    this.input.select();
  }

  close() {
    this.root.hidden = true;
    this.returnFocus?.focus();
  }

  private choose(i: number) {
    const item = this.results[i];
    if (!item) return;
    this.close();
    item.run();
  }

  private search() {
    const q = this.input.value.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const scored = this.opts
      .items()
      .map((item) => {
        const title = item.title.toLowerCase();
        const text = `${title} ${item.detail.toLowerCase()} ${item.kind.toLowerCase()}`;
        let score = 0;
        for (const w of words) {
          if (title.startsWith(w)) score += 5;
          else if (title.includes(w)) score += 3;
          else if (text.includes(w)) score += 1;
          else return { item, score: -1 };
        }
        return { item, score };
      })
      .filter((r) => r.score >= 0 && (words.length > 0 || r.item.kind === "Level"))
      .sort((a, b) => b.score - a.score)
      .slice(0, 30)
      .map((r) => r.item);
    this.results = [...scored, ...(q ? this.opts.extras(this.input.value.trim()) : [])];
    this.cursor = 0;
    this.paint();
  }

  private paint() {
    this.list.innerHTML =
      this.results
        .map(
          (r, i) =>
            `<div class="palette-item${i === this.cursor ? " active" : ""}" data-i="${i}" role="option" aria-selected="${i === this.cursor}"><span class="kind">${escapeHtml(r.kind)}</span><span class="title">${escapeHtml(r.title)}</span><span class="detail muted">${escapeHtml(r.detail)}</span></div>`,
        )
        .join("") || `<div class="muted pad">No matches.</div>`;
    this.list.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  }
}
