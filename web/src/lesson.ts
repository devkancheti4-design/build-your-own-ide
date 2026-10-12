// The lesson card for a level: story, what's under the hood, formulas
// rendered with KaTeX, the papers they come from, and the challenge.

import katex from "katex";

import type { Level } from "./levels.ts";

const searchLinks = (q: string) => {
  const e = encodeURIComponent(q);
  return `<a href="https://scholar.google.com/scholar?q=${e}" target="_blank" rel="noopener noreferrer">Scholar</a> · <a href="https://arxiv.org/search/?query=${e}&searchtype=all" target="_blank" rel="noopener noreferrer">arXiv</a>`;
};

export function renderLesson(level: Level, done: boolean): string {
  const formulas = level.formulas
    .map(
      (f) => `<figure class="formula">${katex.renderToString(f.tex, { displayMode: true, throwOnError: false })}<figcaption>${f.caption}</figcaption></figure>`,
    )
    .join("");
  const papers = level.papers
    .map((p) => {
      const title = p.url ? `<a href="${p.url}" target="_blank" rel="noopener noreferrer">${p.cite}</a>` : p.cite;
      return `<li>${title} <span class="muted small">search: ${searchLinks(p.cite.replace(/\(.*?\)/g, "").slice(0, 120))}</span></li>`;
    })
    .join("");
  return `
    <header class="lesson-head">
      <div class="lvl-num">Level ${level.id}</div>
      <h2>${level.title}</h2>
      <p class="tagline">${level.tagline}</p>
    </header>
    ${level.story.map((p) => `<p>${p}</p>`).join("")}
    <details class="hood" open><summary>Under the hood</summary><ul>${level.hood.map((h) => `<li>${h}</li>`).join("")}</ul></details>
    <h3>The math</h3>
    ${formulas}
    <h3>From the papers</h3>
    <ul class="papers">${papers}</ul>
    <h3>Try this</h3>
    <ul>${level.tryThis.map((t) => `<li>${t}</li>`).join("")}</ul>
    <section class="challenge${done ? " done" : ""}" data-ins="challenge">
      <div class="challenge-head"><span class="badge">${done ? "✓ Completed" : "Challenge · 150 XP"}</span></div>
      <p><b>${level.challenge.goal}</b></p>
      <div class="challenge-actions">
        <button class="primary" data-act="check">Check my code</button>
        <button data-act="hint">Hint</button>
        <button data-act="solution" class="link">Show a solution</button>
      </div>
      <p class="hint" hidden>${level.challenge.hint}</p>
      <p class="result" role="status"></p>
    </section>`;
}
