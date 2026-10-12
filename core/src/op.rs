//! The instruction set of the Bitlens virtual machine.
//!
//! An instruction is one opcode byte, sometimes followed by operand bytes.
//! 16-bit operands are stored little-endian (low byte first), the same byte
//! order WebAssembly, x86 and ARM use. So `CONST #5` is the three bytes
//! `01 05 00`.

pub const HALT: u8 = 0x00;
pub const CONST: u8 = 0x01; // u16 constant index
pub const NIL: u8 = 0x02;
pub const TRUE: u8 = 0x03;
pub const FALSE: u8 = 0x04;
pub const POP: u8 = 0x05;
pub const GET_LOCAL: u8 = 0x06; // u16 slot
pub const SET_LOCAL: u8 = 0x07; // u16 slot
pub const GET_GLOBAL: u8 = 0x08; // u16 global index
pub const SET_GLOBAL: u8 = 0x09; // u16 global index
pub const ARRAY: u8 = 0x0a; // u16 element count
pub const GET_INDEX: u8 = 0x0b;
pub const SET_INDEX: u8 = 0x0c;
pub const ADD: u8 = 0x10;
pub const SUB: u8 = 0x11;
pub const MUL: u8 = 0x12;
pub const DIV: u8 = 0x13;
pub const MOD: u8 = 0x14;
pub const NEG: u8 = 0x15;
pub const NOT: u8 = 0x16;
pub const EQ: u8 = 0x18;
pub const NE: u8 = 0x19;
pub const LT: u8 = 0x1a;
pub const LE: u8 = 0x1b;
pub const GT: u8 = 0x1c;
pub const GE: u8 = 0x1d;
pub const JUMP: u8 = 0x20; // u16 target address
pub const JUMP_IF_FALSE: u8 = 0x21; // u16 target address
pub const CALL: u8 = 0x22; // u16 function index, u8 argument count
pub const RETURN: u8 = 0x23;
pub const BUILTIN: u8 = 0x24; // u8 builtin id, u8 argument count

pub fn name(op: u8) -> &'static str {
    match op {
        HALT => "HALT",
        CONST => "CONST",
        NIL => "NIL",
        TRUE => "TRUE",
        FALSE => "FALSE",
        POP => "POP",
        GET_LOCAL => "GET_LOCAL",
        SET_LOCAL => "SET_LOCAL",
        GET_GLOBAL => "GET_GLOBAL",
        SET_GLOBAL => "SET_GLOBAL",
        ARRAY => "ARRAY",
        GET_INDEX => "GET_INDEX",
        SET_INDEX => "SET_INDEX",
        ADD => "ADD",
        SUB => "SUB",
        MUL => "MUL",
        DIV => "DIV",
        MOD => "MOD",
        NEG => "NEG",
        NOT => "NOT",
        EQ => "EQ",
        NE => "NE",
        LT => "LT",
        LE => "LE",
        GT => "GT",
        GE => "GE",
        JUMP => "JUMP",
        JUMP_IF_FALSE => "JUMP_IF_FALSE",
        CALL => "CALL",
        RETURN => "RETURN",
        BUILTIN => "BUILTIN",
        _ => "???",
    }
}

/// The operator a binary instruction implements, for explanations.
pub fn symbol(op: u8) -> &'static str {
    match op {
        ADD => "+",
        SUB => "-",
        MUL => "*",
        DIV => "/",
        MOD => "%",
        EQ => "==",
        NE => "!=",
        LT => "<",
        LE => "<=",
        GT => ">",
        GE => ">=",
        _ => "?",
    }
}

/// Total size of an instruction in bytes, opcode included.
pub fn size(op: u8) -> usize {
    match op {
        CONST | GET_LOCAL | SET_LOCAL | GET_GLOBAL | SET_GLOBAL | ARRAY | JUMP | JUMP_IF_FALSE | BUILTIN => 3,
        CALL => 4,
        _ => 1,
    }
}
