# 2. The lexer

Here's a program in the Bitlens language. It's small and C-like on purpose, so the interesting parts are the machine, not the syntax:

```js
// find w, b so that y ≈ w * x + b
let xs = [1, 2, 3];
let w = 0;
fn predict(x) {
  return w * x + 1;
}
for (let i = 0; i < len(xs); i += 1) {
  print(predict(xs[i]));
}
```

The **lexer** (or tokenizer) is the first stage. It turns the raw characters into **tokens**: `let`, `xs`, `=`, `[`, `1`, `,` and so on, and it throws away whitespace. It doesn't know what a statement is; it only knows what a word or an operator looks like.

## Tokens remember where they came from

Every later stage will want to point back at the source: the parser for errors, the compiler to tag each instruction, the debugger to highlight the line that's running. So a token is its kind plus its position, counted in characters:

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tok {
    Number, Str, Ident,
    Let, Fn, If, Else, While, For, Return, True, False, Nil,
    LParen, RParen, LBrace, RBrace, LBracket, RBracket, Comma, Semicolon,
    Plus, Minus, Star, Slash, Percent, Bang,
    Assign, PlusAssign, MinusAssign, StarAssign, SlashAssign,
    EqEq, NotEq, Less, LessEq, Greater, GreaterEq, AndAnd, OrOr,
    Comment, Error, Eof,
}

#[derive(Clone, Copy, Debug)]
pub struct Token {
    pub kind: Tok,
    pub start: usize,
    pub end: usize,
}
```

The token doesn't store its text. The parser can slice it out of the source when it needs to (`src[start..end]`), so tokens stay small and `Copy`.

We work on a `&[char]` rather than a `&str`: indexing by character keeps positions simple, and they match the positions JavaScript uses in the editor. (The exception is characters outside Unicode's Basic Multilingual Plane, such as most emoji, which JavaScript counts as two.)

## One loop, one character class at a time

The whole lexer is a single loop in `core/src/lexer.rs`. Look at the current character, decide what kind of token starts here, and advance `i` to its end:

```rust
pub fn tokenize(src: &[char]) -> Vec<Token> {
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < src.len() {
        let start = i;
        let c = src[i];
        let next = src.get(i + 1).copied().unwrap_or('\0');
        let kind = if c.is_whitespace() {
            i += 1;
            continue;
        } else if c == '/' && next == '/' {
            while i < src.len() && src[i] != '\n' {
                i += 1;
            }
            Tok::Comment
        } else if c.is_ascii_digit() {
            i = number_end(src, i);
            Tok::Number
        } else if c.is_alphabetic() || c == '_' {
            while i < src.len() && (src[i].is_alphanumeric() || src[i] == '_') {
                i += 1;
            }
            keyword(&src[start..i])
        } else if c == '"' {
            // ... scan to the closing quote, skipping \" escapes; Tok::Error if unterminated
        } else {
            // ... operators, longest match first
        };
        tokens.push(Token { kind, start, end: i });
    }
    tokens.push(Token { kind: Tok::Eof, start: src.len(), end: src.len() });
    tokens
}
```

A few choices worth noting:

- **Keywords are identifiers first.** We scan a whole word, then `keyword()` checks whether it's `let`, `while` and so on. That's why `letter` is an identifier and not `let` followed by `ter`.
- **Operators use the longest match.** `<=` must win over `<`, and `+=` over `+`, so we match on `(current, next)` pairs with the two-character cases first:

  ```rust
  let (kind, len) = match (c, next) {
      ('=', '=') => (Tok::EqEq, 2),
      ('<', '=') => (Tok::LessEq, 2),
      ('+', '=') => (Tok::PlusAssign, 2),
      // ...
      ('<', _) => (Tok::Less, 1),
      ('=', _) => (Tok::Assign, 1),
      _ => (Tok::Error, 1),
  };
  ```

- **Errors are tokens too.** An unknown character or an unterminated string becomes `Tok::Error` instead of stopping the lexer. The parser reports it with a precise location, and the editor can still highlight everything around it while you type.
- **Comments are tokens too.** The parser filters them out, but the editor needs them for coloring.

Numbers accept an optional fraction and exponent (`3`, `0.25`, `1e-8`). We only find where the number ends here; turning the text into an `f64` is the parser's job:

```rust
fn number_end(src: &[char], mut i: usize) -> usize {
    let digit = |i: usize| src.get(i).is_some_and(|c| c.is_ascii_digit());
    while digit(i) { i += 1; }
    if src.get(i) == Some(&'.') && digit(i + 1) {
        i += 1;
        while digit(i) { i += 1; }
    }
    if matches!(src.get(i), Some('e' | 'E')) {
        let j = if matches!(src.get(i + 1), Some('+' | '-')) { i + 2 } else { i + 1 };
        if digit(j) {
            i = j;
            while digit(i) { i += 1; }
        }
    }
    i
}
```

## One lexer, two jobs

Because the lexer keeps comments and errors, it doubles as the **syntax highlighter**. A tiny function maps each token kind to a CSS class:

```rust
pub fn class(kind: Tok) -> &'static str {
    use Tok::*;
    match kind {
        Number => "num",
        Str => "str",
        Ident => "id",
        Let | Fn | If | Else | While | For | Return => "kw",
        True | False | Nil => "lit",
        LParen | RParen | LBrace | RBrace | LBracket | RBracket | Comma | Semicolon => "punct",
        Comment => "cm",
        Error => "err",
        _ => "op",
    }
}
```

In chapter 7 the editor calls this through WebAssembly on every keystroke, so the colors you see always agree with what the compiler understands.

## Checkpoint

```rust
let src: Vec<char> = "let x = 1.5e3; // hi".chars().collect();
let kinds: Vec<Tok> = tokenize(&src).iter().map(|t| t.kind).collect();
assert_eq!(kinds, [Tok::Let, Tok::Ident, Tok::Assign, Tok::Number, Tok::Semicolon, Tok::Comment, Tok::Eof]);
```

## Exercises

1. Add hexadecimal literals like `0xff`. Which other files will have to change?
2. Support `/* block comments */`. What should happen when one is never closed?

Next: [The parser →](03-parser.md)
