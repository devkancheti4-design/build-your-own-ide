// Checks every level from the command line: each starting program must run
// cleanly and fail its challenge, and each built-in solution must pass it.
//
//     npm run verify

import { readFileSync } from "node:fs";

import { checkChallenge } from "../src/challenge.ts";
import { loadEngine } from "../src/engine.ts";
import { LEVELS, applySolution } from "../src/levels.ts";

const root = new URL("../", import.meta.url);
const engine = await loadEngine(readFileSync(new URL("public/bitlens.wasm", root)));
let failures = 0;

for (const level of LEVELS) {
  const source = readFileSync(new URL(`../examples/${level.file}`, root), "utf8");
  for (const s of level.challenge.solution) {
    if (!source.includes(s[0])) {
      console.log(`level ${level.id}: solution text not found: ${JSON.stringify(s[0])}`);
      failures++;
    }
  }
  const before = checkChallenge(engine, source, level);
  const after = checkChallenge(engine, applySolution(source, level), level);
  const ok = !before.passed && after.passed && !before.message.includes("error");
  if (!ok) failures++;
  console.log(
    `${ok ? "ok  " : "FAIL"} level ${String(level.id).padStart(2)} ${level.title.padEnd(26)} start: ${before.message}  solution: ${after.message}`,
  );
}

if (failures > 0) {
  console.log(`\n${failures} problem(s)`);
  process.exit(1);
}
console.log("\nall levels verified");
