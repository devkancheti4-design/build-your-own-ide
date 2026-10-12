//! Snapshots of the compiler and the machine as JSON, for the web inspector.
//! Hand-written so the core has zero dependencies.

use std::fmt::Write;

use crate::compiler::{Constant, Program, disassemble};
use crate::explain::explain;
use crate::lexer::{class, tokenize};
use crate::parser::{CompileError, Span};
use crate::value::{Kind, Obj, Value, format_num};
use crate::vm::{ChartKind, Status, Vm};

const MAX_HEAP_OBJECTS: usize = 200;
const MAX_ITEMS: usize = 64;

fn string(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

fn span(out: &mut String, s: Span) {
    let _ = write!(out, "[{},{}]", s.start, s.end);
}

pub fn tokens_json(src: &[char]) -> String {
    let mut out = String::from("[");
    for (i, t) in tokenize(src).iter().filter(|t| t.start < t.end).enumerate() {
        if i > 0 {
            out.push(',');
        }
        let _ = write!(out, "[\"{}\",{},{}]", class(t.kind), t.start, t.end);
    }
    out.push(']');
    out
}

pub fn error_json(e: &CompileError) -> String {
    let mut out = String::from("{\"ok\":false,\"error\":{\"msg\":");
    string(&mut out, &e.msg);
    out.push_str(",\"span\":");
    span(&mut out, e.span);
    out.push_str("}}");
    out
}

pub fn program_json(p: &Program) -> String {
    let mut out = String::from("{\"ok\":true,\"instrs\":[");
    for (i, ins) in disassemble(p).iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        let _ = write!(out, "{{\"ip\":{},\"bytes\":{:?},\"text\":", ins.ip, &p.code[ins.ip..ins.ip + ins.size]);
        string(&mut out, &ins.text);
        out.push_str(",\"span\":");
        span(&mut out, p.spans[ins.ip]);
        let _ = write!(out, ",\"line\":{}}}", p.line_at(ins.ip));
    }
    out.push_str("],\"functions\":[");
    for (i, f) in p.functions.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str("{\"name\":");
        string(&mut out, &f.name);
        let _ = write!(out, ",\"entry\":{},\"arity\":{}}}", f.entry, f.arity);
    }
    out.push_str("],\"constants\":[");
    for (i, k) in p.constants.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        match k {
            Constant::Num(n) => {
                out.push_str("{\"text\":");
                string(&mut out, &format_num(*n));
                let _ = write!(out, ",\"bits\":\"{:016x}\"}}", n.to_bits());
            }
            Constant::Str(s) => {
                out.push_str("{\"text\":");
                string(&mut out, &format!("{s:?}"));
                out.push_str(",\"bits\":null}");
            }
        }
    }
    let _ = write!(out, "],\"codeSize\":{}}}", p.code.len());
    out
}

fn kind_name(vm: &Vm, v: Value) -> &'static str {
    match v.kind() {
        Kind::Num => "num",
        Kind::Nil => "nil",
        Kind::Bool => "bool",
        Kind::Ref => match vm.obj(v) {
            Some(Obj::Str(_)) => "str",
            Some(Obj::Array(_)) => "array",
            None => "ref",
        },
    }
}

/// One 64-bit value: its raw bits (hex, since JSON numbers can't hold all 64
/// bits exactly), what kind it is, how it prints, and its real address in
/// memory, so the web page can read the actual bytes back out.
fn value(out: &mut String, vm: &Vm, v: Value, addr: usize) {
    let _ = write!(out, "\"bits\":\"{:016x}\",\"kind\":\"{}\",\"addr\":{addr},\"text\":", v.0, kind_name(vm, v));
    string(out, &vm.repr(v, 1));
    if v.kind() == Kind::Ref {
        let _ = write!(out, ",\"ref\":{}", v.as_ref());
    }
}

fn status_name(s: Status) -> &'static str {
    match s {
        Status::Ready => "ready",
        Status::Paused => "paused",
        Status::Breakpoint => "breakpoint",
        Status::Halted => "halted",
        Status::Error => "error",
    }
}

pub fn state_json(vm: &Vm) -> String {
    let p = &vm.prog;
    let mut out = String::with_capacity(4096);
    let _ = write!(
        out,
        "{{\"status\":\"{}\",\"ip\":{},\"steps\":{},\"line\":{},\"span\":",
        status_name(vm.status),
        vm.ip,
        vm.steps,
        vm.line()
    );
    span(&mut out, p.spans.get(vm.ip).copied().unwrap_or_default());

    out.push_str(",\"error\":");
    match &vm.error {
        Some(e) => {
            out.push_str("{\"msg\":");
            string(&mut out, &e.msg);
            out.push_str(",\"span\":");
            span(&mut out, e.span);
            out.push('}');
        }
        None => out.push_str("null"),
    }

    out.push_str(",\"explain\":");
    string(&mut out, &explain(vm));

    // Each frame's "current" instruction: the top frame is at `ip`, every
    // other frame is waiting at the return address saved by its callee.
    let frame_ip = |i: usize| if i + 1 < vm.frames.len() { vm.frames[i + 1].ret_ip } else { vm.ip };
    out.push_str(",\"frames\":[");
    for (i, f) in vm.frames.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str("{\"name\":");
        string(&mut out, &p.functions[f.func as usize].name);
        let _ = write!(out, ",\"base\":{},\"ip\":{},\"ret\":{}}}", f.base, frame_ip(i), f.ret_ip);
    }

    let stack_addr = vm.stack.as_ptr() as usize;
    out.push_str("],\"stack\":[");
    for (i, &v) in vm.stack.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        let fi = vm.frames.iter().rposition(|f| f.base <= i).unwrap_or(0);
        let f = vm.frames[fi];
        out.push('{');
        value(&mut out, vm, v, stack_addr + i * 8);
        let _ = write!(out, ",\"frame\":{fi},\"name\":");
        match p.local_name(f.func, (i - f.base) as u16, frame_ip(fi)) {
            Some(name) => string(&mut out, name),
            None => out.push_str("null"),
        }
        out.push('}');
    }

    let globals_addr = vm.globals.as_ptr() as usize;
    out.push_str("],\"globals\":[");
    for (i, &v) in vm.globals.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str("{\"name\":");
        string(&mut out, &p.globals[i]);
        out.push(',');
        value(&mut out, vm, v, globals_addr + i * 8);
        out.push('}');
    }

    out.push_str("],\"heap\":[");
    for (addr, obj) in vm.heap.iter().enumerate().take(MAX_HEAP_OBJECTS) {
        if addr > 0 {
            out.push(',');
        }
        match obj {
            Obj::Str(s) => {
                let _ = write!(out, "{{\"addr\":{addr},\"type\":\"str\",\"len\":{},\"text\":", s.chars().count());
                string(&mut out, &format!("{s:?}"));
                let _ = write!(out, ",\"bytes\":{:?}}}", &s.as_bytes()[..s.len().min(MAX_ITEMS)]);
            }
            Obj::Array(items) => {
                let _ = write!(out, "{{\"addr\":{addr},\"type\":\"array\",\"len\":{},\"items\":[", items.len());
                let base = items.as_ptr() as usize;
                for (j, &v) in items.iter().enumerate().take(MAX_ITEMS) {
                    if j > 0 {
                        out.push(',');
                    }
                    out.push('{');
                    value(&mut out, vm, v, base + j * 8);
                    out.push('}');
                }
                out.push_str("]}");
            }
        }
    }
    let _ = write!(out, "],\"heapTotal\":{},\"chartsVersion\":{},\"output\":", vm.heap.len(), vm.charts_version);
    string(&mut out, &vm.output);
    out.push('}');
    out
}

/// Charts are sent separately: they can be large and change less often.
pub fn charts_json(vm: &Vm) -> String {
    let num = |out: &mut String, n: f64| {
        if n.is_finite() {
            let _ = write!(out, "{n}");
        } else {
            out.push_str("null");
        }
    };
    let mut out = String::from("[");
    for (i, c) in vm.charts.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        let kind = match c.kind {
            ChartKind::Line => "line",
            ChartKind::Scatter => "scatter",
            ChartKind::Heatmap => "heatmap",
        };
        out.push_str("{\"name\":");
        string(&mut out, &c.name);
        let _ = write!(out, ",\"kind\":\"{kind}\",\"points\":[");
        for (j, p) in c.points.iter().enumerate() {
            if j > 0 {
                out.push(',');
            }
            out.push('[');
            num(&mut out, p[0]);
            out.push(',');
            num(&mut out, p[1]);
            out.push(',');
            num(&mut out, p[2]);
            out.push(']');
        }
        out.push_str("],\"series\":[");
        for (j, name) in c.series.iter().enumerate() {
            if j > 0 {
                out.push(',');
            }
            string(&mut out, name);
        }
        out.push_str("],\"matrix\":[");
        for (j, row) in c.matrix.iter().enumerate() {
            if j > 0 {
                out.push(',');
            }
            out.push('[');
            for (k, &v) in row.iter().enumerate() {
                if k > 0 {
                    out.push(',');
                }
                num(&mut out, v);
            }
            out.push(']');
        }
        out.push_str("]}");
    }
    out.push(']');
    out
}
