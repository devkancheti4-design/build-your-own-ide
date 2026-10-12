// XP, ranks, saved code and the "predict the next value" mini-game.
// Progress lives in this browser only.

import { formatNumber } from "./bits.ts";
import type { Instr, State } from "./types.ts";

const STORAGE = "bitlens.progress.v1";

export const XP_CHALLENGE = 150;
export const XP_PREDICT = 10;

export interface Progress {
  xp: number;
  done: number[];
  visited: number[];
  predict: { right: number; total: number; streak: number; best: number };
  code: Record<string, string>;
}

const fresh = (): Progress => ({ xp: 0, done: [], visited: [], predict: { right: 0, total: 0, streak: 0, best: 0 }, code: {} });

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(STORAGE);
    return raw ? { ...fresh(), ...JSON.parse(raw) } : fresh();
  } catch {
    return fresh();
  }
}

export function saveProgress(p: Progress) {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(p));
  } catch {
    // Storage unavailable (private window): progress lasts for this visit only.
  }
}

const RANKS = [
  [0, "Bit"],
  [100, "Nibble"],
  [250, "Byte"],
  [450, "Word"],
  [700, "Register"],
  [1000, "Stack frame"],
  [1350, "Compiler"],
  [1750, "Neuron"],
  [2200, "Transformer"],
] as const;

export function rank(xp: number): { name: string; next: number | null; floor: number } {
  let i = RANKS.length - 1;
  while (RANKS[i][0] > xp) i--;
  return { name: RANKS[i][1], floor: RANKS[i][0], next: i + 1 < RANKS.length ? RANKS[i + 1][0] : null };
}

// ---- Predict mode ----

export interface Quiz {
  question: string;
  options: string[];
  answer: number;
  explain: string;
}

const ASK = new Set(["ADD", "SUB", "MUL", "DIV", "MOD", "NEG", "NOT", "EQ", "NE", "LT", "LE", "GT", "GE", "GET_INDEX", "GET_LOCAL", "GET_GLOBAL", "RETURN", "BUILTIN"]);

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** Build a question about the instruction that just ran, from the states before and after it. */
export function makeQuiz(before: State, after: State, instr: Instr): Quiz | null {
  const op = instr.text.split(" ")[0];
  if (after.status === "error") return null;
  if (op === "JUMP_IF_FALSE") {
    const cond = before.stack[before.stack.length - 1]?.text ?? "nil";
    const jumped = after.ip !== instr.ip + 3;
    return {
      question: `The condition on top of the stack is ${cond}. Will JUMP_IF_FALSE jump?`,
      options: ["Yes, it jumps", "No, it carries on"],
      answer: jumped ? 0 : 1,
      explain: jumped ? "Only false and nil count as false, and this condition was one of them." : "The condition was truthy, so execution falls through to the next instruction.",
    };
  }
  if (!ASK.has(op) || (op === "BUILTIN" && /print|plot|scatter|heatmap|clearplot|push/.test(instr.text))) return null;
  const top = after.stack[after.stack.length - 1];
  if (!top) return null;
  const answer = top.text;

  const pool = new Set<string>();
  const nums = before.stack.slice(-2).filter((v) => v.kind === "num").map((v) => Number(v.text));
  if (nums.length === 2) {
    const [a, b] = nums;
    for (const n of [a + b, a - b, b - a, a * b, a / b, b / a, a % b]) pool.add(formatNumber(n));
  }
  for (const v of before.stack.slice(-4)) pool.add(v.text);
  for (const g of before.globals.slice(0, 8)) pool.add(g.text);
  if (/^(true|false)$/.test(answer)) pool.add(answer === "true" ? "false" : "true");
  if (top.kind === "num") {
    const n = Number(answer);
    for (const d of [n + 1, n - 1, -n, n * 2]) pool.add(formatNumber(d));
  }
  pool.add("nil");
  pool.delete(answer);
  const distractors = shuffle([...pool].filter((t) => t.length < 40)).slice(0, 3);
  const options = shuffle([answer, ...distractors]);
  return {
    question: `What will be on top of the stack after ${instr.text}?`,
    options,
    answer: options.indexOf(answer),
    explain: before.explain,
  };
}
