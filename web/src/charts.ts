// Live charts for `plot`, `scatter` and `heatmap`, drawn on <canvas>.
// Colors come from CSS variables so light and dark themes each get their own
// validated steps.

import type { Chart } from "./types.ts";

interface Theme {
  surface: string;
  text: string;
  text2: string;
  grid: string;
  series: string[];
  seqLo: string;
  seqHi: string;
  other: string;
}

function theme(el: HTMLElement): Theme {
  const css = getComputedStyle(el);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    surface: v("--surface-1"),
    text: v("--text"),
    text2: v("--text-2"),
    grid: v("--grid"),
    series: [v("--s1"), v("--s2"), v("--s3")],
    seqLo: v("--seq-lo"),
    seqHi: v("--seq-hi"),
    other: v("--text-3"),
  };
}

/** Round tick values: steps of 1, 2 or 5 times a power of ten. */
function ticks(lo: number, hi: number, count = 4): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + step * 1e-9; t += step) out.push(Math.abs(t) < step * 1e-9 ? 0 : t);
  return out;
}

const fmt = (n: number) => {
  const a = Math.abs(n);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return n.toExponential(1);
  return String(Number(n.toPrecision(4)));
};

function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `rgb(${x.map((c, i) => Math.round(c + (y[i] - c) * t)).join(",")})`;
}

function luminance(rgb: string): number {
  const [r, g, b] = rgb.match(/\d+/g)!.map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export class Charts {
  private charts: Chart[] = [];
  private host: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
    new ResizeObserver(() => this.draw()).observe(host);
  }

  update(charts: Chart[]) {
    this.charts = charts;
    this.draw();
  }

  get count() {
    return this.charts.length;
  }

  draw() {
    const t = theme(this.host);
    if (this.charts.length === 0) {
      this.host.innerHTML = `<div class="empty">No charts yet. Programs draw here with <code>plot(name, x, y)</code>, <code>scatter(name, x, y, group)</code> and <code>heatmap(name, rows)</code>.</div>`;
      return;
    }
    this.host.innerHTML = "";
    for (const chart of this.charts) {
      const card = document.createElement("figure");
      card.className = "chart";
      card.innerHTML = `<figcaption>${escapeHtml(chart.name)}</figcaption><div class="legend"></div><div class="plot"><canvas></canvas><div class="tip" hidden></div></div><details class="table"><summary>Data table</summary><div></div></details>`;
      this.host.appendChild(card);
      const width = Math.max(220, this.host.clientWidth - 24);
      if (chart.kind === "heatmap") this.heatmap(card, chart, t, width);
      else this.xy(card, chart, t, width);
    }
  }

  private canvas(card: HTMLElement, width: number, height: number) {
    const canvas = card.querySelector("canvas")!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.font = "11px system-ui, sans-serif";
    return { canvas, ctx, tip: card.querySelector<HTMLElement>(".tip")! };
  }

  private xy(card: HTMLElement, chart: Chart, t: Theme, width: number) {
    const line = chart.kind === "line";
    const height = 210;
    const { canvas, ctx, tip } = this.canvas(card, width, height);
    const pts = chart.points.filter((p): p is [number, number, number] => p[0] !== null && p[1] !== null && p[2] !== null);
    const groups = [...new Set(pts.map((p) => p[2]))].sort((a, b) => a - b);
    const colorOf = (g: number) => (g < 0 ? t.text : g < 3 ? t.series[g] : t.other);
    const nameOf = (g: number) => (line ? chart.series[g] || chart.name : g < 0 ? "centroid" : g < 3 ? `group ${g}` : "other groups");

    const legendGroups = line ? groups : [...new Set(groups.map((g) => (g >= 3 ? 3 : g)))];
    if (legendGroups.length > 1 || !line) {
      card.querySelector(".legend")!.innerHTML = legendGroups
        .map((g) => `<span><i class="${g < 0 ? "x" : line ? "ln" : "dot"}" style="--c:${colorOf(g)}"></i>${escapeHtml(nameOf(g))}</span>`)
        .join("");
    }
    if (pts.length === 0) return;

    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    let [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    let [y0, y1] = [Math.min(...ys), Math.max(...ys)];
    if (x0 === x1) [x0, x1] = [x0 - 1, x1 + 1];
    if (y0 === y1) [y0, y1] = [y0 - 1, y1 + 1];
    const ypad = (y1 - y0) * 0.06;
    [y0, y1] = [y0 - ypad, y1 + ypad];
    if (!line) {
      const xpad = (x1 - x0) * 0.06;
      [x0, x1] = [x0 - xpad, x1 + xpad];
    }
    const showDirect = line && groups.length > 1 && groups.length <= 4;
    const pad = { l: 46, r: showDirect ? 96 : 14, t: 8, b: 24 };
    const X = (x: number) => pad.l + ((x - x0) / (x1 - x0)) * (width - pad.l - pad.r);
    const Y = (y: number) => height - pad.b - ((y - y0) / (y1 - y0)) * (height - pad.t - pad.b);

    // Recessive grid and axis labels.
    ctx.strokeStyle = t.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = t.text2;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const v of ticks(y0, y1)) {
      const y = Math.round(Y(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(width - pad.r, y);
      ctx.stroke();
      ctx.fillText(fmt(v), pad.l - 6, y);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const v of ticks(x0, x1, 5)) ctx.fillText(fmt(v), X(v), height - pad.b + 6);

    if (line) {
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      for (const g of groups) {
        const series = pts.filter((p) => p[2] === g);
        ctx.strokeStyle = colorOf(g);
        ctx.beginPath();
        series.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))));
        ctx.stroke();
        if (showDirect) {
          const last = series[series.length - 1];
          ctx.fillStyle = t.text;
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(nameOf(g).slice(0, 16), X(last[0]) + 6, Y(last[1]));
        }
      }
    } else {
      for (const p of pts.filter((q) => q[2] >= 0)) {
        ctx.beginPath();
        ctx.arc(X(p[0]), Y(p[1]), 4.5, 0, Math.PI * 2);
        ctx.fillStyle = colorOf(p[2]);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = t.surface;
        ctx.stroke();
      }
      for (const p of pts.filter((q) => q[2] < 0)) {
        const [cx, cy] = [X(p[0]), Y(p[1])];
        for (const [w, c] of [[5, t.surface], [2.5, t.text]] as const) {
          ctx.lineWidth = w;
          ctx.strokeStyle = c;
          ctx.beginPath();
          ctx.moveTo(cx - 6, cy - 6);
          ctx.lineTo(cx + 6, cy + 6);
          ctx.moveTo(cx + 6, cy - 6);
          ctx.lineTo(cx - 6, cy + 6);
          ctx.stroke();
        }
      }
    }

    // Hover: crosshair for lines, nearest dot for scatter.
    canvas.addEventListener("mousemove", (e) => {
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      let html = "";
      if (line) {
        const nearestX = pts.reduce((best, p) => (Math.abs(X(p[0]) - mx) < Math.abs(X(best[0]) - mx) ? p : best))[0];
        html = `<b>x = ${fmt(nearestX)}</b>` + groups.map((g) => {
          const p = pts.filter((q) => q[2] === g).reduce((best, q) => (Math.abs(q[0] - nearestX) < Math.abs(best[0] - nearestX) ? q : best));
          return `<div><i class="ln" style="--c:${colorOf(g)}"></i>${escapeHtml(nameOf(g))}: ${fmt(p[1])}</div>`;
        }).join("");
        tip.style.setProperty("--cx", `${X(nearestX)}px`);
        tip.classList.add("cross");
      } else {
        const near = pts.reduce((best, p) => (Math.hypot(X(p[0]) - mx, Y(p[1]) - my) < Math.hypot(X(best[0]) - mx, Y(best[1]) - my) ? p : best));
        if (Math.hypot(X(near[0]) - mx, Y(near[1]) - my) < 14) html = `${escapeHtml(nameOf(near[2]))}<br>(${fmt(near[0])}, ${fmt(near[1])})`;
        tip.classList.remove("cross");
      }
      tip.hidden = !html;
      tip.innerHTML = html;
      tip.style.left = `${Math.min(mx + 12, width - 150)}px`;
      tip.style.top = `${Math.max(0, my - 10)}px`;
    });
    canvas.addEventListener("mouseleave", () => (tip.hidden = true));

    const rows = pts.slice(-50);
    card.querySelector(".table div")!.innerHTML = `<table><tr><th>${line ? "series" : "group"}</th><th>x</th><th>y</th></tr>${rows
      .map((p) => `<tr><td>${escapeHtml(nameOf(p[2]))}</td><td>${fmt(p[0])}</td><td>${fmt(p[1])}</td></tr>`)
      .join("")}</table>${pts.length > 50 ? `<p class="muted small">Last 50 of ${pts.length} points.</p>` : ""}`;
  }

  private heatmap(card: HTMLElement, chart: Chart, t: Theme, width: number) {
    const m = chart.matrix;
    const rows = m.length;
    const cols = Math.max(0, ...m.map((r) => r.length));
    if (!rows || !cols) return;
    const pad = { l: 26, t: 18 };
    const cell = Math.max(8, Math.min(44, Math.floor((width - pad.l) / cols)));
    const height = pad.t + rows * cell + 4;
    const { canvas, ctx, tip } = this.canvas(card, Math.min(width, pad.l + cols * cell + 4), height);
    const values = m.flat().filter((v): v is number => v !== null);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const color = (v: number | null) => (v === null ? t.grid : mix(t.seqLo, t.seqHi, hi > lo ? (v - lo) / (hi - lo) : 0.5));

    ctx.fillStyle = t.text2;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let j = 0; j < cols; j++) ctx.fillText(String(j), pad.l + j * cell + cell / 2, pad.t / 2);
    for (let i = 0; i < rows; i++) {
      ctx.fillStyle = t.text2;
      ctx.textAlign = "right";
      ctx.fillText(String(i), pad.l - 6, pad.t + i * cell + cell / 2);
      for (let j = 0; j < cols; j++) {
        const v = m[i][j] ?? null;
        const fill = color(v);
        ctx.fillStyle = fill;
        // 1px surface gap between cells.
        ctx.fillRect(pad.l + j * cell + 0.5, pad.t + i * cell + 0.5, cell - 1, cell - 1);
        if (cell >= 30 && v !== null) {
          ctx.fillStyle = luminance(fill) > 0.55 ? "#0b0b0b" : "#ffffff";
          ctx.textAlign = "center";
          ctx.fillText(Number.isInteger(v) ? String(v) : v.toFixed(2), pad.l + j * cell + cell / 2, pad.t + i * cell + cell / 2);
        }
      }
    }
    card.querySelector(".legend")!.innerHTML = `<span class="ramp" style="--lo:${t.seqLo};--hi:${t.seqHi}"></span><span>${fmt(lo)} → ${fmt(hi)}</span>`;

    canvas.addEventListener("mousemove", (e) => {
      const r = canvas.getBoundingClientRect();
      const j = Math.floor((e.clientX - r.left - pad.l) / cell);
      const i = Math.floor((e.clientY - r.top - pad.t) / cell);
      const inside = i >= 0 && j >= 0 && i < rows && j < cols;
      tip.hidden = !inside;
      if (!inside) return;
      tip.classList.remove("cross");
      tip.innerHTML = `row ${i}, column ${j}<br><b>${m[i][j] === null ? "not finite" : fmt(m[i][j]!)}</b>`;
      tip.style.left = `${Math.min(e.clientX - r.left + 12, r.width - 120)}px`;
      tip.style.top = `${e.clientY - r.top - 10}px`;
    });
    canvas.addEventListener("mouseleave", () => (tip.hidden = true));

    card.querySelector(".table div")!.innerHTML = `<table>${m
      .map((row, i) => `<tr><th>${i}</th>${row.map((v) => `<td>${v === null ? "–" : fmt(v)}</td>`).join("")}</tr>`)
      .join("")}</table>`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
