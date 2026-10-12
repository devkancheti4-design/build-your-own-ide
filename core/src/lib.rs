//! Bitlens core: a tiny programming language, its compiler, and a virtual
//! machine you can pause after every single instruction.
//!
//! The pipeline is the same one real languages use:
//!
//! ```text
//! source text ─lexer─▶ tokens ─parser─▶ syntax tree ─compiler─▶ bytecode ─vm─▶ results
//! ```
//!
//! Built natively it's a library plus the `bitlens` command-line runner.
//! Built for `wasm32-unknown-unknown` it's the engine of the web IDE, which
//! talks to it through the functions at the bottom of this file.

pub mod builtins;
pub mod compiler;
pub mod explain;
pub mod inspect;
pub mod lexer;
pub mod op;
pub mod parser;
pub mod value;
pub mod vm;

use std::cell::RefCell;

use vm::Vm;

/// Compile source code into a machine that's ready to run.
pub fn load(src: &str) -> Result<Vm, parser::CompileError> {
    let chars: Vec<char> = src.chars().collect();
    let ast = parser::parse(&chars)?;
    let prog = compiler::compile(&chars, &ast)?;
    Ok(Vm::new(prog))
}

// ---------------------------------------------------------------------------
// The WebAssembly interface.
//
// A WebAssembly function can only take and return numbers. To pass a string
// in, JavaScript asks us for memory (`alloc`), copies UTF-8 bytes into it and
// hands us the pointer and length. To pass results out, we keep the latest
// JSON string in `OUT`, and JavaScript reads it straight out of our memory
// using `out_ptr()` and `out_len()`.
// ---------------------------------------------------------------------------

thread_local! {
    static VM: RefCell<Option<Vm>> = const { RefCell::new(None) };
    static OUT: RefCell<String> = const { RefCell::new(String::new()) };
}

fn set_out(s: String) {
    OUT.with(|o| *o.borrow_mut() = s);
}

fn with_vm<R>(f: impl FnOnce(&mut Vm) -> R) -> Option<R> {
    VM.with(|vm| vm.borrow_mut().as_mut().map(f))
}

/// Take back a buffer that JavaScript got from `alloc` and filled with UTF-8.
unsafe fn take_string(ptr: *mut u8, len: usize) -> String {
    let bytes = unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)) };
    String::from_utf8_lossy(&bytes).into_owned()
}

/// Reserve `len` bytes for JavaScript to write into.
#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    Box::into_raw(vec![0u8; len].into_boxed_slice()) as *mut u8
}

#[unsafe(no_mangle)]
pub extern "C" fn out_ptr() -> *const u8 {
    OUT.with(|o| o.borrow().as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn out_len() -> usize {
    OUT.with(|o| o.borrow().len())
}

/// Syntax highlighting: `[[class, start, end], ...]`.
///
/// # Safety
/// `ptr` and `len` must come from `alloc`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn tokenize(ptr: *mut u8, len: usize) {
    let src = unsafe { take_string(ptr, len) };
    let chars: Vec<char> = src.chars().collect();
    set_out(inspect::tokens_json(&chars));
}

/// Compile a program and get a fresh machine for it. Returns 1 on success
/// and 0 on a compile error; either way the details are in the output.
///
/// # Safety
/// `ptr` and `len` must come from `alloc`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn compile(ptr: *mut u8, len: usize) -> u32 {
    let src = unsafe { take_string(ptr, len) };
    let (json, vm, ok) = match load(&src) {
        Ok(mut vm) => {
            vm.breakpoints = with_vm(|old| old.breakpoints.clone()).unwrap_or_default();
            (inspect::program_json(&vm.prog), Some(vm), 1)
        }
        Err(e) => (inspect::error_json(&e), None, 0),
    };
    set_out(json);
    VM.with(|cell| *cell.borrow_mut() = vm);
    ok
}

#[unsafe(no_mangle)]
pub extern "C" fn reset() {
    with_vm(|vm| vm.reset());
}

/// Run up to `max` instructions, stopping at breakpoints. Returns the status
/// (0 ready, 1 paused, 2 breakpoint, 3 halted, 4 error, 5 nothing loaded).
#[unsafe(no_mangle)]
pub extern "C" fn run(max: u32) -> u32 {
    with_vm(|vm| vm.run(max, true) as u32).unwrap_or(5)
}

/// Execute exactly one instruction.
#[unsafe(no_mangle)]
pub extern "C" fn step() -> u32 {
    with_vm(|vm| vm.run(1, false) as u32).unwrap_or(5)
}

#[unsafe(no_mangle)]
pub extern "C" fn step_line(max: u32) -> u32 {
    with_vm(|vm| vm.step_line(max) as u32).unwrap_or(5)
}

/// Set breakpoints from a comma-separated list of line numbers, like "3,7".
///
/// # Safety
/// `ptr` and `len` must come from `alloc`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn set_breakpoints(ptr: *mut u8, len: usize) {
    let lines: Vec<u32> = unsafe { take_string(ptr, len) }.split(',').filter_map(|s| s.trim().parse().ok()).collect();
    with_vm(|vm| vm.breakpoints = lines);
}

/// A full snapshot of the machine as JSON.
#[unsafe(no_mangle)]
pub extern "C" fn state() {
    set_out(with_vm(|vm| inspect::state_json(vm)).unwrap_or_else(|| "null".into()));
}

/// Every chart the program has drawn, as JSON.
#[unsafe(no_mangle)]
pub extern "C" fn charts() {
    set_out(with_vm(|vm| inspect::charts_json(vm)).unwrap_or_else(|| "[]".into()));
}
