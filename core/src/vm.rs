//! Step 4: the virtual machine. It runs bytecode one instruction at a time,
//! and everything it knows (instruction pointer, value stack, call frames,
//! globals and heap) is public, so the inspector can show all of it.

use crate::builtins::BUILTINS;
use crate::compiler::{Constant, Program};
use crate::op::{self, *};
use crate::parser::Span;
use crate::value::{Kind, Obj, Value, format_num};

pub const MAX_FRAMES: usize = 1000;
pub const MAX_STACK: usize = 1 << 16;
pub const MAX_HEAP: usize = 1 << 20;
const MAX_OUTPUT: usize = 64 * 1024;
const MAX_CHARTS: usize = 16;
const MAX_POINTS: usize = 4000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChartKind {
    Line,
    Scatter,
    Heatmap,
}

/// A chart a program draws with `plot`, `scatter` or `heatmap`.
#[derive(Clone, Debug)]
pub struct Chart {
    pub name: String,
    pub kind: ChartKind,
    /// `[x, y, group]` for line and scatter charts.
    pub points: Vec<[f64; 3]>,
    /// Names of the lines in a line chart; a point's group indexes this.
    pub series: Vec<String>,
    pub matrix: Vec<Vec<f64>>,
}

/// One active function call.
#[derive(Clone, Copy, Debug)]
pub struct Frame {
    pub func: u16,
    /// Stack index of the frame's slot 0 (its first parameter).
    pub base: usize,
    /// Where to continue in the caller after `RETURN`.
    pub ret_ip: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum Status {
    Ready = 0,
    Paused = 1,
    Breakpoint = 2,
    Halted = 3,
    Error = 4,
}

#[derive(Clone, Debug)]
pub struct RuntimeError {
    pub msg: String,
    pub span: Span,
}

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
    pub charts: Vec<Chart>,
    /// Bumped on every chart change, so the UI only redraws when needed.
    pub charts_version: u64,
    last_line: u32,
    rng: u64,
}

impl Vm {
    pub fn new(prog: Program) -> Vm {
        let mut vm = Vm {
            prog,
            ip: 0,
            stack: Vec::new(),
            frames: Vec::new(),
            globals: Vec::new(),
            heap: Vec::new(),
            consts: Vec::new(),
            output: String::new(),
            status: Status::Ready,
            error: None,
            steps: 0,
            breakpoints: Vec::new(),
            charts: Vec::new(),
            charts_version: 0,
            last_line: 0,
            rng: 0,
        };
        vm.reset();
        vm
    }

    /// Back to the first instruction with a clean machine.
    pub fn reset(&mut self) {
        self.ip = 0;
        self.stack = Vec::with_capacity(256);
        self.frames = vec![Frame { func: 0, base: 0, ret_ip: 0 }];
        self.globals = vec![Value::NIL; self.prog.globals.len()];
        self.heap.clear();
        self.output.clear();
        self.charts.clear();
        self.charts_version += 1;
        self.status = Status::Ready;
        self.error = None;
        self.steps = 0;
        self.last_line = 0;
        self.rng = 0x2545_f491_4f6c_dd1d;
        self.consts.clear();
        for k in &self.prog.constants {
            let v = match k {
                Constant::Num(n) => Value::num(*n),
                Constant::Str(s) => {
                    self.heap.push(Obj::Str(s.clone()));
                    Value::reference(self.heap.len() as u32 - 1)
                }
            };
            self.consts.push(v);
        }
    }

    pub fn finished(&self) -> bool {
        matches!(self.status, Status::Halted | Status::Error)
    }

    /// Source line of the next instruction.
    pub fn line(&self) -> u32 {
        self.prog.line_at(self.ip)
    }

    /// Run up to `max` instructions. Stops early when the program ends, on an
    /// error, or (if `use_breakpoints`) on arriving at a breakpoint line.
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

    /// Run until execution reaches a different source line.
    pub fn step_line(&mut self, max: u32) -> Status {
        let start = self.line();
        for _ in 0..max {
            self.step();
            if self.finished() {
                return self.status;
            }
            if self.line() != start {
                break;
            }
        }
        self.status = Status::Paused;
        self.status
    }

    /// Execute exactly one instruction.
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

    fn read_u8(&mut self) -> u8 {
        let b = self.prog.code[self.ip];
        self.ip += 1;
        b
    }

    fn read_u16(&mut self) -> u16 {
        let lo = self.read_u8() as u16;
        let hi = self.read_u8() as u16;
        lo | hi << 8
    }

    fn base(&self) -> usize {
        self.frames.last().map_or(0, |f| f.base)
    }

    fn push(&mut self, v: Value) -> Result<(), String> {
        if self.stack.len() >= MAX_STACK {
            return Err("stack overflow: the value stack is full".into());
        }
        self.stack.push(v);
        Ok(())
    }

    fn pop(&mut self) -> Value {
        self.stack.pop().unwrap_or(Value::NIL)
    }

    /// Take the top `n` values off the stack, oldest first.
    fn pop_n(&mut self, n: usize) -> Vec<Value> {
        self.stack.split_off(self.stack.len().saturating_sub(n))
    }

    fn exec(&mut self) -> Result<(), String> {
        let start = self.ip;
        let code = self.read_u8();
        match code {
            HALT => {
                self.ip = start;
                self.status = Status::Halted;
            }
            CONST => {
                let k = self.read_u16() as usize;
                let v = self.consts[k];
                self.push(v)?;
            }
            NIL => self.push(Value::NIL)?,
            TRUE => self.push(Value::TRUE)?,
            FALSE => self.push(Value::FALSE)?,
            POP => {
                self.pop();
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
            GET_GLOBAL => {
                let g = self.read_u16() as usize;
                let v = self.globals[g];
                self.push(v)?;
            }
            SET_GLOBAL => {
                let g = self.read_u16() as usize;
                self.globals[g] = self.pop();
            }
            ARRAY => {
                let n = self.read_u16() as usize;
                let items = self.pop_n(n);
                let r = self.alloc(Obj::Array(items))?;
                self.push(r)?;
            }
            GET_INDEX => {
                let index = self.pop();
                let array = self.pop();
                let i = self.check_index(array, index)?;
                let v = match &self.heap[array.as_ref()] {
                    Obj::Array(items) => items[i],
                    Obj::Str(_) => Value::NIL,
                };
                self.push(v)?;
            }
            SET_INDEX => {
                let v = self.pop();
                let index = self.pop();
                let array = self.pop();
                let i = self.check_index(array, index)?;
                if let Obj::Array(items) = &mut self.heap[array.as_ref()] {
                    items[i] = v;
                }
            }
            ADD => {
                let b = self.pop();
                let a = self.pop();
                let r = self.add(a, b)?;
                self.push(r)?;
            }
            SUB | MUL | DIV | MOD | LT | LE | GT | GE => {
                let b = self.pop();
                let a = self.pop();
                let r = self.arith(code, a, b)?;
                self.push(r)?;
            }
            NEG => {
                let a = self.pop();
                let n = self.number(a, "`-`")?;
                self.push(Value::num(-n))?;
            }
            NOT => {
                let a = self.pop();
                self.push(Value::bool(!a.is_truthy()))?;
            }
            EQ | NE => {
                let b = self.pop();
                let a = self.pop();
                let same = self.equal(a, b);
                self.push(Value::bool(same == (code == EQ)))?;
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
                self.stack.truncate(frame.base);
                self.push(v)?;
                self.ip = frame.ret_ip;
            }
            BUILTIN => {
                let id = self.read_u8();
                let argc = self.read_u8() as usize;
                let args = self.pop_n(argc);
                let r = self.builtin(id, &args)?;
                self.push(r)?;
            }
            _ => return Err(format!("unknown opcode 0x{code:02x}")),
        }
        Ok(())
    }

    fn alloc(&mut self, obj: Obj) -> Result<Value, String> {
        if self.heap.len() >= MAX_HEAP {
            return Err("out of memory: the heap is full (Bitlens has no garbage collector yet)".into());
        }
        self.heap.push(obj);
        Ok(Value::reference(self.heap.len() as u32 - 1))
    }

    pub fn obj(&self, v: Value) -> Option<&Obj> {
        if v.kind() == Kind::Ref { self.heap.get(v.as_ref()) } else { None }
    }

    fn is_str(&self, v: Value) -> bool {
        matches!(self.obj(v), Some(Obj::Str(_)))
    }

    fn number(&self, v: Value, what: &str) -> Result<f64, String> {
        if v.is_num() { Ok(v.as_num()) } else { Err(format!("{what} needs a number, but got {}", self.type_name(v))) }
    }

    pub fn add(&mut self, a: Value, b: Value) -> Result<Value, String> {
        if a.is_num() && b.is_num() {
            return Ok(Value::num(a.as_num() + b.as_num()));
        }
        if self.is_str(a) || self.is_str(b) {
            let joined = format!("{}{}", self.display(a), self.display(b));
            return self.alloc(Obj::Str(joined));
        }
        Err(format!("cannot add {} and {}", self.type_name(a), self.type_name(b)))
    }

    /// Number-only binary operators. Pure, so the explainer can preview them.
    pub fn arith(&self, code: u8, a: Value, b: Value) -> Result<Value, String> {
        if !(a.is_num() && b.is_num()) {
            return Err(format!(
                "`{}` needs two numbers, but got {} and {}",
                op::symbol(code),
                self.type_name(a),
                self.type_name(b)
            ));
        }
        let (x, y) = (a.as_num(), b.as_num());
        Ok(match code {
            SUB => Value::num(x - y),
            MUL => Value::num(x * y),
            DIV => Value::num(x / y),
            MOD => Value::num(x % y),
            LT => Value::bool(x < y),
            LE => Value::bool(x <= y),
            GT => Value::bool(x > y),
            GE => Value::bool(x >= y),
            _ => Value::NIL,
        })
    }

    pub fn equal(&self, a: Value, b: Value) -> bool {
        if a.is_num() && b.is_num() {
            return a.as_num() == b.as_num();
        }
        if let (Some(Obj::Str(x)), Some(Obj::Str(y))) = (self.obj(a), self.obj(b)) {
            return x == y;
        }
        a == b
    }

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

    fn builtin(&mut self, id: u8, args: &[Value]) -> Result<Value, String> {
        let name = BUILTINS[id as usize].name;
        let arg = |i: usize| args.get(i).copied().unwrap_or(Value::NIL);
        let what = format!("`{name}`");
        let math = |vm: &Vm, f: fn(f64) -> f64| -> Result<Value, String> { Ok(Value::num(f(vm.number(arg(0), &what)?))) };
        match name {
            "print" => {
                let line: Vec<String> = args.iter().map(|&a| self.display(a)).collect();
                self.write(&line.join(" "));
                Ok(Value::NIL)
            }
            "len" => match self.obj(arg(0)) {
                Some(Obj::Array(items)) => Ok(Value::num(items.len() as f64)),
                Some(Obj::Str(s)) => Ok(Value::num(s.chars().count() as f64)),
                _ => Err(format!("`len` needs an array or a string, but got {}", self.type_name(arg(0)))),
            },
            "push" => {
                if !matches!(self.obj(arg(0)), Some(Obj::Array(_))) {
                    return Err(format!("`push` needs an array, but got {}", self.type_name(arg(0))));
                }
                if let Obj::Array(items) = &mut self.heap[arg(0).as_ref()] {
                    items.push(arg(1));
                }
                Ok(Value::NIL)
            }
            "array" => {
                let n = self.number(arg(0), &what)?;
                if n.fract() != 0.0 || !(0.0..=1e6).contains(&n) {
                    return Err(format!("`array` needs a whole number of elements between 0 and 1000000, got {}", format_num(n)));
                }
                self.alloc(Obj::Array(vec![arg(1); n as usize]))
            }
            "exp" => math(self, f64::exp),
            "log" => math(self, f64::ln),
            "sqrt" => math(self, f64::sqrt),
            "abs" => math(self, f64::abs),
            "floor" => math(self, f64::floor),
            "sin" => math(self, f64::sin),
            "cos" => math(self, f64::cos),
            "tanh" => math(self, f64::tanh),
            "pow" => Ok(Value::num(self.number(arg(0), &what)?.powf(self.number(arg(1), &what)?))),
            "min" => Ok(Value::num(self.number(arg(0), &what)?.min(self.number(arg(1), &what)?))),
            "max" => Ok(Value::num(self.number(arg(0), &what)?.max(self.number(arg(1), &what)?))),
            "random" => {
                // xorshift64: a tiny pseudo-random generator. The seed is fixed
                // in `reset`, so every run sees the same "random" numbers.
                self.rng ^= self.rng << 13;
                self.rng ^= self.rng >> 7;
                self.rng ^= self.rng << 17;
                Ok(Value::num((self.rng >> 11) as f64 / (1u64 << 53) as f64))
            }
            "steps" => Ok(Value::num(self.steps as f64)),
            "plot" | "scatter" => {
                let x = self.number(arg(1), &what)?;
                let y = self.number(arg(2), &what)?;
                let kind = if name == "plot" { ChartKind::Line } else { ChartKind::Scatter };
                let label = if name == "plot" && args.len() == 4 { self.display(arg(3)) } else { String::new() };
                let group = if name == "scatter" { self.number(arg(3), &what)? } else { 0.0 };
                let chart = self.chart(arg(0), kind)?;
                let group = if kind == ChartKind::Line {
                    match chart.series.iter().position(|s| *s == label) {
                        Some(i) => i as f64,
                        None => {
                            chart.series.push(label);
                            (chart.series.len() - 1) as f64
                        }
                    }
                } else {
                    group
                };
                if chart.points.len() >= MAX_POINTS {
                    if kind == ChartKind::Scatter {
                        return Ok(Value::NIL);
                    }
                    // Keep the whole history visible: drop every other point.
                    let thinned = chart.points.iter().step_by(2).copied().collect();
                    chart.points = thinned;
                }
                chart.points.push([x, y, group]);
                self.charts_version += 1;
                Ok(Value::NIL)
            }
            "heatmap" => {
                let mut matrix = Vec::new();
                if let Some(Obj::Array(rows)) = self.obj(arg(1)) {
                    for &row in rows.iter().take(64) {
                        let Some(Obj::Array(cells)) = self.obj(row) else {
                            return Err("`heatmap` needs an array of arrays of numbers".into());
                        };
                        matrix.push(cells.iter().take(64).map(|c| if c.is_num() { c.as_num() } else { f64::NAN }).collect());
                    }
                } else {
                    return Err(format!("`heatmap` needs an array of arrays, but got {}", self.type_name(arg(1))));
                }
                self.chart(arg(0), ChartKind::Heatmap)?.matrix = matrix;
                self.charts_version += 1;
                Ok(Value::NIL)
            }
            "clearplot" => {
                let title = self.display(arg(0));
                self.charts.retain(|c| c.name != title);
                self.charts_version += 1;
                Ok(Value::NIL)
            }
            _ => Err(format!("unknown built-in `{name}`")),
        }
    }

    /// Find the chart with this name, creating it the first time.
    fn chart(&mut self, name: Value, kind: ChartKind) -> Result<&mut Chart, String> {
        let title = self.display(name);
        let i = match self.charts.iter().position(|c| c.name == title) {
            Some(i) => i,
            None if self.charts.len() >= MAX_CHARTS => return Err(format!("too many charts (the limit is {MAX_CHARTS})")),
            None => {
                self.charts.push(Chart { name: title, kind, points: Vec::new(), series: Vec::new(), matrix: Vec::new() });
                self.charts.len() - 1
            }
        };
        let chart = &mut self.charts[i];
        if chart.kind != kind {
            return Err(format!("the chart {:?} already exists as a different kind of chart", chart.name));
        }
        Ok(chart)
    }

    fn write(&mut self, line: &str) {
        self.output.push_str(line);
        self.output.push('\n');
        if self.output.len() > MAX_OUTPUT {
            let mut cut = self.output.len() - MAX_OUTPUT / 2;
            while !self.output.is_char_boundary(cut) {
                cut += 1;
            }
            self.output.drain(..cut);
        }
    }

    pub fn type_name(&self, v: Value) -> &'static str {
        match v.kind() {
            Kind::Num => "a number",
            Kind::Nil => "nil",
            Kind::Bool => "a boolean",
            Kind::Ref => match self.obj(v) {
                Some(Obj::Str(_)) => "a string",
                Some(Obj::Array(_)) => "an array",
                None => "a dangling reference",
            },
        }
    }

    /// How `print` shows a value: strings without quotes.
    pub fn display(&self, v: Value) -> String {
        match self.obj(v) {
            Some(Obj::Str(s)) => s.clone(),
            _ => self.repr(v, 0),
        }
    }

    /// How the inspector shows a value: strings quoted, arrays expanded.
    pub fn repr(&self, v: Value, depth: usize) -> String {
        match v.kind() {
            Kind::Num => format_num(v.as_num()),
            Kind::Nil => "nil".into(),
            Kind::Bool => (v == Value::TRUE).to_string(),
            Kind::Ref => match self.obj(v) {
                Some(Obj::Str(s)) => format!("{s:?}"),
                Some(Obj::Array(_)) if depth >= 3 => "[…]".into(),
                Some(Obj::Array(items)) => {
                    let shown: Vec<String> = items.iter().take(50).map(|&x| self.repr(x, depth + 1)).collect();
                    let more = if items.len() > 50 { ", …" } else { "" };
                    format!("[{}{more}]", shown.join(", "))
                }
                None => format!("@{}", v.as_ref()),
            },
        }
    }
}
