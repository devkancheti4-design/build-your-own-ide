//! Step 3: the compiler walks the AST and emits bytecode: a flat array of
//! bytes the virtual machine executes one instruction at a time.
//!
//! The VM is a stack machine. `w * x + b` becomes
//!
//! ```text
//! GET_GLOBAL w     push w
//! GET_LOCAL  x     push x
//! MUL              pop two, push their product
//! GET_GLOBAL b     push b
//! ADD              pop two, push their sum
//! ```

use std::collections::HashMap;

use crate::builtins::{self, BUILTINS};
use crate::op::{self, *};
use crate::parser::{BinOp, Block, CompileError, Expr, ExprKind, FnDecl, Span, Stmt, StmtKind, UnOp, err};
use crate::value::format_num;

#[derive(Clone, Debug)]
pub enum Constant {
    Num(f64),
    Str(String),
}

#[derive(Clone, Debug)]
pub struct Function {
    pub name: String,
    pub arity: u8,
    /// Address of the function's first instruction.
    pub entry: usize,
}

/// Debug info: which stack slot holds which variable, for which range of
/// instructions. It lets the inspector print names next to raw stack values.
#[derive(Clone, Debug)]
pub struct LocalInfo {
    pub func: u16,
    pub slot: u16,
    pub name: String,
    pub from: usize,
    pub to: usize,
}

#[derive(Clone, Debug, Default)]
pub struct Program {
    pub code: Vec<u8>,
    /// `spans[i]` is the source of the instruction that byte `i` belongs to.
    pub spans: Vec<Span>,
    pub constants: Vec<Constant>,
    /// Function 0 is `<main>`, the top level of the file.
    pub functions: Vec<Function>,
    pub globals: Vec<String>,
    pub locals: Vec<LocalInfo>,
    /// Character offset where each source line starts.
    pub line_starts: Vec<u32>,
}

impl Program {
    /// 1-based line number of a character offset.
    pub fn line_of(&self, pos: u32) -> u32 {
        self.line_starts.partition_point(|&s| s <= pos) as u32
    }

    pub fn line_at(&self, ip: usize) -> u32 {
        self.spans.get(ip).map_or(0, |s| self.line_of(s.start))
    }

    /// The function whose code contains `ip`.
    pub fn func_at(&self, ip: usize) -> u16 {
        self.functions.iter().rposition(|f| f.entry <= ip).unwrap_or(0) as u16
    }

    pub fn local_name(&self, func: u16, slot: u16, ip: usize) -> Option<&str> {
        self.locals
            .iter()
            .find(|l| l.func == func && l.slot == slot && l.from <= ip && ip < l.to)
            .map(|l| l.name.as_str())
    }

    fn u16_at(&self, at: usize) -> u16 {
        self.code[at] as u16 | (self.code[at + 1] as u16) << 8
    }
}

pub fn compile(src: &[char], stmts: &[Stmt]) -> Result<Program, CompileError> {
    let mut c = Compiler {
        prog: Program::default(),
        fns: HashMap::new(),
        globals: HashMap::new(),
        func: 0,
        locals: Vec::new(),
        depth: 0,
    };
    c.prog.line_starts = std::iter::once(0)
        .chain(src.iter().enumerate().filter(|(_, ch)| **ch == '\n').map(|(i, _)| i as u32 + 1))
        .collect();
    c.prog.functions.push(Function { name: "<main>".into(), arity: 0, entry: 0 });

    // Pass 1: learn every function and global name first, so code can call a
    // function that is declared further down the file.
    for s in stmts {
        match &s.kind {
            StmtKind::Fn(f) => {
                if builtins::find(&f.name).is_some() {
                    return err(format!("`{}` is a built-in function; pick another name", f.name), s.span);
                }
                if c.fns.contains_key(&f.name) {
                    return err(format!("function `{}` is declared twice", f.name), s.span);
                }
                if f.params.len() > 255 {
                    return err("a function can have at most 255 parameters", s.span);
                }
                c.fns.insert(f.name.clone(), c.prog.functions.len() as u16);
                c.prog.functions.push(Function { name: f.name.clone(), arity: f.params.len() as u8, entry: 0 });
            }
            StmtKind::Let { name, .. } if !c.globals.contains_key(name) => {
                c.globals.insert(name.clone(), c.prog.globals.len() as u16);
                c.prog.globals.push(name.clone());
            }
            _ => {}
        }
    }

    // Pass 2: the top-level code, then every function body after it.
    for s in stmts.iter().filter(|s| !matches!(s.kind, StmtKind::Fn(_))) {
        c.stmt(s)?;
    }
    let end = Span::new(src.len(), src.len());
    c.emit(HALT, end);
    for s in stmts {
        if let StmtKind::Fn(f) = &s.kind {
            c.function(f, s.span)?;
        }
    }
    if c.prog.code.len() > u16::MAX as usize {
        return err("this program is too big: bytecode is limited to 65535 bytes", end);
    }
    Ok(c.prog)
}

/// Turn bytecode back into readable text, one entry per instruction.
pub struct Instr {
    pub ip: usize,
    pub size: usize,
    pub text: String,
}

pub fn disassemble(p: &Program) -> Vec<Instr> {
    let mut out = Vec::new();
    let mut ip = 0;
    while ip < p.code.len() {
        let code = p.code[ip];
        let size = op::size(code).min(p.code.len() - ip);
        let detail = match code {
            CONST => {
                let k = p.u16_at(ip + 1);
                let text = match &p.constants[k as usize] {
                    Constant::Num(n) => format_num(*n),
                    Constant::Str(s) => format!("{s:?}"),
                };
                format!(" #{k}  ({text})")
            }
            GET_LOCAL | SET_LOCAL => {
                let slot = p.u16_at(ip + 1);
                format!(" {slot}  ({})", p.local_name(p.func_at(ip), slot, ip).unwrap_or("?"))
            }
            GET_GLOBAL | SET_GLOBAL => {
                let g = p.u16_at(ip + 1);
                format!(" {g}  ({})", p.globals[g as usize])
            }
            ARRAY => format!(" {}", p.u16_at(ip + 1)),
            JUMP | JUMP_IF_FALSE => format!(" → {:04}", p.u16_at(ip + 1)),
            CALL => format!(" {}/{}", p.functions[p.u16_at(ip + 1) as usize].name, p.code[ip + 3]),
            BUILTIN => format!(" {}/{}", BUILTINS[p.code[ip + 1] as usize].name, p.code[ip + 2]),
            _ => String::new(),
        };
        out.push(Instr { ip, size, text: format!("{}{detail}", op::name(code)) });
        ip += size;
    }
    out
}

struct Local {
    name: String,
    depth: u32,
    info: usize,
}

enum Var {
    Local(u16),
    Global(u16),
}

struct Compiler {
    prog: Program,
    fns: HashMap<String, u16>,
    globals: HashMap<String, u16>,
    /// The function being compiled (0 = `<main>`).
    func: u16,
    /// Variables currently on the stack; a local's index here is its slot.
    locals: Vec<Local>,
    /// Block nesting. In `<main>`, a `let` at depth 0 makes a global.
    depth: u32,
}

impl Compiler {
    fn emit(&mut self, byte: u8, span: Span) {
        self.prog.code.push(byte);
        self.prog.spans.push(span);
    }

    fn emit_u16(&mut self, op: u8, value: u16, span: Span) {
        self.emit(op, span);
        self.emit(value as u8, span);
        self.emit((value >> 8) as u8, span);
    }

    /// Emit a jump whose target isn't known yet; `patch` fills it in later.
    fn emit_jump(&mut self, op: u8, span: Span) -> usize {
        self.emit_u16(op, 0xffff, span);
        self.prog.code.len() - 2
    }

    /// Point the jump operand at `at` to the next instruction emitted.
    fn patch(&mut self, at: usize) {
        let target = self.prog.code.len() as u16;
        self.prog.code[at] = target as u8;
        self.prog.code[at + 1] = (target >> 8) as u8;
    }

    fn constant(&mut self, k: Constant, span: Span) -> Result<u16, CompileError> {
        let existing = self.prog.constants.iter().position(|c| match (c, &k) {
            (Constant::Num(a), Constant::Num(b)) => a.to_bits() == b.to_bits(),
            (Constant::Str(a), Constant::Str(b)) => a == b,
            _ => false,
        });
        let index = existing.unwrap_or_else(|| {
            self.prog.constants.push(k);
            self.prog.constants.len() - 1
        });
        if index > u16::MAX as usize {
            return err("too many constants in one program", span);
        }
        Ok(index as u16)
    }

    fn resolve(&self, name: &str) -> Option<Var> {
        if let Some(slot) = self.locals.iter().rposition(|l| l.name == name) {
            return Some(Var::Local(slot as u16));
        }
        self.globals.get(name).map(|&g| Var::Global(g))
    }

    fn add_local(&mut self, name: String) {
        let info = self.prog.locals.len();
        self.prog.locals.push(LocalInfo {
            func: self.func,
            slot: self.locals.len() as u16,
            name: name.clone(),
            from: self.prog.code.len(),
            to: usize::MAX,
        });
        self.locals.push(Local { name, depth: self.depth, info });
    }

    fn function(&mut self, f: &FnDecl, span: Span) -> Result<(), CompileError> {
        self.func = self.fns[&f.name];
        self.prog.functions[self.func as usize].entry = self.prog.code.len();
        self.depth = 1;
        self.locals.clear();
        // The caller pushes the arguments; they become the first locals.
        for p in &f.params {
            if self.locals.iter().any(|l| &l.name == p) {
                return err(format!("parameter `{p}` appears twice"), span);
            }
            self.add_local(p.clone());
        }
        for s in &f.body.stmts {
            self.stmt(s)?;
        }
        // Reaching the closing `}` returns nil.
        self.emit(NIL, f.body.close);
        self.emit(RETURN, f.body.close);
        let end = self.prog.code.len();
        for l in self.locals.drain(..) {
            self.prog.locals[l.info].to = end;
        }
        Ok(())
    }

    fn block(&mut self, b: &Block) -> Result<(), CompileError> {
        self.depth += 1;
        for s in &b.stmts {
            self.stmt(s)?;
        }
        self.end_scope(b.close);
        Ok(())
    }

    /// Leaving a block: pop the block's variables off the stack.
    fn end_scope(&mut self, span: Span) {
        self.depth -= 1;
        while self.locals.last().is_some_and(|l| l.depth > self.depth) {
            let l = self.locals.pop().unwrap();
            self.emit(POP, span);
            self.prog.locals[l.info].to = self.prog.code.len();
        }
    }

    fn stmt(&mut self, s: &Stmt) -> Result<(), CompileError> {
        match &s.kind {
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
            StmtKind::Assign { target, value } => match &target.kind {
                ExprKind::Var(name) => {
                    let Some(var) = self.resolve(name) else {
                        return err(format!("unknown variable `{name}` (declare it first with `let {name} = ...;`)"), target.span);
                    };
                    self.expr(value)?;
                    match var {
                        Var::Local(slot) => self.emit_u16(SET_LOCAL, slot, s.span),
                        Var::Global(g) => self.emit_u16(SET_GLOBAL, g, s.span),
                    }
                }
                ExprKind::Index(array, index) => {
                    self.expr(array)?;
                    self.expr(index)?;
                    self.expr(value)?;
                    self.emit(SET_INDEX, s.span);
                }
                _ => return err("you can only assign to a variable or an array element", target.span),
            },
            StmtKind::Expr(e) => {
                self.expr(e)?;
                self.emit(POP, s.span);
            }
            StmtKind::If { cond, then, els } => {
                self.expr(cond)?;
                let to_else = self.emit_jump(JUMP_IF_FALSE, cond.span);
                self.block(then)?;
                match els {
                    Some(els) => {
                        let to_end = self.emit_jump(JUMP, then.close);
                        self.patch(to_else);
                        self.block(els)?;
                        self.patch(to_end);
                    }
                    None => self.patch(to_else),
                }
            }
            StmtKind::While { cond, body } => {
                let start = self.prog.code.len();
                self.expr(cond)?;
                let exit = self.emit_jump(JUMP_IF_FALSE, cond.span);
                self.block(body)?;
                self.emit_u16(JUMP, start as u16, s.span);
                self.patch(exit);
            }
            StmtKind::For { init, cond, update, body } => {
                // The whole loop is a scope, so `let i` disappears afterwards.
                self.depth += 1;
                if let Some(init) = init {
                    self.stmt(init)?;
                }
                let start = self.prog.code.len();
                let exit = match cond {
                    Some(cond) => {
                        self.expr(cond)?;
                        Some(self.emit_jump(JUMP_IF_FALSE, cond.span))
                    }
                    None => None,
                };
                self.block(body)?;
                if let Some(update) = update {
                    self.stmt(update)?;
                }
                self.emit_u16(JUMP, start as u16, s.span);
                if let Some(exit) = exit {
                    self.patch(exit);
                }
                self.end_scope(body.close);
            }
            StmtKind::Return(value) => {
                if self.func == 0 {
                    return err("`return` can only be used inside a function", s.span);
                }
                match value {
                    Some(v) => self.expr(v)?,
                    None => self.emit(NIL, s.span),
                }
                self.emit(RETURN, s.span);
            }
            StmtKind::Block(b) => self.block(b)?,
            StmtKind::Fn(_) => return err("functions can only be declared at the top level", s.span),
        }
        Ok(())
    }

    fn expr(&mut self, e: &Expr) -> Result<(), CompileError> {
        match &e.kind {
            ExprKind::Num(n) => {
                let k = self.constant(Constant::Num(*n), e.span)?;
                self.emit_u16(CONST, k, e.span);
            }
            ExprKind::Str(s) => {
                let k = self.constant(Constant::Str(s.clone()), e.span)?;
                self.emit_u16(CONST, k, e.span);
            }
            ExprKind::Bool(b) => self.emit(if *b { TRUE } else { FALSE }, e.span),
            ExprKind::Nil => self.emit(NIL, e.span),
            ExprKind::Var(name) => match self.resolve(name) {
                Some(Var::Local(slot)) => self.emit_u16(GET_LOCAL, slot, e.span),
                Some(Var::Global(g)) => self.emit_u16(GET_GLOBAL, g, e.span),
                None => {
                    return err(format!("unknown variable `{name}` (declare it first with `let {name} = ...;`)"), e.span);
                }
            },
            ExprKind::Array(items) => {
                for item in items {
                    self.expr(item)?;
                }
                self.emit_u16(ARRAY, items.len() as u16, e.span);
            }
            ExprKind::Index(array, index) => {
                self.expr(array)?;
                self.expr(index)?;
                self.emit(GET_INDEX, e.span);
            }
            ExprKind::Unary(op, operand) => {
                self.expr(operand)?;
                self.emit(
                    match op {
                        UnOp::Neg => NEG,
                        UnOp::Not => NOT,
                    },
                    e.span,
                );
            }
            ExprKind::Binary(op, left, right) => {
                self.expr(left)?;
                self.expr(right)?;
                let code = match op {
                    BinOp::Add => ADD,
                    BinOp::Sub => SUB,
                    BinOp::Mul => MUL,
                    BinOp::Div => DIV,
                    BinOp::Mod => MOD,
                    BinOp::Eq => EQ,
                    BinOp::Ne => NE,
                    BinOp::Lt => LT,
                    BinOp::Le => LE,
                    BinOp::Gt => GT,
                    BinOp::Ge => GE,
                };
                self.emit(code, e.span);
            }
            ExprKind::And(left, right) => {
                // a && b: when a is false the answer is false and b never runs.
                self.expr(left)?;
                let short_circuit = self.emit_jump(JUMP_IF_FALSE, e.span);
                self.expr(right)?;
                let end = self.emit_jump(JUMP, e.span);
                self.patch(short_circuit);
                self.emit(FALSE, e.span);
                self.patch(end);
            }
            ExprKind::Or(left, right) => {
                // a || b: when a is true the answer is true and b never runs.
                self.expr(left)?;
                let try_right = self.emit_jump(JUMP_IF_FALSE, e.span);
                self.emit(TRUE, e.span);
                let end = self.emit_jump(JUMP, e.span);
                self.patch(try_right);
                self.expr(right)?;
                self.patch(end);
            }
            ExprKind::Call(name, args) => {
                if let Some(&f) = self.fns.get(name) {
                    let arity = self.prog.functions[f as usize].arity as usize;
                    if args.len() != arity {
                        return err(format!("`{name}` takes {arity} argument(s) but was given {}", args.len()), e.span);
                    }
                    for a in args {
                        self.expr(a)?;
                    }
                    self.emit_u16(CALL, f, e.span);
                    self.emit(args.len() as u8, e.span);
                } else if let Some(id) = builtins::find(name) {
                    let (min, max) = BUILTINS[id as usize].arity;
                    if args.len() < min as usize || args.len() > max as usize {
                        let expected = if min == max { min.to_string() } else { format!("{min} to {max}") };
                        return err(format!("`{name}` takes {expected} argument(s) but was given {}", args.len()), e.span);
                    }
                    for a in args {
                        self.expr(a)?;
                    }
                    self.emit(BUILTIN, e.span);
                    self.emit(id, e.span);
                    self.emit(args.len() as u8, e.span);
                } else {
                    return err(format!("unknown function `{name}`"), e.span);
                }
            }
        }
        Ok(())
    }
}
