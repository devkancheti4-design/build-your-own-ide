// Inspect mode, like a browser's DevTools inspector: hover anything to see
// the layer underneath it (source → tokens → bytecode → bits → memory, or
// which Rust and TypeScript code produced a panel). Click to pin the card.

export interface InspectorOptions {
  /** The inspect key under the pointer, e.g. "stack:3" or "src:120". */
  keyAt(e: MouseEvent): { key: string; el: HTMLElement } | null;
  /** HTML for a key, or null when there's nothing to say. */
  describe(key: string): string | null;
  onToggle(active: boolean): void;
}

export class Inspector {
  active = false;
  private pinned = false;
  private outline: HTMLElement;
  private card: HTMLElement;
  private opts: InspectorOptions;

  constructor(opts: InspectorOptions) {
    this.opts = opts;
    this.outline = document.createElement("div");
    this.outline.className = "inspect-outline";
    this.card = document.createElement("div");
    this.card.className = "inspect-card";
    this.card.setAttribute("role", "dialog");
    this.card.setAttribute("aria-label", "Inspector");
    document.body.append(this.outline, this.card);
    this.hide();

    document.addEventListener("mousemove", (e) => {
      if (this.active && !this.pinned) this.update(e);
    });
    document.addEventListener(
      "click",
      (e) => {
        if (!this.active) return;
        const target = e.target as HTMLElement;
        if (target.closest(".inspect-card") || target.closest("[data-inspect-toggle]")) {
          if (target.closest("[data-act=unpin]")) this.unpin();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (this.pinned) this.unpin();
        else if (this.update(e)) this.pin();
      },
      true,
    );
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !this.active) return;
      if (this.pinned) this.unpin();
      else this.toggle(false);
    });
  }

  toggle(force?: boolean) {
    this.active = force ?? !this.active;
    document.body.classList.toggle("inspecting", this.active);
    if (!this.active) {
      this.pinned = false;
      this.hide();
    }
    this.opts.onToggle(this.active);
  }

  private hide() {
    this.outline.hidden = true;
    this.card.hidden = true;
  }

  private pin() {
    this.pinned = true;
    this.card.classList.add("pinned");
    this.card.insertAdjacentHTML("afterbegin", `<button class="unpin" data-act="unpin" aria-label="Close">×</button>`);
  }

  private unpin() {
    this.pinned = false;
    this.card.classList.remove("pinned");
    this.hide();
  }

  private update(e: MouseEvent): boolean {
    const hit = this.opts.keyAt(e);
    const html = hit ? this.opts.describe(hit.key) : null;
    if (!hit || !html) {
      this.hide();
      return false;
    }
    const r = hit.el.getBoundingClientRect();
    Object.assign(this.outline.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    this.outline.hidden = false;
    this.card.innerHTML = html;
    this.card.hidden = false;
    const cw = this.card.offsetWidth;
    const ch = this.card.offsetHeight;
    const x = Math.min(e.clientX + 16, window.innerWidth - cw - 8);
    const y = e.clientY + 16 + ch > window.innerHeight ? Math.max(8, e.clientY - ch - 12) : e.clientY + 16;
    Object.assign(this.card.style, { left: `${Math.max(8, x)}px`, top: `${y}px` });
    return true;
  }
}
