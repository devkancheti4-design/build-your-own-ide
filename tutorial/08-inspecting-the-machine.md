# 8. Inspecting the machine

Now the part that makes it an IDE for *understanding*: panels that show the machine's state after every step, a bit-level inspector, and an explainer that says in plain English what the next instruction will do.

## One snapshot per step

After each step, run or breakpoint, the page calls `engine.state()` and redraws from the JSON. The VM never pushes updates; the UI always pulls a complete snapshot. That keeps the two sides independent and makes "pause anywhere" trivial.

Here's a real snapshot (from `state_json` in `core/src/inspect.rs`), taken seven steps into level 1, just after `x * y`. It's trimmed to one global and with output omitted:

```json
{
  "status": "paused", "ip": 19, "steps": 7, "line": 7, "span": [182, 200], "error": null,
  "explain": "Pop 42 and store it in the global variable `answer` (globals table entry 2).",
  "frames": [{ "name": "<main>", "base": 0, "ip": 19, "ret": 0 }],
  "stack": [{ "bits": "4045000000000000", "kind": "num", "addr": 1121624, "text": "42", "frame": 0, "name": null }],
  "globals": [{ "name": "x", "bits": "4018000000000000", "kind": "num", "addr": 1117472, "text": "6" }],
  "heap": [], "heapTotal": 4, "chartsVersion": 1, "output": ""
}
```

(`heapTotal` is 4 because the program's string literals are allocated on the heap at startup.)

## Names on the stack

Raw slots are hard to read, so each stack value gets a variable name when it has one. This is where the compiler's debug info pays off. For a value in frame *f* at stack index *i*, the slot number is `i - base`, and the function's current instruction tells us which variable owns that slot right now:

```rust
// Each frame's "current" instruction: the top frame is at `ip`, every
// other frame is waiting at the return address saved by its callee.
let frame_ip = |i: usize| if i + 1 < vm.frames.len() { vm.frames[i + 1].ret_ip } else { vm.ip };

for (i, &v) in vm.stack.iter().enumerate() {
    let fi = vm.frames.iter().rposition(|f| f.base <= i).unwrap_or(0);
    let f = vm.frames[fi];
    // ...
    match p.local_name(f.func, (i - f.base) as u16, frame_ip(fi)) {
        Some(name) => string(&mut out, name),
        None => out.push_str("null"),   // a temporary: half of an expression
    }
}
```

Values without a name are **temporaries**, the in-between results of an expression like `w * x` before the `+ b` arrives. The Stack panel (`web/src/machine.ts`) groups slots by frame, newest on top, so stepping into recursive `fib` shows frames piling up with their return addresses.

## The Bits panel

`web/src/bits.ts` takes one 64-bit value and explains it completely.

**Decoding the fields** is a few shifts with `BigInt`, JavaScript's arbitrary-precision integers (a normal JS number can't hold 64 bits):

```ts
const s = Number(bits >> 63n);
const e = Number((bits >> 52n) & 0x7ffn);
const m = bits & ((1n << 52n) - 1n);
```

**The exact decimal value.** `print` shows `0.1`, the *shortest* decimal that rounds back to these bits. But every double is a finite binary fraction, so it has an exact decimal expansion too. A double is `n × 2^e` for some integer `n`, and when `e` is negative, `n / 2^k = n × 5^k / 10^k`, which is pure integer arithmetic:

```ts
export function exactDecimal(bits: bigint): string {
  // ... sign, special cases for NaN, Infinity and zero
  // value = n × 2^e2, with n an integer
  const n = exp === 0 ? mant : mant | (1n << 52n);
  const e2 = exp === 0 ? -1074 : exp - 1075;
  if (e2 >= 0) {
    text = (n << BigInt(e2)).toString();
  } else {
    // n / 2^k = n × 5^k / 10^k
    const k = -e2;
    const digits = (n * 5n ** BigInt(k)).toString().padStart(k + 1, "0");
    const whole = digits.slice(0, digits.length - k);
    const frac = digits.slice(digits.length - k).replace(/0+$/, "");
    text = frac ? `${whole}.${frac}` : whole;
  }
  // ...
}
```

So clicking `0.1` reveals `0.1000000000000000055511151231257827021181583404541015625`.

**Neighbours.** For positive doubles, adding 1 to the bit pattern gives the next larger double. That's a lovely property of IEEE-754's layout. The panel offers "next double up / down" buttons and prints the gap between them (one *ulp*). Click `0.30000000000000004` and step down once: you land on `0.3`, the double that `0.1 + 0.2` just missed.

**What-if bit flipping.** Every bit is a button. Clicking one flips it in a local copy and shows what those bits would mean: a different number, `Infinity`, `NaN`, or even `nil` or a heap pointer once you hit the NaN-box patterns. The machine itself isn't changed.

**Real memory.** Finally the panel reads the 8 bytes at the value's address straight out of wasm memory (chapter 6) and shows them in little-endian order. If they don't match the snapshot's bits, the value has moved since, and the panel says so.

## The explainer: a tutor without AI

`core/src/explain.rs` turns "the next instruction" into a sentence using the **actual values** on the stack. One `match` arm per opcode:

```rust
SUB | MUL | DIV | MOD | LT | LE | GT | GE => {
    let (a, b) = (peek(1), peek(0));
    match vm.arith(code, a, b) {
        Ok(r) => {
            let mut text = format!(
                "Pop {} and {}, compute {} {} {} = {}, and push the result.",
                show(a), show(b), show(a), op::symbol(code), show(b), show(r)
            );
            if code == DIV && b.as_num() == 0.0 {
                text.push_str(" Dividing by zero is not an error for floating-point numbers: ...");
            }
            text
        }
        Err(e) => format!("This is about to fail: {e}."),
    }
}
```

Because `Vm::arith` is a pure function, the explainer can preview the result before the instruction runs, and even warn that the next instruction will fail.

For addition it goes one step further and detects **rounding**. The TwoSum algorithm (Knuth) recovers the exact error of a floating-point sum using only floating-point operations:

```rust
fn rounding_note(a: f64, b: f64, sum: f64) -> &'static str {
    // TwoSum (Knuth): recovers the rounding error of a floating-point addition.
    let bb = sum - a;
    let error = (a - (sum - bb)) + (b - bb);
    if sum.is_finite() && error != 0.0 {
        " The exact sum has no 64-bit representation, so the hardware rounds it to the nearest double. ..."
    } else {
        ""
    }
}
```

Step to the `ADD` in `0.1 + 0.2` and the explainer tells you that rounding is about to happen, before you see the `4` at the end.

## Checkpoint

The test suite checks that explanations use real values and catch the rounding:

```rust
#[test]
fn explainer_uses_real_values() {
    let mut vm = load("let a = 0.1; let b = 0.2; let c = a + b;").unwrap();
    while !explain(&vm).starts_with("Pop 0.1 and 0.2, add them") {
        vm.step();
        assert!(!vm.finished());
    }
    assert!(explain(&vm).contains("push 0.30000000000000004"));
    assert!(explain(&vm).contains("rounds it"));
}
```

In the browser, open level 2, step to the addition, click the result on the stack, and press "next double down".

## Exercises

1. Show `ulp(x) / x` (the relative precision) in the Bits panel. Plot it for x = 1, 10, 100… What do you notice?
2. Highlight in the Heap panel every object reachable from the selected value. That's half of a garbage collector.

Next: [Charts and machine learning →](09-charts-and-ml.md)
