//! The language and the machine, one feature at a time.

use bitlens_core::lexer::{Tok, tokenize};
use bitlens_core::load;
use bitlens_core::value::{Kind, Value};
use bitlens_core::vm::Status;

fn output(src: &str) -> String {
    let mut vm = load(src).unwrap_or_else(|e| panic!("compile error: {}", e.msg));
    assert_eq!(vm.run(1_000_000, false), Status::Halted, "{:?}", vm.error.as_ref().map(|e| &e.msg));
    vm.output
}

fn compile_error(src: &str) -> String {
    match load(src) {
        Ok(_) => panic!("expected a compile error"),
        Err(e) => e.msg,
    }
}

fn runtime_error(src: &str) -> String {
    let mut vm = load(src).unwrap();
    assert_eq!(vm.run(1_000_000, false), Status::Error);
    vm.error.unwrap().msg
}

#[test]
fn nan_boxing_layout() {
    assert_eq!(Value::num(0.1).0, 0x3fb9_9999_9999_999a);
    assert_eq!(Value::NIL.0, 0x7ffc_0000_0000_0001);
    assert_eq!(Value::TRUE.0, 0x7ffc_0000_0000_0003);
    assert_eq!(Value::reference(7).0, 0xfffc_0000_0000_0007);
    assert_eq!(Value::num(f64::NAN).kind(), Kind::Num);
    assert_eq!(Value::num(-f64::NAN).kind(), Kind::Num);
    assert_eq!(Value::num(f64::NEG_INFINITY).kind(), Kind::Num);
    assert_eq!(Value::reference(7).kind(), Kind::Ref);
}

#[test]
fn precedence_and_grouping() {
    assert_eq!(output("print(1 + 2 * 3, (1 + 2) * 3, 10 - 4 - 3, -2 * 3);"), "7 9 3 -6\n");
    assert_eq!(output("print(7 % 3, 1 < 2 == true, !(1 > 2));"), "1 true true\n");
}

#[test]
fn short_circuit_skips_the_right_side() {
    // If the right side ran, the index would be out of bounds.
    assert_eq!(output("let a = [1]; print(false && a[5], true || a[5]);"), "false true\n");
}

#[test]
fn scopes_shadow_and_end() {
    let src = "let x = 1; { let x = 2; print(x); } print(x); for (let i = 0; i < 2; i += 1) { let x = i * 10; print(x); }";
    assert_eq!(output(src), "2\n1\n0\n10\n");
}

#[test]
fn functions_see_globals_and_recurse() {
    let src = "let base = 100; fn f(n) { if (n == 0) { return base; } return f(n - 1) + 1; } print(f(5));";
    assert_eq!(output(src), "105\n");
}

#[test]
fn functions_can_be_called_before_they_are_declared() {
    assert_eq!(output("print(twice(4)); fn twice(x) { return x * 2; }"), "8\n");
}

#[test]
fn arrays_are_references() {
    assert_eq!(output("let a = [1, 2]; let b = a; b[0] = 9; push(a, 3); print(a, b, len(b));"), "[9, 2, 3] [9, 2, 3] 3\n");
}

#[test]
fn compound_assignment() {
    assert_eq!(output("let x = 10; x += 5; x -= 1; x *= 2; x /= 4; let a = [1]; a[0] += 41; print(x, a);"), "7 [42]\n");
}

#[test]
fn strings_concatenate() {
    assert_eq!(output(r#"print("n = " + 3, "a" == "a", len("héllo"));"#), "n = 3 true 5\n");
}

#[test]
fn the_stack_is_clean_after_statements() {
    let mut vm = load("let a = 1; { let b = 2; let c = a + b; } for (let i = 0; i < 3; i += 1) { print(i); }").unwrap();
    vm.run(10_000, false);
    assert!(vm.stack.is_empty(), "stack: {:?}", vm.stack);
}

#[test]
fn compile_errors() {
    assert!(compile_error("let x = ;").contains("expected an expression"));
    assert!(compile_error("print(y);").contains("unknown variable `y`"));
    assert!(compile_error("let x = 1").contains("missing `;`"));
    assert!(compile_error("return 1;").contains("only be used inside a function"));
    assert!(compile_error("fn f(a) {} f(1, 2);").contains("takes 1 argument"));
    assert!(compile_error("let s = \"oops;").contains("never closed"));
    assert!(compile_error("1 + 2 = 3;").contains("only assign"));
    assert!(compile_error("{ let a = 1; let a = 2; }").contains("already declared"));
    assert!(compile_error("if (true) { fn g() {} }").contains("top level"));
    assert!(compile_error("let x = 1 # 2;").contains("unexpected character `#`"));
}

#[test]
fn runtime_errors() {
    assert!(runtime_error("let a = [1, 2]; print(a[2]);").contains("index 2 is out of bounds"));
    assert!(runtime_error("print(1 - nil);").contains("needs two numbers"));
    assert!(runtime_error("fn f(n) { return f(n + 1); } f(0);").contains("stack overflow"));
    assert!(runtime_error("let x = 5; print(x[0]);").contains("cannot index"));
}

#[test]
fn breakpoints_stop_on_a_line() {
    let mut vm = load("let a = 1;\nlet b = 2;\nlet c = 3;\n").unwrap();
    vm.breakpoints = vec![2];
    assert_eq!(vm.run(1000, true), Status::Breakpoint);
    assert_eq!(vm.line(), 2);
    assert_eq!(vm.run(1000, true), Status::Halted);
}

#[test]
fn step_line_moves_one_line() {
    let mut vm = load("let a = 1 + 2;\nlet b = a * 3;\n").unwrap();
    vm.step_line(1000);
    assert_eq!(vm.line(), 2);
}

#[test]
fn steps_counts_instructions() {
    assert_eq!(output("print(steps());"), "0\n");
}

#[test]
fn random_is_reproducible() {
    let a = output("print(random(), random());");
    assert_eq!(a, output("print(random(), random());"));
}

#[test]
fn explainer_uses_real_values() {
    let mut vm = load("let a = 0.1; let b = 0.2; let c = a + b;").unwrap();
    while !bitlens_core::explain::explain(&vm).starts_with("Pop 0.1 and 0.2, add them") {
        vm.step();
        assert!(!vm.finished());
    }
    assert!(bitlens_core::explain::explain(&vm).contains("push 0.30000000000000004"));
    assert!(bitlens_core::explain::explain(&vm).contains("rounds it"));
}

#[test]
fn state_json_is_valid_shape() {
    let mut vm = load("let a = [1, 2]; fn f(x) { return x; } f(a);").unwrap();
    vm.run(5, false);
    let json = bitlens_core::inspect::state_json(&vm);
    assert!(json.starts_with("{\"status\":\"paused\""));
    assert!(json.contains("\"globals\":[{\"name\":\"a\""));
}

#[test]
fn lexer_checkpoint_from_the_tutorial() {
    let src: Vec<char> = "let x = 1.5e3; // hi".chars().collect();
    let kinds: Vec<Tok> = tokenize(&src).iter().map(|t| t.kind).collect();
    assert_eq!(kinds, [Tok::Let, Tok::Ident, Tok::Assign, Tok::Number, Tok::Semicolon, Tok::Comment, Tok::Eof]);
}
