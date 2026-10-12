// The optional AI tutor. Off by default: nothing leaves the browser until you
// paste your own Anthropic API key and turn it on. Each question is sent
// together with a snapshot of the machine, so answers can use real values.

import type Anthropic from "@anthropic-ai/sdk";
import katex from "katex";

const MODEL = "claude-opus-5-5";
const KEY_STORAGE = "bitlens.apiKey";

const SYSTEM = `You are the tutor inside Bitlens, an educational IDE. Learners write programs in a tiny language, compile them to bytecode, and step through a stack-based virtual machine one instruction at a time, inspecting every value down to its 64 bits. The journey goes from floating-point bits, through call stacks and the heap, to gradient descent, backpropagation, Adam, language models and transformer blocks.

The machine: every value is a NaN-boxed 64-bit word (numbers are IEEE-754 doubles; nil, booleans and heap references hide inside quiet-NaN patterns). Locals live in stack slots inside call frames; arrays and strings live on a heap that is never garbage-collected. Instructions are one opcode byte plus little-endian operands.

The language: let, fn (top level only), if/else, while, for (C-style), return, numbers, strings, arrays with [index], && || !, and the built-ins print, len, push, array(n, v), exp, log, sqrt, abs, floor, sin, cos, tanh, pow, min, max, random (deterministic), steps, plot(name, x, y[, series]), scatter(name, x, y, group), heatmap(name, rows), clearplot(name).

Each question arrives with an <ide> block describing the current level, the program, and the machine state. Use the real values from it when they help. Be concrete and brief: a short explanation, then one worked example. Write math in LaTeX between $...$ or $$...$$, code in backticks. When you cite a paper, give authors, year and title, and only cite papers you are sure exist; search the web when you need to check. When you used web search, say which sources you relied on. Don't hand over full challenge solutions unless the learner asks for one; prefer hints.`;

export interface ChatOptions {
  /** A snapshot of the IDE for the model to read. */
  context(): string;
}

type Msg = Anthropic.Beta.BetaMessageParam;

export class ChatPanel {
  private apiKey = "";
  private messages: Msg[] = [];
  private busy = false;
  private log!: HTMLElement;
  private input!: HTMLTextAreaElement;
  private host: HTMLElement;
  private opts: ChatOptions;

  constructor(host: HTMLElement, opts: ChatOptions) {
    this.host = host;
    this.opts = opts;
    try {
      this.apiKey = localStorage.getItem(KEY_STORAGE) ?? "";
    } catch {
      this.apiKey = "";
    }
    this.render();
  }

  get enabled() {
    return this.apiKey !== "";
  }

  private render() {
    if (!this.enabled) {
      this.host.innerHTML = `
        <div class="chat-setup">
          <p><b>Ask an AI tutor about anything on screen.</b> It sees your code and the live machine state, and can search the web for papers.</p>
          <p class="muted small">Optional. Uses your own Anthropic API key, sent from this browser straight to api.anthropic.com and nowhere else. Usage is billed to your account.</p>
          <form class="key-form">
            <input type="password" name="key" placeholder="sk-ant-..." autocomplete="off" aria-label="Anthropic API key" required>
            <label class="small"><input type="checkbox" name="remember"> Remember on this device</label>
            <button type="submit">Turn on</button>
          </form>
          <p class="muted small">Without a key, the Explain tab still describes every instruction, using the machine's own state.</p>
        </div>`;
      this.host.querySelector("form")!.addEventListener("submit", (e) => {
        e.preventDefault();
        const form = e.target as HTMLFormElement;
        this.apiKey = (form.elements.namedItem("key") as HTMLInputElement).value.trim();
        if ((form.elements.namedItem("remember") as HTMLInputElement).checked) {
          try {
            localStorage.setItem(KEY_STORAGE, this.apiKey);
          } catch {
            // Storage blocked: the key just won't be remembered.
          }
        }
        this.render();
      });
      return;
    }
    this.host.innerHTML = `
      <div class="chat">
        <div class="chat-log" aria-live="polite"></div>
        <div class="chat-quick">
          <button data-q="What exactly will the next instruction do, and why is it there?">Next instruction?</button>
          <button data-q="Explain the main formula of this level using the values in my program.">Explain the formula</button>
          <button data-q="Which research papers introduced the ideas in this level? Search the web to confirm them.">Papers</button>
          <button data-q="Give me a hint for this level's challenge, without the answer.">Hint</button>
        </div>
        <form class="chat-form">
          <textarea rows="2" placeholder="Ask about the code, the machine, the math..." aria-label="Question"></textarea>
          <div class="chat-actions">
            <label class="small"><input type="checkbox" name="web" checked> Web search</label>
            <span class="spacer"></span>
            <button type="button" class="link small" data-act="new">New chat</button>
            <button type="button" class="link small" data-act="forget">Forget key</button>
            <button type="submit">Ask</button>
          </div>
        </form>
      </div>`;
    this.log = this.host.querySelector(".chat-log")!;
    this.input = this.host.querySelector("textarea")!;
    this.host.querySelector("form")!.addEventListener("submit", (e) => {
      e.preventDefault();
      this.ask(this.input.value);
    });
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.ask(this.input.value);
      }
    });
    this.host.querySelector(".chat-quick")!.addEventListener("click", (e) => {
      const q = (e.target as HTMLElement).closest<HTMLElement>("[data-q]")?.dataset.q;
      if (q) this.ask(q);
    });
    this.host.querySelector("[data-act=new]")!.addEventListener("click", () => {
      this.messages = [];
      this.log.innerHTML = "";
    });
    this.host.querySelector("[data-act=forget]")!.addEventListener("click", () => {
      this.apiKey = "";
      this.messages = [];
      try {
        localStorage.removeItem(KEY_STORAGE);
      } catch {
        // nothing stored
      }
      this.render();
    });
    if (this.messages.length === 0) {
      this.log.innerHTML = `<div class="muted small">Ask anything. Each question includes a snapshot of your code and the machine.</div>`;
    }
  }

  async ask(question: string) {
    question = question.trim();
    if (!question || this.busy || !this.enabled) return;
    this.busy = true;
    this.input.value = "";
    if (this.messages.length === 0) this.log.innerHTML = "";
    this.bubble("user").textContent = question;
    const answer = this.bubble("assistant");
    answer.innerHTML = `<div class="status muted small">Thinking…</div><details class="reasoning" hidden><summary>Reasoning summary</summary><div></div></details><div class="answer"></div><div class="sources"></div>`;
    const status = answer.querySelector<HTMLElement>(".status")!;
    const reasoning = answer.querySelector<HTMLElement>(".reasoning")!;
    const out = answer.querySelector<HTMLElement>(".answer")!;
    const web = (this.host.querySelector<HTMLInputElement>("input[name=web]")?.checked ?? false);

    // History is append-only: earlier turns are sent back exactly as they were.
    this.messages.push({
      role: "user",
      content: [
        { type: "text", text: `<ide>\n${this.opts.context()}\n</ide>` },
        { type: "text", text: question },
      ],
    });

    let text = "";
    const sources = new Map<string, string>();
    // The SDK is only downloaded the first time someone asks a question.
    let sdk: typeof Anthropic | null = null;
    try {
      sdk = (await import("@anthropic-ai/sdk")).default;
      const client = new sdk({ apiKey: this.apiKey, dangerouslyAllowBrowser: true });
      for (let turn = 0; turn < 4; turn++) {
        const stream = client.beta.messages.stream({
          model: MODEL,
          max_tokens: 64000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          thinking: { type: "adaptive", display: "summarized" },
          output_config: { effort: "medium" },
          system: SYSTEM,
          messages: this.messages,
          tools: web ? [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }] : undefined,
        });
        for await (const event of stream) {
          if (event.type === "content_block_start" && event.content_block.type === "server_tool_use") {
            status.textContent = "Searching the web…";
          } else if (event.type === "content_block_delta" && event.delta.type === "thinking_delta") {
            reasoning.hidden = false;
            reasoning.querySelector("div")!.textContent += event.delta.thinking;
          } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            status.textContent = "";
            text += event.delta.text;
            out.innerHTML = renderMarkdown(text);
            this.log.scrollTop = this.log.scrollHeight;
          }
        }
        const message = await stream.finalMessage();
        this.messages.push({ role: "assistant", content: message.content });
        for (const block of message.content) {
          if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
            for (const r of block.content) sources.set(r.url, r.title);
          }
          if (block.type === "text") {
            for (const c of block.citations ?? []) {
              if (c.type === "web_search_result_location") sources.set(c.url, c.title ?? c.url);
            }
          }
        }
        if (message.stop_reason === "refusal") {
          out.innerHTML += `<p class="muted">The model declined to answer this one. Try rephrasing the question.</p>`;
          break;
        }
        // A long server-side search can pause the turn; sending it back continues it.
        if (message.stop_reason !== "pause_turn") break;
      }
      status.textContent = "";
    } catch (err) {
      this.messages.pop();
      status.textContent = "";
      out.innerHTML = `<p class="error-text">${escapeHtml(describeError(err, sdk))}</p>`;
    } finally {
      this.busy = false;
    }
    if (sources.size) {
      answer.querySelector(".sources")!.innerHTML =
        `<div class="muted small">Sources</div>` +
        [...sources].map(([url, title]) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title || url)}</a>`).join("");
    }
    this.log.scrollTop = this.log.scrollHeight;
  }

  private bubble(role: "user" | "assistant"): HTMLElement {
    const el = document.createElement("div");
    el.className = `msg ${role}`;
    this.log.appendChild(el);
    return el;
  }
}

function describeError(err: unknown, sdk: typeof Anthropic | null): string {
  if (!sdk) return `Couldn't load the Anthropic SDK: ${String(err)}`;
  const Anthropic = sdk;
  if (err instanceof Anthropic.AuthenticationError) return "That API key was rejected. Use “Forget key” and paste a valid one.";
  if (err instanceof Anthropic.PermissionDeniedError) return "This API key doesn't have access to that model or feature.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited. Wait a moment and ask again.";
  if (err instanceof Anthropic.BadRequestError) return `The request was rejected: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach api.anthropic.com. Check your connection.";
  if (err instanceof Anthropic.APIError) return `API error ${err.status ?? ""}: ${err.message}`;
  return String(err);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function math(tex: string, display: boolean): string {
  return katex.renderToString(tex, { displayMode: display, throwOnError: false });
}

/** Just enough Markdown for tutor answers: code, math, bold, lists, paragraphs. */
export function renderMarkdown(src: string): string {
  const parts = src.split(/```[a-z]*\n?/);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return `<pre class="code-block">${escapeHtml(part.replace(/\n$/, ""))}</pre>`;
      const stash: string[] = [];
      const keep = (html: string) => `\u0000${stash.push(html) - 1}\u0000`;
      let s = part
        .replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => keep(math(t, true)))
        .replace(/\$([^$\n]+?)\$/g, (_, t) => keep(math(t, false)))
        .replace(/`([^`\n]+)`/g, (_, t) => keep(`<code>${escapeHtml(t)}</code>`));
      s = escapeHtml(s)
        .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
        .replace(/^#{1,6} (.*)$/gm, "<b>$1</b>")
        .replace(/^\s*[-*] (.*)$/gm, "<li>$1</li>")
        .replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, "<ul>$1</ul>")
        .split(/\n{2,}/)
        .map((p) => (p.trim() ? (p.startsWith("<ul>") ? p : `<p>${p.replace(/\n/g, "<br>")}</p>`) : ""))
        .join("");
      return s.replace(/\u0000(\d+)\u0000/g, (_, n) => stash[Number(n)]);
    })
    .join("");
}
