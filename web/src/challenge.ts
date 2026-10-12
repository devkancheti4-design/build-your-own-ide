// Challenges are checked by the machine itself: we append a few lines of
// Bitlens to your program, run everything to the end, and read the global
// `__check` that those lines set.

import type { Engine } from "./engine.ts";
import type { Level } from "./levels.ts";

export interface CheckResult {
  passed: boolean;
  message: string;
}

const MAX_STEPS = 200_000_000;

export function checkChallenge(engine: Engine, source: string, level: Level): CheckResult {
  engine.setBreakpoints([]);
  const program = engine.compile(`${source}\n\n// challenge check\n${level.challenge.check}\n`);
  if (!program.ok) {
    return { passed: false, message: `The check couldn't compile with your code: ${program.error.msg}.` };
  }
  let state = engine.state();
  while (state && state.status !== "halted" && state.status !== "error" && state.steps < MAX_STEPS) {
    engine.run(5_000_000);
    state = engine.state();
  }
  if (!state || state.status === "error") {
    return { passed: false, message: `Your program stopped with an error: ${state?.error?.msg ?? "unknown"}.` };
  }
  if (state.status !== "halted") {
    return { passed: false, message: "Your program ran for too long (over 200 million instructions)." };
  }
  const result = state.globals.find((g) => g.name === "__check");
  const truthy = !!result && result.kind !== "nil" && !(result.kind === "bool" && result.text === "false");
  return truthy
    ? { passed: true, message: `Challenge complete in ${state.steps.toLocaleString()} instructions.` }
    : { passed: false, message: "Not yet. The program ran, but the goal isn't met." };
}
