# 11. The AI tutor

The built-in explainer (chapter 8) is deterministic and always right about what the machine is doing. It can't answer *why* questions, though: "why does Adam need bias correction?" or "what would happen if I removed the √d?". For those, Bitlens has an **optional** AI tutor that sees exactly what you see.

It's off by default. Nothing leaves the browser until you paste your own Anthropic API key and press **Turn on**. The key is sent only to `api.anthropic.com`, and it's stored only if you tick "Remember on this device".

## Calling the API from the browser

`web/src/chat.ts` uses the official TypeScript SDK:

```bash
npm install @anthropic-ai/sdk
```

API keys normally belong on a server. Here, each learner brings their own key to their own browser, so calling the API directly is reasonable, and the SDK makes you say so explicitly:

```ts
const client = new Anthropic({ apiKey: this.apiKey, dangerouslyAllowBrowser: true });
```

## Giving the model the machine's state

Every question is sent with an `<ide>` block built by `buildContext()` in `main.ts`: the level and its challenge, the machine's status, the next instruction with the explainer's sentence, the top of the stack with names and raw bits, the globals, the value selected in the Bits panel, recent output, and the numbered source code. Abridged, it looks like this:

```text
Level 5: Gradient descent. Challenge: Get the loss below 0.00001 ...
Machine: paused, 1043 instructions executed, source line 21.
Next instruction: 0112 MUL. Pop 0.04 and -3.2, compute 0.04 * -3.2 = -0.128, and push the result.
Stack, top first (3 values, 1 frames): temp = -3.2 (0xc0099999...); temp = 0.04 (...); dw = ...
Globals: xs = [1, 2, 3, 4, 5]; ys = [3, 5, 7, 9, 11]; n = 5; w = 0.31; ...
Program source:
  1  // Level 5: Gradient descent
  ...
```

So "why is this number negative?" gets an answer about *your* `err`, at *this* instruction.

## Streaming, thinking and web search

```ts
const stream = client.beta.messages.stream({
  model: "claude-opus-5-5",
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
    reasoning.querySelector("div")!.textContent += event.delta.thinking;
  } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
    text += event.delta.text;
    out.innerHTML = renderMarkdown(text);
  }
}
const message = await stream.finalMessage();
```

- **Streaming** shows the answer as it's written.
- **Adaptive thinking** with `display: "summarized"` lets the tutor reason before answering, and shows a collapsible summary of that reasoning. That's a nice fit for a tool about seeing what's normally hidden.
- **Web search** is a server-side tool: the API runs the searches itself, and the results come back as `web_search_tool_result` blocks and as citations on text blocks. We collect their URLs into a "Sources" list under each answer. That's how "Which papers introduced this?" gets checked answers instead of half-remembered ones.
- **Fallbacks.** `fallbacks: "default"` (with its beta flag) lets the API retry on a fallback model if a request is declined by a safety classifier, instead of failing outright. If the whole chain declines, `stop_reason` is `"refusal"` and the panel says so.
- **Paused turns.** A long search can end a turn with `stop_reason: "pause_turn"`. Sending the conversation back as-is continues it, so the code loops up to four times.

## Conversation history is append-only

The API is stateless: each request sends the whole conversation. Each user turn includes that turn's `<ide>` snapshot, and each assistant turn is stored exactly as returned, including its thinking blocks. We never edit earlier turns. The model's reasoning is tied to the exact conversation it was produced in, so rewriting history would invalidate it. Instead, every question simply carries its own fresh snapshot.

## Rendering answers

Answers use a little Markdown and LaTeX. `renderMarkdown()` handles code blocks, inline code, bold, lists and paragraphs, and renders `$…$` and `$$…$$` with KaTeX, the same as the lesson formulas. Math and code are pulled out into placeholders *before* HTML-escaping and put back afterwards, so nothing the model writes is ever inserted as raw HTML.

## Checkpoint

Open any level, switch the assistant panel to **Ask AI**, paste a key, and try the quick buttons: "Next instruction?", "Explain the formula", "Papers" (watch it search) and "Hint". Errors are mapped to plain advice: a rejected key, a rate limit, or no connection.

Next: [Where to go next →](12-where-next.md)
