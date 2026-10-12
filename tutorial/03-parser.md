# 3. The parser

Tokens are flat. Programs are not: a `for` loop contains a block, which contains statements, which contain expressions, which contain smaller expressions. The **parser** recovers that structure and builds an **abstract syntax tree** (AST).

## The tree

Every node carries a `Span`, the character range it came from. Errors will use it to underline the right code, and the compiler will stamp it onto every instruction it emits, which is how the IDE highlights the exact expression being evaluated.

```rust
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Span {
    pub start: u32,
    pub end: u32,
}

pub struct Expr {
    pub kind: ExprKind,
    pub span: Span,
}

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

pub enum StmtKind {
    Let { name: String, value: Expr },
    Assign { target: Expr, value: Expr },  // target is a Var or an Index
    Expr(Expr),
    If { cond: Expr, then: Block, els: Option<Block> },
    While { cond: Expr, body: Block },
    For { init: Option<Box<Stmt>>, cond: Option<Expr>, update: Option<Box<Stmt>>, body: Block },
    Return(Option<Expr>),
    Block(Block),
    Fn(FnDecl),
}
```

`And` and `Or` get their own variants instead of being ordinary `Binary` operators because they **short-circuit**: in `false && f()`, `f` must never run. The compiler will need to treat them specially.

`Block` remembers its closing brace. That's where the block's variables die, and the debugger will highlight the `}` while it pops them off the stack.

## Recursive descent

We'll write a **recursive-descent** parser: one function per grammar rule, each calling the rules below it. This is the grammar, loosest binding first:

```text
program     → (function | statement)*
statement   → let | if | while | for | return | block | simple ";"
simple      → expression (("=" | "+=" | "-=" | "*=" | "/=") expression)?
expression  → or
or          → and ("||" and)*
and         → equality ("&&" equality)*
equality    → comparison (("==" | "!=") comparison)*
comparison  → term (("<" | "<=" | ">" | ">=") term)*
term        → factor (("+" | "-") factor)*
factor      → unary (("*" | "/" | "%") unary)*
unary       → ("-" | "!") unary | postfix
postfix     → primary ("[" expression "]" | "(" arguments ")")*
primary     → NUMBER | STRING | true | false | nil | IDENT | "(" expression ")" | "[" elements "]"
```

**Precedence falls out of the call order.** `term` calls `factor` for each operand, so in `1 + 2 * 3` the `factor` call swallows `2 * 3` whole before `term` ever sees the `+`. The four binary levels are identical apart from their operators and the level below, so one helper does all of them:

```rust
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

fn term(&mut self) -> Result<Expr> {
    self.binary(Self::factor, &[(Tok::Plus, BinOp::Add), (Tok::Minus, BinOp::Sub)])
}

fn factor(&mut self) -> Result<Expr> {
    self.binary(Self::unary, &[(Tok::Star, BinOp::Mul), (Tok::Slash, BinOp::Div), (Tok::Percent, BinOp::Mod)])
}
```

The `while` loop makes operators **left-associative**: `10 - 4 - 3` becomes `(10 - 4) - 3 = 3`, not `10 - (4 - 3) = 9`.

`postfix` handles indexing and calls, which can chain (`w1[j][0]` in the neural network level):

```rust
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
            // ... parse the arguments into ExprKind::Call(name, args)
        } else {
            return Ok(e);
        }
    }
}
```

## Assignment and sugar

Assignment parses as "an expression, then maybe `=`". That handles both `x = 1` and `a[i] = 1` with one rule, after which we check that the left side really is something you can assign to:

```rust
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
```

Rewriting `+=` here (desugaring) means the compiler and VM never learn it exists. The same trick turns `else if` into an `else` block holding a single `if`.

## Errors people can act on

A parser meets broken code constantly, because the editor recompiles on every keystroke. Our rule is to report the **first** error, at a precise span, in words a beginner understands:

```rust
fn expect(&mut self, kind: Tok, what: &str) -> Result<Token> {
    if self.at(kind) {
        return Ok(self.advance());
    }
    let t = self.peek();
    let found = if t.kind == Tok::Eof { "the end of the file".to_string() } else { format!("`{}`", self.text(t)) };
    err(format!("expected {what}, found {found}"), span(t))
}
```

Missing semicolons get special treatment: the useful place to point is the end of the **previous** token, not the start of the next line:

```rust
fn expect_semi(&mut self) -> Result<()> {
    if self.eat(Tok::Semicolon) {
        return Ok(());
    }
    let prev = self.tokens[self.pos.saturating_sub(1)];
    err("missing `;` after this", span(prev))
}
```

## Checkpoint

The repository's `core/tests/language.rs` pins down precedence and error messages:

```rust
assert_eq!(output("print(1 + 2 * 3, (1 + 2) * 3, 10 - 4 - 3, -2 * 3);"), "7 9 3 -6\n");
assert!(compile_error("let x = 1").contains("missing `;`"));
assert!(compile_error("1 + 2 = 3;").contains("only assign"));
```

These go through the whole pipeline, so they'll pass once chapter 5 is done.

## Exercises

1. Add `break` and `continue`. The parser part is easy; think about what the compiler will need (chapter 4).
2. Add a ternary `cond ? a : b`. Where in the precedence chain does it belong?

Next: [The compiler →](04-compiler.md)
