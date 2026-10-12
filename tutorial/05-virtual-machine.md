# 5. The virtual machine

The VM executes bytecode. Most VMs are written to run as fast as possible with their state hidden away. Ours has one extra requirement: **it must be able to stop after any instruction and show everything**. That shapes the design: all state is in plain public fields, and execution is one `step()` at a time.

## The machine's state

```rust
pub struct Vm {
    pub prog: Program,
    /// Instruction pointer: the address of the next instruction to run.
    pub ip: usize,
    pub stack: Vec<Value>,
    pub frames: Vec<Frame>,
    pub globals: Vec<Value>,
    pub heap: Vec<Obj>,
    /// The constant pool, turned into values (strings are put on the heap).
    pub consts: Vec<Value>,
    pub output: String,
    pub status: Status,
    pub error: Option<RuntimeError>,
    pub steps: u64,
    pub breakpoints: Vec<u32>,
    // ... charts (chapter 9), last_line, rng
}

/// One active function call.
pub struct Frame {
    pub func: u16,
    /// Stack index of the frame's slot 0 (its first parameter).
    pub base: usize,
    /// Where to continue in the caller after `RETURN`.
    pub ret_ip: usize,
}
```

`stack` is a `Vec<Value>`, and since `Value` is `#[repr(transparent)]` over a `u64`, that's literally a contiguous array of 64-bit words in memory. In chapter 6 the browser will read those words straight out of WebAssembly memory.

## Fetch, decode, execute

The heart of every CPU and every VM:

```rust
fn exec(&mut self) -> Result<(), String> {
    let start = self.ip;
    let code = self.read_u8();          // fetch, and move ip past the opcode
    match code {                        // decode
        HALT => {
            self.ip = start;
            self.status = Status::Halted;
        }
        CONST => {
            let k = self.read_u16() as usize;
            let v = self.consts[k];
            self.push(v)?;
        }
        GET_LOCAL => {
            let slot = self.base() + self.read_u16() as usize;
            let v = self.stack[slot];
            self.push(v)?;
        }
        SET_LOCAL => {
            let slot = self.base() + self.read_u16() as usize;
            self.stack[slot] = self.pop();
        }
        JUMP => {
            self.ip = self.read_u16() as usize;
        }
        JUMP_IF_FALSE => {
            let target = self.read_u16() as usize;
            if !self.pop().is_truthy() {
                self.ip = target;
            }
        }
        // ... one arm per opcode
        _ => return Err(format!("unknown opcode 0x{code:02x}")),
    }
    Ok(())
}
```

`read_u16` reassembles the little-endian operand: `lo | hi << 8`. Locals are addressed relative to the current frame's `base`, so the same function code works at any recursion depth.

`step()` wraps `exec` and turns an `Err` into a stopped machine with a **runtime error that points at source code**: we know which instruction failed, and `prog.spans` knows where that instruction came from.

```rust
pub fn step(&mut self) {
    let start = self.ip;
    let line = self.line();
    match self.exec() {
        Ok(()) => {
            self.steps += 1;
            self.last_line = line;
        }
        Err(msg) => {
            self.ip = start;
            self.status = Status::Error;
            self.error = Some(RuntimeError { msg, span: self.prog.spans[start] });
        }
    }
}
```

## Calls and returns

`CALL` doesn't copy arguments anywhere. The caller already pushed them, so the new frame's `base` just points at the first one:

```rust
CALL => {
    let f = self.read_u16();
    let argc = self.read_u8() as usize;
    if self.frames.len() >= MAX_FRAMES {
        return Err(format!(
            "stack overflow: more than {MAX_FRAMES} nested calls (is a recursive function missing its base case?)"
        ));
    }
    self.frames.push(Frame { func: f, base: self.stack.len() - argc, ret_ip: self.ip });
    self.ip = self.prog.functions[f as usize].entry;
}
RETURN => {
    let v = self.pop();
    let Some(frame) = self.frames.pop() else {
        return Err("`return` outside of a function".into());
    };
    self.stack.truncate(frame.base);   // drop the whole frame at once
    self.push(v)?;
    self.ip = frame.ret_ip;
}
```

That `truncate` is why returning from a function is cheap no matter how many locals it had, and why "stack allocation" is fast in real languages.

## The heap and references

`ARRAY n` pops *n* values into a new heap object and pushes a NaN-boxed reference. Indexing follows that reference, with errors written for humans:

```rust
pub fn check_index(&self, array: Value, index: Value) -> Result<usize, String> {
    let len = match self.obj(array) {
        Some(Obj::Array(items)) => items.len(),
        _ => return Err(format!("cannot index into {} (only arrays can be indexed)", self.type_name(array))),
    };
    if !index.is_num() {
        return Err(format!("an array index must be a number, not {}", self.type_name(index)));
    }
    let i = index.as_num();
    if i.fract() != 0.0 || i < 0.0 || i >= len as f64 {
        let valid = if len == 0 { "the array is empty".to_string() } else { format!("valid indexes are 0 to {}", len - 1) };
        return Err(format!("index {} is out of bounds: {valid}", format_num(i)));
    }
    Ok(i as usize)
}
```

There's no garbage collector: objects are never freed. That's fine for programs that run for a few seconds, and it keeps heap addresses stable, so `@3` means the same object for the whole run. Chapter 12 sketches how to add a mark-and-sweep collector.

Arithmetic is only defined on numbers, except that `+` joins strings. Division by zero is *not* an error: IEEE-754 says `1/0` is `Infinity` and `0/0` is `NaN`, and level 2 wants you to see that.

## Built-ins

Functions like `print`, `exp`, `len` and `random` are implemented in Rust. `BUILTIN id argc` pops the arguments and calls `Vm::builtin`. One design choice matters for teaching: `random()` is a tiny **xorshift** generator with a fixed seed, so a neural network's "random" initial weights are the same on every run, and you can step through training and get the same result as the person next to you.

```rust
"random" => {
    // xorshift64: a tiny pseudo-random generator. The seed is fixed
    // in `reset`, so every run sees the same "random" numbers.
    self.rng ^= self.rng << 13;
    self.rng ^= self.rng >> 7;
    self.rng ^= self.rng << 17;
    Ok(Value::num((self.rng >> 11) as f64 / (1u64 << 53) as f64))
}
```

## Running, pausing, breakpoints

The IDE drives the machine with three calls:

- `step()`: exactly one instruction.
- `run(max, use_breakpoints)`: up to `max` instructions, stopping early on halt, error, or arrival at a breakpoint line.
- `step_line(max)`: run until the source line changes.

A breakpoint should fire when execution *arrives* at a line, not on every instruction within it, so `run` compares each instruction's line with the line of the instruction that just ran:

```rust
pub fn run(&mut self, max: u32, use_breakpoints: bool) -> Status {
    if self.finished() {
        return self.status;
    }
    let resuming = self.status == Status::Breakpoint;
    for n in 0..max {
        if use_breakpoints && (n > 0 || (self.steps == 0 && !resuming)) {
            let line = self.line();
            if line != self.last_line && self.breakpoints.contains(&line) {
                self.status = Status::Breakpoint;
                return self.status;
            }
        }
        self.step();
        if self.finished() {
            return self.status;
        }
    }
    self.status = Status::Paused;
    self.status
}
```

The first instruction of a call is never checked (`n > 0`). Otherwise, pressing Run while stopped at a breakpoint would stop again immediately without moving. The exception is the very start of the program, so a breakpoint on the first line still works.

## A command-line runner

`core/src/main.rs` is about 80 lines: read a file, `load()` it, optionally print the disassembly, then run in chunks and print the output. With `--trace` it prints every instruction with the stack beside it:

```text
$ cargo run --release -- ../examples/01_hello.bl --trace
0000  CONST #0  (6)                []
0003  SET_GLOBAL 0  (x)            [6]
0006  CONST #1  (7)                []
0009  SET_GLOBAL 1  (y)            [7]
0012  GET_GLOBAL 0  (x)            []
0015  GET_GLOBAL 1  (y)            [6]
0018  MUL                          [6, 7]
0019  SET_GLOBAL 2  (answer)       [42]
...
```

Errors print the way compilers do, with a caret under the culprit:

```text
$ cargo run -- oops.bl
oops.bl:2:7: runtime error: index 2 is out of bounds: valid indexes are 0 to 1
  print(a[2]);
        ^^^^
```

## Checkpoint

```bash
cd core
cargo test
for f in ../examples/*.bl; do cargo run --release -q -- "$f"; done
```

`tests/language.rs` checks the language feature by feature (scopes, recursion, short-circuiting, references, error messages, breakpoints, and that the stack is empty after every statement). `tests/examples.rs` runs all 13 level programs and checks their results; for example, that the neural network really learns XOR.

## Exercises

1. Add a `--stats` flag that prints how often each opcode ran. Which instruction dominates the backprop level?
2. Rewrite the dispatch as a table of function pointers. Is it faster? Measure with `steps()`.
3. Make the stack limit configurable and watch `fib(100000)` overflow.

Next: [The WebAssembly bridge →](06-webassembly-bridge.md)
