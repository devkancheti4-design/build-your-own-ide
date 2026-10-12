//! Every level program must compile, run to the end, and print what the
//! tutorial says it prints.

use bitlens_core::load;
use bitlens_core::vm::{Status, Vm};

fn run(src: &str) -> Vm {
    let mut vm = load(src).unwrap_or_else(|e| panic!("compile error: {}", e.msg));
    let status = vm.run(100_000_000, false);
    assert_eq!(status, Status::Halted, "runtime error: {:?}", vm.error.as_ref().map(|e| &e.msg));
    vm
}

fn global(vm: &Vm, name: &str) -> f64 {
    let i = vm.prog.globals.iter().position(|g| g == name).unwrap();
    vm.globals[i].as_num()
}

#[test]
fn hello() {
    assert!(run(include_str!("../../examples/01_hello.bl")).output.contains("the answer is 42"));
}

#[test]
fn floats() {
    let out = run(include_str!("../../examples/02_floats.bl")).output;
    assert!(out.contains("0.1 + 0.2 = 0.30000000000000004"));
    assert!(out.contains("equal to 0.3? false"));
    assert!(out.contains("2^53 + 1 = 9007199254740992"));
    assert!(out.contains("0 / 0 = NaN"));
}

#[test]
fn call_stack() {
    assert!(run(include_str!("../../examples/03_call_stack.bl")).output.contains("fib(6) = 8"));
}

#[test]
fn heap() {
    let out = run(include_str!("../../examples/04_heap.bl")).output;
    assert!(out.contains("alias: [1, 2, 4, 5, 8]"));
}

#[test]
fn gradient_descent() {
    let vm = run(include_str!("../../examples/05_gradient_descent.bl"));
    assert!((global(&vm, "w") - 2.0).abs() < 0.05);
    assert!((global(&vm, "b") - 1.0).abs() < 0.1);
}

#[test]
fn perceptron() {
    let vm = run(include_str!("../../examples/06_perceptron.bl"));
    assert_eq!(global(&vm, "mistakes"), 0.0);
}

#[test]
fn kmeans() {
    let out = run(include_str!("../../examples/07_kmeans.bl")).output;
    assert!(out.contains("groups: [0, 0, 1, 1, 1, 1, 1, 0, 1, 0]"));
}

#[test]
fn backprop_learns_xor() {
    let vm = run(include_str!("../../examples/08_backprop_xor.bl"));
    assert!(global(&vm, "loss") < 0.01);
}

#[test]
fn softmax() {
    let vm = run(include_str!("../../examples/09_softmax.bl"));
    assert!(vm.output.contains("softmax([1000, 1001, 1002]) = [0.09003057317038046"));
    assert!(global(&vm, "loss") < 0.05);
}

#[test]
fn adam_beats_gradient_descent() {
    let vm = run(include_str!("../../examples/10_adam.bl"));
    assert!((global(&vm, "ax") - 1.0).abs() < 0.1);
    assert!((global(&vm, "x") - 1.0).abs() > 0.5);
}

#[test]
fn bigram() {
    let vm = run(include_str!("../../examples/11_bigram.bl"));
    assert!(global(&vm, "perplexity") > 1.0 && global(&vm, "perplexity") < 3.0);
}

#[test]
fn attention_rows_sum_to_one() {
    let vm = run(include_str!("../../examples/12_attention.bl"));
    let chart = vm.charts.iter().find(|c| c.name.starts_with("attention")).unwrap();
    for row in &chart.matrix {
        assert!((row.iter().sum::<f64>() - 1.0).abs() < 1e-12);
    }
}

#[test]
fn transformer_block() {
    let vm = run(include_str!("../../examples/13_transformer_block.bl"));
    assert_eq!(vm.charts.len(), 2);
}
