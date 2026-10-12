//! Step 1: the lexer turns raw characters into tokens.
//!
//! `let w = 0.5;` becomes `Let`, `Ident`, `Assign`, `Number`, `Semicolon`.
//! Each token remembers where it came from (`start..end`, counted in
//! characters) so later stages can point back at the exact source text. The
//! web editor uses this same lexer for syntax highlighting.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tok {
    Number,
    Str,
    Ident,
    // keywords
    Let,
    Fn,
    If,
    Else,
    While,
    For,
    Return,
    True,
    False,
    Nil,
    // punctuation
    LParen,
    RParen,
    LBrace,
    RBrace,
    LBracket,
    RBracket,
    Comma,
    Semicolon,
    // operators
    Plus,
    Minus,
    Star,
    Slash,
    Percent,
    Bang,
    Assign,
    PlusAssign,
    MinusAssign,
    StarAssign,
    SlashAssign,
    EqEq,
    NotEq,
    Less,
    LessEq,
    Greater,
    GreaterEq,
    AndAnd,
    OrOr,
    // everything else
    Comment,
    Error,
    Eof,
}

#[derive(Clone, Copy, Debug)]
pub struct Token {
    pub kind: Tok,
    pub start: usize,
    pub end: usize,
}

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
            i += 1;
            while i < src.len() && src[i] != '"' && src[i] != '\n' {
                i += if src[i] == '\\' && i + 1 < src.len() { 2 } else { 1 };
            }
            if src.get(i) == Some(&'"') {
                i += 1;
                Tok::Str
            } else {
                Tok::Error
            }
        } else {
            let (kind, len) = match (c, next) {
                ('=', '=') => (Tok::EqEq, 2),
                ('!', '=') => (Tok::NotEq, 2),
                ('<', '=') => (Tok::LessEq, 2),
                ('>', '=') => (Tok::GreaterEq, 2),
                ('&', '&') => (Tok::AndAnd, 2),
                ('|', '|') => (Tok::OrOr, 2),
                ('+', '=') => (Tok::PlusAssign, 2),
                ('-', '=') => (Tok::MinusAssign, 2),
                ('*', '=') => (Tok::StarAssign, 2),
                ('/', '=') => (Tok::SlashAssign, 2),
                ('(', _) => (Tok::LParen, 1),
                (')', _) => (Tok::RParen, 1),
                ('{', _) => (Tok::LBrace, 1),
                ('}', _) => (Tok::RBrace, 1),
                ('[', _) => (Tok::LBracket, 1),
                (']', _) => (Tok::RBracket, 1),
                (',', _) => (Tok::Comma, 1),
                (';', _) => (Tok::Semicolon, 1),
                ('+', _) => (Tok::Plus, 1),
                ('-', _) => (Tok::Minus, 1),
                ('*', _) => (Tok::Star, 1),
                ('/', _) => (Tok::Slash, 1),
                ('%', _) => (Tok::Percent, 1),
                ('!', _) => (Tok::Bang, 1),
                ('=', _) => (Tok::Assign, 1),
                ('<', _) => (Tok::Less, 1),
                ('>', _) => (Tok::Greater, 1),
                _ => (Tok::Error, 1),
            };
            i += len;
            kind
        };
        tokens.push(Token { kind, start, end: i });
    }
    tokens.push(Token { kind: Tok::Eof, start: src.len(), end: src.len() });
    tokens
}

/// Digits, an optional fraction (`.5`) and an optional exponent (`e-3`).
fn number_end(src: &[char], mut i: usize) -> usize {
    let digit = |i: usize| src.get(i).is_some_and(|c| c.is_ascii_digit());
    while digit(i) {
        i += 1;
    }
    if src.get(i) == Some(&'.') && digit(i + 1) {
        i += 1;
        while digit(i) {
            i += 1;
        }
    }
    if matches!(src.get(i), Some('e' | 'E')) {
        let j = if matches!(src.get(i + 1), Some('+' | '-')) { i + 2 } else { i + 1 };
        if digit(j) {
            i = j;
            while digit(i) {
                i += 1;
            }
        }
    }
    i
}

fn keyword(word: &[char]) -> Tok {
    match word.iter().collect::<String>().as_str() {
        "let" => Tok::Let,
        "fn" => Tok::Fn,
        "if" => Tok::If,
        "else" => Tok::Else,
        "while" => Tok::While,
        "for" => Tok::For,
        "return" => Tok::Return,
        "true" => Tok::True,
        "false" => Tok::False,
        "nil" => Tok::Nil,
        _ => Tok::Ident,
    }
}

/// The CSS class the editor uses to color a token.
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
