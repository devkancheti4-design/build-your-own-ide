//! Step 2: the parser turns the flat list of tokens into a tree (the AST)
//! that mirrors the structure of the program: statements contain
//! expressions, and expressions contain smaller expressions.
//!
//! It's a recursive-descent parser: one function per grammar rule, each
//! calling the rule below it. Lower functions bind tighter, which is how
//! `1 + 2 * 3` ends up as `1 + (2 * 3)`.

use crate::lexer::{Tok, Token, tokenize};

/// A range of source characters, kept on every node so errors and the
/// debugger can point at exact code.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Span {
    pub start: u32,
    pub end: u32,
}

impl Span {
    pub fn new(start: usize, end: usize) -> Span {
        Span { start: start as u32, end: end as u32 }
    }

    pub fn join(self, other: Span) -> Span {
        Span { start: self.start, end: other.end }
    }
}

#[derive(Debug)]
pub struct CompileError {
    pub msg: String,
    pub span: Span,
}

pub fn err<T>(msg: impl Into<String>, span: Span) -> Result<T> {
    Err(CompileError { msg: msg.into(), span })
}

#[derive(Clone, Debug)]
pub struct Expr {
    pub kind: ExprKind,
    pub span: Span,
}

#[derive(Clone, Debug)]
pub enum ExprKind {
    Num(f64),
    Str(String),
    Bool(bool),
    Nil,
    Var(String),
    Array(Vec<Expr>),
    Index(Box<Expr>, Box<Expr>),
    Unary(UnOp, Box<Expr>),
    Binary(BinOp, Box<Expr>, Box<Expr>),
    And(Box<Expr>, Box<Expr>),
    Or(Box<Expr>, Box<Expr>),
    Call(String, Vec<Expr>),
}

#[derive(Clone, Copy, Debug)]
pub enum UnOp {
    Neg,
    Not,
}

#[derive(Clone, Copy, Debug)]
pub enum BinOp {
    Add,
    Sub,
    Mul,
    Div,
    Mod,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}

#[derive(Clone, Debug)]
pub struct Stmt {
    pub kind: StmtKind,
    pub span: Span,
}

#[derive(Clone, Debug)]
pub enum StmtKind {
    Let { name: String, value: Expr },
    /// `target` is always a `Var` or an `Index` expression.
    Assign { target: Expr, value: Expr },
    Expr(Expr),
    If { cond: Expr, then: Block, els: Option<Block> },
    While { cond: Expr, body: Block },
    For { init: Option<Box<Stmt>>, cond: Option<Expr>, update: Option<Box<Stmt>>, body: Block },
    Return(Option<Expr>),
    Block(Block),
    Fn(FnDecl),
}

#[derive(Clone, Debug)]
pub struct Block {
    pub stmts: Vec<Stmt>,
    /// The closing `}`: where the block's variables go out of scope.
    pub close: Span,
}

#[derive(Clone, Debug)]
pub struct FnDecl {
    pub name: String,
    pub params: Vec<String>,
    pub body: Block,
}

type Result<T> = std::result::Result<T, CompileError>;

pub fn parse(src: &[char]) -> Result<Vec<Stmt>> {
    let tokens: Vec<Token> = tokenize(src).into_iter().filter(|t| t.kind != Tok::Comment).collect();
    if let Some(t) = tokens.iter().find(|t| t.kind == Tok::Error) {
        let text: String = src[t.start..t.end].iter().collect();
        let msg = if text.starts_with('"') {
            "this string is never closed (missing `\"`)".to_string()
        } else {
            format!("unexpected character `{text}`")
        };
        return err(msg, span(*t));
    }
    let mut p = Parser { src, tokens, pos: 0 };
    let mut program = Vec::new();
    while !p.at(Tok::Eof) {
        program.push(if p.at(Tok::Fn) { p.function()? } else { p.statement()? });
    }
    Ok(program)
}

fn span(t: Token) -> Span {
    Span::new(t.start, t.end)
}

struct Parser<'a> {
    src: &'a [char],
    tokens: Vec<Token>,
    pos: usize,
}

impl Parser<'_> {
    fn peek(&self) -> Token {
        self.tokens[self.pos]
    }

    fn at(&self, kind: Tok) -> bool {
        self.peek().kind == kind
    }

    fn advance(&mut self) -> Token {
        let t = self.peek();
        if t.kind != Tok::Eof {
            self.pos += 1;
        }
        t
    }

    fn eat(&mut self, kind: Tok) -> bool {
        let found = self.at(kind);
        if found {
            self.advance();
        }
        found
    }

    fn text(&self, t: Token) -> String {
        self.src[t.start..t.end].iter().collect()
    }

    fn expect(&mut self, kind: Tok, what: &str) -> Result<Token> {
        if self.at(kind) {
            return Ok(self.advance());
        }
        let t = self.peek();
        let found = if t.kind == Tok::Eof { "the end of the file".to_string() } else { format!("`{}`", self.text(t)) };
        err(format!("expected {what}, found {found}"), span(t))
    }

    fn expect_semi(&mut self) -> Result<()> {
        if self.eat(Tok::Semicolon) {
            return Ok(());
        }
        let prev = self.tokens[self.pos.saturating_sub(1)];
        err("missing `;` after this", span(prev))
    }

    // ---- statements ----

    fn function(&mut self) -> Result<Stmt> {
        let kw = self.advance();
        let name = self.expect(Tok::Ident, "a function name after `fn`")?;
        self.expect(Tok::LParen, "`(` after the function name")?;
        let mut params = Vec::new();
        while !self.at(Tok::RParen) {
            let p = self.expect(Tok::Ident, "a parameter name")?;
            params.push(self.text(p));
            if !self.eat(Tok::Comma) {
                break;
            }
        }
        let close = self.expect(Tok::RParen, "`)` after the parameters")?;
        let body = self.block()?;
        Ok(Stmt {
            kind: StmtKind::Fn(FnDecl { name: self.text(name), params, body }),
            span: span(kw).join(span(close)),
        })
    }

    fn statement(&mut self) -> Result<Stmt> {
        let t = self.peek();
        match t.kind {
            Tok::Fn => err("functions can only be declared at the top level, not inside a block", span(t)),
            Tok::Let => {
                let s = self.let_stmt()?;
                self.expect_semi()?;
                Ok(s)
            }
            Tok::If => self.if_stmt(),
            Tok::While => {
                self.advance();
                let (cond, close) = self.condition()?;
                let body = self.block()?;
                Ok(Stmt { kind: StmtKind::While { cond, body }, span: span(t).join(close) })
            }
            Tok::For => self.for_stmt(),
            Tok::Return => {
                self.advance();
                let value = if self.at(Tok::Semicolon) { None } else { Some(self.expression()?) };
                let end = value.as_ref().map_or(span(t), |v| v.span);
                self.expect_semi()?;
                Ok(Stmt { kind: StmtKind::Return(value), span: span(t).join(end) })
            }
            Tok::LBrace => {
                let b = self.block()?;
                Ok(Stmt { span: span(t).join(b.close), kind: StmtKind::Block(b) })
            }
            _ => {
                let s = self.simple_stmt()?;
                self.expect_semi()?;
                Ok(s)
            }
        }
    }

    /// `let name = value` (without the `;`, so `for` can reuse it).
    fn let_stmt(&mut self) -> Result<Stmt> {
        let kw = self.advance();
        let name = self.expect(Tok::Ident, "a variable name after `let`")?;
        self.expect(Tok::Assign, "`=` (a new variable needs a starting value, like `let x = 0;`)")?;
        let value = self.expression()?;
        Ok(Stmt { span: span(kw).join(value.span), kind: StmtKind::Let { name: self.text(name), value } })
    }

    /// An assignment (`x = 1`, `a[i] += 2`) or a bare expression (`f(x)`).
    fn simple_stmt(&mut self) -> Result<Stmt> {
        let target = self.expression()?;
        let op = match self.peek().kind {
            Tok::Assign => None,
            Tok::PlusAssign => Some(BinOp::Add),
            Tok::MinusAssign => Some(BinOp::Sub),
            Tok::StarAssign => Some(BinOp::Mul),
            Tok::SlashAssign => Some(BinOp::Div),
            _ => return Ok(Stmt { span: target.span, kind: StmtKind::Expr(target) }),
        };
        self.advance();
        if !matches!(target.kind, ExprKind::Var(_) | ExprKind::Index(..)) {
            return err("you can only assign to a variable or an array element", target.span);
        }
        let rhs = self.expression()?;
        // `x += e` is shorthand: the parser rewrites it to `x = x + e`.
        let value = match op {
            None => rhs,
            Some(op) => Expr {
                span: target.span.join(rhs.span),
                kind: ExprKind::Binary(op, Box::new(target.clone()), Box::new(rhs)),
            },
        };
        Ok(Stmt { span: target.span.join(value.span), kind: StmtKind::Assign { target, value } })
    }

    fn if_stmt(&mut self) -> Result<Stmt> {
        let kw = self.advance();
        let (cond, close) = self.condition()?;
        let then = self.block()?;
        let els = if !self.eat(Tok::Else) {
            None
        } else if self.at(Tok::If) {
            // `else if` is just an `else` block holding another `if`.
            let nested = self.if_stmt()?;
            Some(Block { close: nested.span, stmts: vec![nested] })
        } else {
            Some(self.block()?)
        };
        Ok(Stmt { kind: StmtKind::If { cond, then, els }, span: span(kw).join(close) })
    }

    fn for_stmt(&mut self) -> Result<Stmt> {
        let kw = self.advance();
        self.expect(Tok::LParen, "`(` after `for`")?;
        let init = match self.peek().kind {
            Tok::Semicolon => None,
            Tok::Let => Some(Box::new(self.let_stmt()?)),
            _ => Some(Box::new(self.simple_stmt()?)),
        };
        self.expect(Tok::Semicolon, "`;` after the first part of `for (...)`")?;
        let cond = if self.at(Tok::Semicolon) { None } else { Some(self.expression()?) };
        self.expect(Tok::Semicolon, "`;` after the loop condition")?;
        let update = if self.at(Tok::RParen) { None } else { Some(Box::new(self.simple_stmt()?)) };
        let close = self.expect(Tok::RParen, "`)` to close `for (...)`")?;
        let body = self.block()?;
        Ok(Stmt { kind: StmtKind::For { init, cond, update, body }, span: span(kw).join(span(close)) })
    }

    /// `( expr )` after `if` and `while`. Returns the span of the `)` too.
    fn condition(&mut self) -> Result<(Expr, Span)> {
        self.expect(Tok::LParen, "`(` before the condition")?;
        let cond = self.expression()?;
        let close = self.expect(Tok::RParen, "`)` after the condition")?;
        Ok((cond, span(close)))
    }

    fn block(&mut self) -> Result<Block> {
        let open = self.expect(Tok::LBrace, "`{`")?;
        let mut stmts = Vec::new();
        while !self.at(Tok::RBrace) {
            if self.at(Tok::Eof) {
                return err("this `{` is never closed", span(open));
            }
            stmts.push(self.statement()?);
        }
        let close = self.advance();
        Ok(Block { stmts, close: span(close) })
    }

    // ---- expressions, from loosest to tightest binding ----

    fn expression(&mut self) -> Result<Expr> {
        self.or()
    }

    fn or(&mut self) -> Result<Expr> {
        let mut left = self.and()?;
        while self.eat(Tok::OrOr) {
            let right = self.and()?;
            let span = left.span.join(right.span);
            left = Expr { span, kind: ExprKind::Or(Box::new(left), Box::new(right)) };
        }
        Ok(left)
    }

    fn and(&mut self) -> Result<Expr> {
        let mut left = self.equality()?;
        while self.eat(Tok::AndAnd) {
            let right = self.equality()?;
            let span = left.span.join(right.span);
            left = Expr { span, kind: ExprKind::And(Box::new(left), Box::new(right)) };
        }
        Ok(left)
    }

    fn equality(&mut self) -> Result<Expr> {
        self.binary(Self::comparison, &[(Tok::EqEq, BinOp::Eq), (Tok::NotEq, BinOp::Ne)])
    }

    fn comparison(&mut self) -> Result<Expr> {
        self.binary(
            Self::term,
            &[(Tok::Less, BinOp::Lt), (Tok::LessEq, BinOp::Le), (Tok::Greater, BinOp::Gt), (Tok::GreaterEq, BinOp::Ge)],
        )
    }

    fn term(&mut self) -> Result<Expr> {
        self.binary(Self::factor, &[(Tok::Plus, BinOp::Add), (Tok::Minus, BinOp::Sub)])
    }

    fn factor(&mut self) -> Result<Expr> {
        self.binary(Self::unary, &[(Tok::Star, BinOp::Mul), (Tok::Slash, BinOp::Div), (Tok::Percent, BinOp::Mod)])
    }

    /// One precedence level: `next (op next)*`, grouping to the left.
    fn binary(&mut self, next: fn(&mut Self) -> Result<Expr>, ops: &[(Tok, BinOp)]) -> Result<Expr> {
        let mut left = next(self)?;
        while let Some(&(_, op)) = ops.iter().find(|(t, _)| self.at(*t)) {
            self.advance();
            let right = next(self)?;
            let span = left.span.join(right.span);
            left = Expr { span, kind: ExprKind::Binary(op, Box::new(left), Box::new(right)) };
        }
        Ok(left)
    }

    fn unary(&mut self) -> Result<Expr> {
        let t = self.peek();
        let op = match t.kind {
            Tok::Minus => UnOp::Neg,
            Tok::Bang => UnOp::Not,
            _ => return self.postfix(),
        };
        self.advance();
        let operand = self.unary()?;
        Ok(Expr { span: span(t).join(operand.span), kind: ExprKind::Unary(op, Box::new(operand)) })
    }

    /// Indexing `a[i]` and calls `f(x)`, which can chain: `w[j][0]`.
    fn postfix(&mut self) -> Result<Expr> {
        let mut e = self.primary()?;
        loop {
            if self.eat(Tok::LBracket) {
                let index = self.expression()?;
                let close = self.expect(Tok::RBracket, "`]` after the index")?;
                let span = e.span.join(span(close));
                e = Expr { span, kind: ExprKind::Index(Box::new(e), Box::new(index)) };
            } else if self.at(Tok::LParen) {
                let ExprKind::Var(name) = &e.kind else {
                    return err("only named functions can be called, like `f(x)`", e.span);
                };
                let name = name.clone();
                self.advance();
                let (args, close) = self.list(Tok::RParen, "`)` after the arguments")?;
                e = Expr { span: e.span.join(close), kind: ExprKind::Call(name, args) };
            } else {
                return Ok(e);
            }
        }
    }

    /// Comma-separated expressions up to `end` (a trailing comma is fine).
    fn list(&mut self, end: Tok, what: &str) -> Result<(Vec<Expr>, Span)> {
        let mut items = Vec::new();
        while !self.at(end) {
            items.push(self.expression()?);
            if !self.eat(Tok::Comma) {
                break;
            }
        }
        let close = self.expect(end, what)?;
        Ok((items, span(close)))
    }

    fn primary(&mut self) -> Result<Expr> {
        let t = self.advance();
        let s = span(t);
        let kind = match t.kind {
            Tok::Number => match self.text(t).parse::<f64>() {
                Ok(n) => ExprKind::Num(n),
                Err(_) => return err("this isn't a valid number", s),
            },
            Tok::Str => ExprKind::Str(unescape(&self.src[t.start + 1..t.end - 1])),
            Tok::True => ExprKind::Bool(true),
            Tok::False => ExprKind::Bool(false),
            Tok::Nil => ExprKind::Nil,
            Tok::Ident => ExprKind::Var(self.text(t)),
            Tok::LParen => {
                let inner = self.expression()?;
                self.expect(Tok::RParen, "`)`")?;
                return Ok(inner);
            }
            Tok::LBracket => {
                let (items, close) = self.list(Tok::RBracket, "`]` to close the array")?;
                return Ok(Expr { span: s.join(close), kind: ExprKind::Array(items) });
            }
            Tok::Eof => return err("expected an expression, but the file ended", s),
            _ => return err(format!("expected an expression, found `{}`", self.text(t)), s),
        };
        Ok(Expr { kind, span: s })
    }
}

fn unescape(chars: &[char]) -> String {
    let mut out = String::new();
    let mut it = chars.iter();
    while let Some(&c) = it.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match it.next() {
            Some('n') => out.push('\n'),
            Some('t') => out.push('\t'),
            Some(&other) => out.push(other),
            None => {}
        }
    }
    out
}
