//! Every Bitlens value is exactly 64 bits.
//!
//! A number is stored as a plain IEEE-754 double. Every other value hides
//! inside the bit patterns of a "quiet NaN": when bits 50 to 62 are all 1 the
//! word can't be a real number, so the low bits are free to mean something
//! else. This trick is called NaN-boxing.
//!
//! ```text
//!               sign exponent    mantissa
//! 0.1         = 0    01111111011 1001100110011001100110011001100110011001100110011010
//! nil         = 0    11111111111 1100000000000000000000000000000000000000000000000001
//! true        = 0    11111111111 1100000000000000000000000000000000000000000000000011
//! heap ref @7 = 1    11111111111 1100000000000000000000000000000000000000000000000111
//! ```

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

    pub fn bool(b: bool) -> Value {
        if b { Value::TRUE } else { Value::FALSE }
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

    pub fn is_num(self) -> bool {
        self.kind() == Kind::Num
    }

    pub fn as_num(self) -> f64 {
        f64::from_bits(self.0)
    }

    /// The heap address stored in the low 32 bits of a reference.
    pub fn as_ref(self) -> usize {
        (self.0 & 0xffff_ffff) as usize
    }

    /// Only `nil` and `false` count as false in a condition.
    pub fn is_truthy(self) -> bool {
        self != Value::NIL && self != Value::FALSE
    }
}

/// Objects that are too big for 64 bits live on the heap.
#[derive(Clone, Debug)]
pub enum Obj {
    Str(String),
    Array(Vec<Value>),
}

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
