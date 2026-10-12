# 4. The compiler

We could run the AST directly by walking the tree, an approach called a tree-walking interpreter. Instead we'll compile it to **bytecode**: a flat array of bytes for a simple machine. It's closer to what real hardware runs, and it gives the debugger something concrete to show: an address, the raw bytes, one instruction at a time.

## A stack machine

Our machine has no registers. Instructions take their inputs from the top of a **value stack** and push their results back. `w * x + b` compiles to:

```text
GET_GLOBAL w     stack: [w]
GET_LOCAL  x     stack: [w, x]
MUL              stack: [w*x]
GET_GLOBAL b     stack: [w*x, b]
ADD              stack: [w*x+b]
```

That's a post-order walk of the tree: compile the left side, compile the right side, emit the operator. The compiler never has to allocate registers or worry about which value lives where.

## The instruction set

Each instruction is one **opcode** byte, sometimes followed by **operands**. 16-bit operands are stored little-endian, low byte first, the same order WebAssembly, x86 and ARM use. `core/src/op.rs` lists them all:

| Opcode | Operands | Effect |
|---|---|---|
| `HALT` | | stop |
| `CONST` | u16 index | push a constant from the pool |
| `NIL` `TRUE` `FALSE` | | push a literal |
| `POP` | | discard the top value |
| `GET_LOCAL` / `SET_LOCAL` | u16 slot | read / write a stack slot in the current frame |
| `GET_GLOBAL` / `SET_GLOBAL` | u16 index | read / write the globals table |
| `ARRAY` | u16 count | pop *n* values, allocate an array, push a reference |
| `GET_INDEX` / `SET_INDEX` | | read / write an array element |
| `ADD` `SUB` `MUL` `DIV` `MOD` `NEG` `NOT` | | arithmetic and logic |
| `EQ` `NE` `LT` `LE` `GT` `GE` | | comparisons |
| `JUMP` | u16 address | go to an address |
| `JUMP_IF_FALSE` | u16 address | pop a condition; jump if it's false or nil |
| `CALL` | u16 function, u8 argc | start a call frame |
| `RETURN` | | end a call frame |
| `BUILTIN` | u8 id, u8 argc | call a function implemented in Rust |

```rust
pub const CONST: u8 = 0x01; // u16 constant index
pub const GET_LOCAL: u8 = 0x06; // u16 slot
// ...

/// Total size of an instruction in bytes, opcode included.
pub fn size(op: u8) -> usize {
    match op {
        CONST | GET_LOCAL | SET_LOCAL | GET_GLOBAL | SET_GLOBAL | ARRAY | JUMP | JUMP_IF_FALSE | BUILTIN => 3,
        CALL => 4,
        _ => 1,
    }
}
```

## What the compiler produces

```rust
pub struct Program {
    pub code: Vec<u8>,
    /// `spans[i]` is the source of the instruction that byte `i` belongs to.
    pub spans: Vec<Span>,
    pub constants: Vec<Constant>,
    /// Function 0 is `<main>`, the top level of the file.
    pub functions: Vec<Function>,
    pub globals: Vec<String>,
    pub locals: Vec<LocalInfo>,
    pub line_starts: Vec<u32>,
}
```

`spans` and `locals` are **debug info**. The machine never reads them, but the IDE does: `spans` says which source to highlight for each instruction, and `locals` says which stack slot holds which variable at which address, so the Stack panel can print `w` instead of `slot 3`.

Every byte goes through one function, so code and spans can never get out of step:

```rust
fn emit(&mut self, byte: u8, span: Span) {
    self.prog.code.push(byte);
    self.prog.spans.push(span);
}

fn emit_u16(&mut self, op: u8, value: u16, span: Span) {
    self.emit(op, span);
    self.emit(value as u8, span);
    self.emit((value >> 8) as u8, span);
}
```

## Variables: globals, and locals that cost nothing

Top-level `let`s become **globals**, stored in a table outside the stack. Everything else (function parameters, and `let`s inside blocks and loops) is a **local**, and locals live *on the stack itself*.

Here's the trick. When a statement finishes, it has popped everything it pushed. So at the start of every statement, the stack holds exactly the live locals, in declaration order. When we compile `let total = x + 1;` inside a block, the value of `x + 1` lands on top of the stack, in exactly the slot the next local should occupy. So we emit nothing at all:

```rust
StmtKind::Let { name, value } => {
    if self.func == 0 && self.depth == 0 {
        self.expr(value)?;
        let g = self.globals[name];
        self.emit_u16(SET_GLOBAL, g, s.span);
    } else {
        if self.locals.iter().any(|l| l.depth == self.depth && &l.name == name) {
            return err(format!("`{name}` is already declared in this block"), s.span);
        }
        self.expr(value)?;
        // No instruction needed: the value just computed sits on
        // top of the stack, and that slot *is* the variable now.
        self.add_local(name.clone());
    }
}
```

A local's **slot** is its index in the compiler's `locals` list, and looking a name up searches backwards so inner declarations shadow outer ones:

```rust
fn resolve(&self, name: &str) -> Option<Var> {
    if let Some(slot) = self.locals.iter().rposition(|l| l.name == name) {
        return Some(Var::Local(slot as u16));
    }
    self.globals.get(name).map(|&g| Var::Global(g))
}
```

When a block ends, its locals have to leave the stack, so we emit one `POP` per local and record where each variable stopped existing:

```rust
fn end_scope(&mut self, span: Span) {
    self.depth -= 1;
    while self.locals.last().is_some_and(|l| l.depth > self.depth) {
        let l = self.locals.pop().unwrap();
        self.emit(POP, span);
        self.prog.locals[l.info].to = self.prog.code.len();
    }
}
```

## Control flow is just jumps

There's no `while` in the machine. A loop is a conditional jump forward (to leave) and an unconditional jump back (to repeat):

```rust
StmtKind::While { cond, body } => {
    let start = self.prog.code.len();
    self.expr(cond)?;
    let exit = self.emit_jump(JUMP_IF_FALSE, cond.span);
    self.block(body)?;
    self.emit_u16(JUMP, start as u16, s.span);
    self.patch(exit);
}
```

When we emit the exit jump, we don't know yet where the loop ends. So `emit_jump` writes a placeholder (`0xffff`) and returns its position, and `patch` comes back to fill in the real address once we know it. This is called **backpatching**:

```rust
fn emit_jump(&mut self, op: u8, span: Span) -> usize {
    self.emit_u16(op, 0xffff, span);
    self.prog.code.len() - 2
}

fn patch(&mut self, at: usize) {
    let target = self.prog.code.len() as u16;
    self.prog.code[at] = target as u8;
    self.prog.code[at + 1] = (target >> 8) as u8;
}
```

Short-circuit `&&` is a jump too: if the left side is false, skip the right side entirely.

```rust
ExprKind::And(left, right) => {
    self.expr(left)?;
    let short_circuit = self.emit_jump(JUMP_IF_FALSE, e.span);
    self.expr(right)?;
    let end = self.emit_jump(JUMP, e.span);
    self.patch(short_circuit);
    self.emit(FALSE, e.span);
    self.patch(end);
}
```

## Functions

A program can call a function that's declared further down the file. So compilation is two passes: first collect every function name and every top-level `let`, then compile. The top-level code comes first and ends in `HALT`; each function body follows. Calling a function pushes its arguments, then emits `CALL index argc`. Inside the function, those arguments simply *are* the first locals, slots 0, 1, 2, …:

```rust
fn function(&mut self, f: &FnDecl, span: Span) -> Result<(), CompileError> {
    self.func = self.fns[&f.name];
    self.prog.functions[self.func as usize].entry = self.prog.code.len();
    self.depth = 1;
    self.locals.clear();
    // The caller pushes the arguments; they become the first locals.
    for p in &f.params {
        // ... reject duplicate parameter names
        self.add_local(p.clone());
    }
    for s in &f.body.stmts {
        self.stmt(s)?;
    }
    // Reaching the closing `}` returns nil.
    self.emit(NIL, f.body.close);
    self.emit(RETURN, f.body.close);
    // ... close the debug ranges of every local
    Ok(())
}
```

## Checkpoint: read some bytecode

The repository has a disassembler (`disassemble()` in `compiler.rs`) and a command-line runner (`core/src/main.rs`, finished in the next chapter). Here's a real listing:

```js
let total = 0;
for (let i = 0; i < 3; i += 1) {
  total += i * 2;
}
fn square(x) {
  return x * x;
}
print(square(total));
```

```text
$ cargo run --release -- example.bl --disasm
0000  01 00 00     CONST #0  (0)
0003  09 00 00     SET_GLOBAL 0  (total)
0006  01 00 00     CONST #0  (0)            ← `let i = 0`: the value stays put; that slot is i
0009  06 00 00     GET_LOCAL 0  (i)
0012  01 01 00     CONST #1  (3)
0015  1a           LT
0016  21 2e 00     JUMP_IF_FALSE → 0046     ← 0x002e = 46, little-endian
0019  08 00 00     GET_GLOBAL 0  (total)
0022  06 00 00     GET_LOCAL 0  (i)
0025  01 02 00     CONST #2  (2)
0028  12           MUL
0029  10           ADD
0030  09 00 00     SET_GLOBAL 0  (total)
0033  06 00 00     GET_LOCAL 0  (i)
0036  01 03 00     CONST #3  (1)
0039  10           ADD
0040  07 00 00     SET_LOCAL 0  (i)
0043  20 09 00     JUMP → 0009              ← back to the condition
0046  05           POP                      ← the loop's scope ends: i disappears
0047  08 00 00     GET_GLOBAL 0  (total)
0050  22 01 00 01  CALL square/1
0054  24 00 01     BUILTIN print/1
0057  05           POP
0058  00           HALT
0059  06 00 00     GET_LOCAL 0  (x)         ← function square starts here
0062  06 00 00     GET_LOCAL 0  (x)
0065  12           MUL
0066  23           RETURN
0067  02           NIL
0068  23           RETURN
36
```

Notice that `i += 1` became `GET_LOCAL, CONST, ADD, SET_LOCAL`: the parser's desugaring at work. Notice also that the constant `0` is stored once and used twice (`#0`).

## Exercises

1. Add `break`. You'll need a stack of "jumps to patch at the end of the current loop", and `break` must also `POP` any locals declared inside the loop body.
2. `x = x + 1` takes four instructions. Design an `INC_LOCAL slot` instruction and teach the compiler to use it.
3. Constant folding: compile `2 * 3` straight to `CONST 6`.

Next: [The virtual machine →](05-virtual-machine.md)
