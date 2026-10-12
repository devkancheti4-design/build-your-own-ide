//! The built-in explainer. It describes, in plain English, what the next
//! instruction is about to do, using the real values sitting on the stack.
//! No AI involved: every sentence comes from the machine's own state.

use crate::builtins::BUILTINS;
use crate::compiler::Constant;
use crate::op::{self, *};
use crate::value::{Obj, Value, format_num};
use crate::vm::{Status, Vm};

pub fn explain(vm: &Vm) -> String {
    match vm.status {
        Status::Halted => {
            return "The program has finished: the machine reached HALT. Press Reset to run it again.".into();
        }
        Status::Error => {
            let msg = vm.error.as_ref().map_or("", |e| e.msg.as_str());
            return format!("The machine stopped with an error: {msg}. The highlighted code is the instruction that failed.");
        }
        _ => {}
    }
    let p = &vm.prog;
    let ip = vm.ip;
    let Some(&code) = p.code.get(ip) else { return String::new() };
    let u16_at = |at: usize| p.code[at] as u16 | (p.code[at + 1] as u16) << 8;
    // `peek(0)` is the top of the stack, `peek(1)` the value under it.
    let peek = |n: usize| vm.stack.len().checked_sub(n + 1).map_or(Value::NIL, |i| vm.stack[i]);
    let show = |v: Value| vm.repr(v, 0);
    let frame = vm.frames.last().copied();
    let base = frame.map_or(0, |f| f.base);
    let func = frame.map_or(0, |f| f.func);

    match code {
        HALT => "HALT: this is the last instruction. Executing it stops the machine.".into(),
        CONST => {
            let k = u16_at(ip + 1) as usize;
            let text = match &p.constants[k] {
                Constant::Num(n) => format_num(*n),
                Constant::Str(s) => format!("{s:?}"),
            };
            format!(
                "Push the constant {text} onto the stack. Literal values are stored once in the constant pool; \
                 the instruction only carries the pool index #{k} in its two operand bytes."
            )
        }
        NIL => "Push `nil` (the \"no value\" value) onto the stack.".into(),
        TRUE => "Push `true` onto the stack.".into(),
        FALSE => "Push `false` onto the stack.".into(),
        POP => {
            let top = vm.stack.len().saturating_sub(1);
            match p.local_name(func, top.saturating_sub(base) as u16, ip) {
                Some(name) if top >= base => format!(
                    "Pop {} off the stack. The block that declared `{name}` has ended, so the variable stops existing.",
                    show(peek(0))
                ),
                _ => format!("Pop {} off the stack: nothing uses this value, so it is thrown away.", show(peek(0))),
            }
        }
        GET_LOCAL | SET_LOCAL => {
            let slot = u16_at(ip + 1);
            let name = p.local_name(func, slot, ip).unwrap_or("?");
            let at = base + slot as usize;
            if code == GET_LOCAL {
                let v = vm.stack.get(at).copied().unwrap_or(Value::NIL);
                format!(
                    "Copy the local variable `{name}` = {} to the top of the stack. Locals live on the stack itself: \
                     `{name}` is slot {slot} of this call frame (stack index {base} + {slot} = {at}).",
                    show(v)
                )
            } else {
                format!("Pop {} and store it in the local variable `{name}` (stack index {at}).", show(peek(0)))
            }
        }
        GET_GLOBAL | SET_GLOBAL => {
            let g = u16_at(ip + 1) as usize;
            let name = &p.globals[g];
            if code == GET_GLOBAL {
                format!(
                    "Copy the global variable `{name}` = {} to the top of the stack. Globals live in their own table, \
                     outside the stack; `{name}` is entry {g}.",
                    show(vm.globals[g])
                )
            } else {
                format!("Pop {} and store it in the global variable `{name}` (globals table entry {g}).", show(peek(0)))
            }
        }
        ARRAY => {
            let n = u16_at(ip + 1) as usize;
            format!(
                "Take the top {n} value(s) off the stack and build an array from them on the heap, at address @{}. \
                 Then push a reference to it: the stack holds only the 64-bit address, the elements live on the heap.",
                vm.heap.len()
            )
        }
        GET_INDEX => {
            let (array, index) = (peek(1), peek(0));
            match vm.check_index(array, index) {
                Ok(i) => {
                    let element = match vm.obj(array) {
                        Some(Obj::Array(items)) => show(items[i]),
                        _ => "?".into(),
                    };
                    format!(
                        "Pop the index {i} and the array reference @{}, then push element [{i}] = {element}. \
                         The machine follows the reference to the heap to find it.",
                        array.as_ref()
                    )
                }
                Err(e) => format!("Indexing is about to fail: {e}."),
            }
        }
        SET_INDEX => {
            let (array, index, v) = (peek(2), peek(1), peek(0));
            match vm.check_index(array, index) {
                Ok(i) => format!(
                    "Pop the value {}, the index {i} and the array @{}, then store the value into @{}[{i}] on the heap.",
                    show(v),
                    array.as_ref(),
                    array.as_ref()
                ),
                Err(e) => format!("Storing into the array is about to fail: {e}."),
            }
        }
        ADD => {
            let (a, b) = (peek(1), peek(0));
            if a.is_num() && b.is_num() {
                let sum = a.as_num() + b.as_num();
                format!(
                    "Pop {} and {}, add them and push {}.{}",
                    show(a),
                    show(b),
                    format_num(sum),
                    rounding_note(a.as_num(), b.as_num(), sum)
                )
            } else {
                format!(
                    "Pop {} and {} and join them into a new string on the heap: {:?}.",
                    show(a),
                    show(b),
                    format!("{}{}", vm.display(a), vm.display(b))
                )
            }
        }
        SUB | MUL | DIV | MOD | LT | LE | GT | GE => {
            let (a, b) = (peek(1), peek(0));
            match vm.arith(code, a, b) {
                Ok(r) => {
                    let mut text = format!(
                        "Pop {} and {}, compute {} {} {} = {}, and push the result.",
                        show(a),
                        show(b),
                        show(a),
                        op::symbol(code),
                        show(b),
                        show(r)
                    );
                    if code == DIV && b.as_num() == 0.0 {
                        text.push_str(
                            " Dividing by zero is not an error for floating-point numbers: IEEE-754 defines the answer \
                             as Infinity (or NaN for 0 / 0).",
                        );
                    }
                    text
                }
                Err(e) => format!("This is about to fail: {e}."),
            }
        }
        NEG => format!("Pop {} and push its negation. In the bits, this only flips the sign bit (bit 63).", show(peek(0))),
        NOT => format!("Pop {} and push the opposite truth value.", show(peek(0))),
        EQ | NE => {
            let (a, b) = (peek(1), peek(0));
            let same = vm.equal(a, b);
            let result = if code == EQ { same } else { !same };
            format!("Pop {} and {}, compare them with `{}`, and push {result}.", show(a), show(b), op::symbol(code))
        }
        JUMP => {
            let target = u16_at(ip + 1) as usize;
            if target <= ip {
                format!("Jump back to address {target:04}. Jumping backwards is how a loop repeats.")
            } else {
                format!("Jump forward to address {target:04}, skipping the code in between.")
            }
        }
        JUMP_IF_FALSE => {
            let target = u16_at(ip + 1);
            let cond = peek(0);
            if cond.is_truthy() {
                format!("Pop the condition ({}). It is true, so carry on with the next instruction.", show(cond))
            } else {
                format!("Pop the condition ({}). It is false, so jump to address {target:04}.", show(cond))
            }
        }
        CALL => {
            let f = u16_at(ip + 1);
            let argc = p.code[ip + 3] as usize;
            let callee = &p.functions[f as usize];
            let args: Vec<String> = (0..argc)
                .map(|i| {
                    let v = vm.stack[vm.stack.len() - argc + i];
                    let param = p.local_name(f, i as u16, callee.entry).unwrap_or("?");
                    format!("`{param}` = {}", show(v))
                })
                .collect();
            let args = if args.is_empty() { "no arguments".to_string() } else { args.join(", ") };
            format!(
                "Call `{}` with {args}. A new call frame starts at stack index {}: the arguments already on the stack \
                 become the function's parameters. The return address {:04} is saved in the frame so the machine \
                 knows where to come back to. Then jump to the function's first instruction at {:04}.",
                callee.name,
                vm.stack.len() - argc,
                ip + 4,
                callee.entry
            )
        }
        RETURN => {
            let name = &p.functions[func as usize].name;
            let ret = frame.map_or(0, |f| f.ret_ip);
            format!(
                "Return {} from `{name}`. The frame's stack slots (index {base} and up) are thrown away, the return \
                 value is pushed for the caller, and execution continues at address {ret:04}.",
                show(peek(0))
            )
        }
        BUILTIN => {
            let b = &BUILTINS[p.code[ip + 1] as usize];
            let argc = p.code[ip + 2] as usize;
            let args: Vec<String> = vm.stack[vm.stack.len() - argc..].iter().map(|&v| show(v)).collect();
            format!(
                "Call the built-in `{}({})`, which will {}. Built-ins are written in Rust inside the VM itself.",
                b.name,
                args.join(", "),
                b.doc
            )
        }
        _ => format!("Unknown opcode 0x{code:02x}."),
    }
}

/// A note for additions where the exact answer can't be stored in 64 bits.
fn rounding_note(a: f64, b: f64, sum: f64) -> &'static str {
    // TwoSum (Knuth): recovers the rounding error of a floating-point addition.
    let bb = sum - a;
    let error = (a - (sum - bb)) + (b - bb);
    if sum.is_finite() && error != 0.0 {
        " The exact sum has no 64-bit representation, so the hardware rounds it to the nearest double. Click the \
         result on the stack to see its bits."
    } else {
        ""
    }
}
