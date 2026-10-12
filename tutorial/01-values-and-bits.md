# 1. Values and bits

Every language implementation has to answer one question before anything else: **what does a value look like in memory?** Our answer drives the whole machine, and it's what the IDE's Bits panel puts on screen, so we start here.

Create the crate:

```bash
cargo new --lib core
cd core
```

Set it up to build both a normal Rust library (for tests and the command-line runner) and a WebAssembly module (`cdylib`) in `core/Cargo.toml`:

```toml
[package]
name = "bitlens-core"
version = "0.1.0"
edition = "2024"

[lib]
crate-type = ["cdylib", "rlib"]

[[bin]]
name = "bitlens"
path = "src/main.rs"

[profile.release]
opt-level = "s"
lto = true
```

## Numbers are IEEE-754 doubles

Bitlens has a single number type, the same one JavaScript uses and the default in most ML code: the 64-bit IEEE-754 double. It's scientific notation in base 2:

```text
 bit 63   bits 62..52        bits 51..0
┌──────┬──────────────┬───────────────────────────────────────────────┐
│ sign │ exponent (11)│ mantissa (52)                                 │
└──────┴──────────────┴───────────────────────────────────────────────┘
value = (-1)^sign × 1.mantissa × 2^(exponent - 1023)
```

Take `42`. In binary it's `101010` = `1.01010 × 2^5`. So the sign is 0, the exponent is `5 + 1023 = 1028` = `10000000100`, and the mantissa holds the bits after the point, `0101 0000…`. Put together that's `0x4045000000000000`, which is exactly what the Bits panel will show you.

`0.1` is less polite. In binary it's `0.000110011001100…` repeating forever, so the mantissa gets cut off after 52 bits and rounded. The double you actually get is

```text
0.1000000000000000055511151231257827021181583404541015625
```

and every arithmetic operation rounds its exact result to the nearest double. That's the whole story behind `0.1 + 0.2 == 0.30000000000000004`, and level 2 of the game lets you poke at it bit by bit.

## Everything else hides in NaN

Numbers alone aren't enough: we also need `nil`, `true`, `false`, and references to arrays and strings on the heap. The textbook approach is a tagged enum, a type tag next to a payload, which takes 16 bytes per value.

We'll use **NaN-boxing** instead, a trick used by LuaJIT and by JavaScript engines. An IEEE-754 double whose exponent bits are all 1 and whose mantissa is non-zero is a NaN, "not a number". There are about 2^52 different NaN bit patterns, but arithmetic only ever produces one of them. So we can claim the rest:

```text
                 sign exponent    mantissa
0.1            = 0    01111111011 1001100110011001100110011001100110011001100110011010
nil            = 0    11111111111 1100000000000000000000000000000000000000000000000001
true           = 0    11111111111 1100000000000000000000000000000000000000000000000011
heap ref @7    = 1    11111111111 1100000000000000000000000000000000000000000000000111
```

If bits 50 to 62 are all set (the `QNAN` mask), the word isn't a number. If the sign bit is also set, it's a pointer to heap object number *n*, stored in the low 32 bits. Otherwise the low bits are a tag: 1 for nil, 2 for false, 3 for true.

The payoff: **every Bitlens value is exactly 64 bits**, the stack is a plain array of `u64`, and the IDE can show the true bits of anything.

Write `core/src/value.rs`:

```rust
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(transparent)]
pub struct Value(pub u64);

/// Exponent all ones plus the two highest mantissa bits: "this is not a number".
pub const QNAN: u64 = 0x7ffc_0000_0000_0000;
/// The sign bit marks a reference to an object on the heap.
pub const SIGN: u64 = 0x8000_0000_0000_0000;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Num,
    Nil,
    Bool,
    Ref,
}

impl Value {
    pub const NIL: Value = Value(QNAN | 1);
    pub const FALSE: Value = Value(QNAN | 2);
    pub const TRUE: Value = Value(QNAN | 3);

    pub fn num(n: f64) -> Value {
        // Arithmetic can produce NaN (0 / 0). Store the one standard NaN so it
        // can never be mistaken for nil, a boolean or a reference.
        if n.is_nan() { Value(f64::NAN.to_bits()) } else { Value(n.to_bits()) }
    }

    pub fn reference(addr: u32) -> Value {
        Value(SIGN | QNAN | addr as u64)
    }

    pub fn kind(self) -> Kind {
        if self.0 & QNAN != QNAN {
            Kind::Num
        } else if self.0 & SIGN != 0 {
            Kind::Ref
        } else if self == Value::NIL {
            Kind::Nil
        } else {
            Kind::Bool
        }
    }
    // ... bool(), is_num(), as_num(), as_ref(), is_truthy()
}
```

Two details are worth slowing down for.

**Why mask bits 50 and 51 too, and not just the exponent?** The standard quiet NaN that arithmetic produces is `0x7ff8000000000000`: bit 51 set, bit 50 clear. Infinity is `0x7ff0000000000000`. Requiring bit 50 as well means neither of them can ever be confused with a boxed value.

**Why canonicalize NaN in `Value::num`?** Hardware is allowed to produce NaNs with other payloads, or with the sign bit set (x86 does: `0xfff8…`). Even a negative NaN fails the `& QNAN == QNAN` test, but storing exactly one NaN pattern means we never have to think about it again.

Objects that don't fit in 64 bits live on a heap, which is just a `Vec<Obj>` in the VM. A reference is an index into it:

```rust
#[derive(Clone, Debug)]
pub enum Obj {
    Str(String),
    Array(Vec<Value>),
}
```

Finally, numbers need to print the way people expect: `3`, not `3.0`, and the shortest decimal that rounds back to the same bits. Rust's `{}` formatting for `f64` already does the shortest round-trip, so `format_num` only adds special cases for `NaN`, `±Infinity` and very large or tiny numbers:

```rust
pub fn format_num(n: f64) -> String {
    if n.is_nan() {
        return "NaN".into();
    }
    if n.is_infinite() {
        return if n > 0.0 { "Infinity".into() } else { "-Infinity".into() };
    }
    let a = n.abs();
    if a != 0.0 && !(1e-6..1e21).contains(&a) { format!("{n:e}") } else { format!("{n}") }
}
```

## Checkpoint

Add a test that pins the layout down. These exact bit patterns are what the inspector will show later:

```rust
#[test]
fn nan_boxing_layout() {
    assert_eq!(Value::num(0.1).0, 0x3fb9_9999_9999_999a);
    assert_eq!(Value::NIL.0, 0x7ffc_0000_0000_0001);
    assert_eq!(Value::TRUE.0, 0x7ffc_0000_0000_0003);
    assert_eq!(Value::reference(7).0, 0xfffc_0000_0000_0007);
    assert_eq!(Value::num(f64::NAN).kind(), Kind::Num);
    assert_eq!(Value::num(-f64::NAN).kind(), Kind::Num);
    assert_eq!(Value::num(f64::NEG_INFINITY).kind(), Kind::Num);
}
```

(In the repository this lives in `core/tests/language.rs`.)

## Exercises

1. Work out the bits of `-2.5` by hand, then check with `println!("{:016x}", (-2.5f64).to_bits())`.
2. What's the largest heap address our encoding allows? Could you use more bits?
3. Find the smallest positive double. Hint: it's a *subnormal* with exponent bits all zero.

Next: [The lexer →](02-lexer.md)
