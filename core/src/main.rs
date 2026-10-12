//! `bitlens`: run a program from the terminal.
//!
//!     cargo run -- ../examples/hello.bl            run it
//!     cargo run -- ../examples/hello.bl --disasm   show the bytecode first
//!     cargo run -- ../examples/hello.bl --trace    print every instruction as it runs

use std::process::exit;

use bitlens_core::compiler::disassemble;
use bitlens_core::load;
use bitlens_core::parser::Span;
use bitlens_core::vm::Status;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let flag = |f: &str| args.iter().any(|a| a == f);
    let Some(path) = args.iter().find(|a| !a.starts_with("--")) else {
        eprintln!("usage: bitlens <file.bl> [--disasm] [--trace]");
        exit(2);
    };
    let src = std::fs::read_to_string(path).unwrap_or_else(|e| {
        eprintln!("{path}: {e}");
        exit(1);
    });
    let mut vm = load(&src).unwrap_or_else(|e| {
        report(&src, path, e.span, &e.msg);
        exit(1);
    });

    let listing = disassemble(&vm.prog);
    if flag("--disasm") {
        for ins in &listing {
            let bytes: Vec<String> = vm.prog.code[ins.ip..ins.ip + ins.size].iter().map(|b| format!("{b:02x}")).collect();
            println!("{:04}  {:<12} {}", ins.ip, bytes.join(" "), ins.text);
        }
        println!();
    }

    let trace = flag("--trace");
    loop {
        let status = if trace {
            let text = listing.iter().find(|i| i.ip == vm.ip).map_or("", |i| i.text.as_str());
            let stack: Vec<String> = vm.stack.iter().map(|&v| vm.repr(v, 1)).collect();
            eprintln!("{:04}  {:<28} [{}]", vm.ip, text, stack.join(", "));
            vm.run(1, false)
        } else {
            vm.run(1_000_000, false)
        };
        print!("{}", vm.output);
        vm.output.clear();
        match status {
            Status::Halted => break,
            Status::Error => {
                let e = vm.error.clone().unwrap();
                report(&src, path, e.span, &format!("runtime error: {}", e.msg));
                exit(1);
            }
            _ => {}
        }
    }
    if trace {
        eprintln!("halted after {} instructions", vm.steps);
    }
}

/// Print `file:line:col: message` with the source line and a caret underneath.
fn report(src: &str, path: &str, span: Span, msg: &str) {
    let chars: Vec<char> = src.chars().collect();
    let start = (span.start as usize).min(chars.len());
    let line_start = chars[..start].iter().rposition(|&c| c == '\n').map_or(0, |i| i + 1);
    let line_end = chars[start..].iter().position(|&c| c == '\n').map_or(chars.len(), |i| start + i);
    let line_no = chars[..start].iter().filter(|&&c| c == '\n').count() + 1;
    let col = start - line_start;
    let width = (span.end as usize).min(line_end).saturating_sub(start).max(1);
    let line: String = chars[line_start..line_end].iter().collect();
    eprintln!("{path}:{line_no}:{}: {msg}", col + 1);
    eprintln!("  {line}");
    eprintln!("  {}{}", " ".repeat(col), "^".repeat(width));
}
