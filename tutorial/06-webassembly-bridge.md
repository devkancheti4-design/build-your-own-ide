# 6. The WebAssembly bridge

The engine is done. Now we'll run it in a browser by compiling it to **WebAssembly** (wasm), a compact binary instruction format that browsers execute at close to native speed.

We'll do it by hand, without `wasm-bindgen`. The glue is short, and writing it yourself shows something worth knowing: JavaScript and wasm share a single flat block of memory, and that's what will let the IDE show the machine's real bytes.

## Build for wasm

```bash
rustup target add wasm32-unknown-unknown
cd core
cargo build --lib --release --target wasm32-unknown-unknown
ls -l target/wasm32-unknown-unknown/release/bitlens_core.wasm   # about 240 KB
```

`wasm32-unknown-unknown` means "no operating system". There are no files, no clock and no threads, which is fine, because our engine never needed them. The module has **zero imports**: it needs nothing from JavaScript at all.

## Only numbers cross the boundary

A wasm function can take and return integers and floats, nothing else. So how do we pass source code in and get JSON out?

Through **linear memory**: the module's whole memory is one `ArrayBuffer` that JavaScript can read and write directly. Rust's `Vec`s, our VM stack and every heap object live inside it. A pointer, on the Rust side, is just an offset into that buffer on the JavaScript side.

- **JS → Rust:** JavaScript asks Rust for a buffer (`alloc`), copies UTF-8 bytes into it, then passes `(pointer, length)`.
- **Rust → JS:** Rust leaves its answer (JSON) in a buffer and JavaScript asks where it is (`out_ptr`, `out_len`).

In `core/src/lib.rs`:

```rust
thread_local! {
    static VM: RefCell<Option<Vm>> = const { RefCell::new(None) };
    static OUT: RefCell<String> = const { RefCell::new(String::new()) };
}

/// Reserve `len` bytes for JavaScript to write into.
#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    Box::into_raw(vec![0u8; len].into_boxed_slice()) as *mut u8
}

/// Take back a buffer that JavaScript got from `alloc` and filled with UTF-8.
unsafe fn take_string(ptr: *mut u8, len: usize) -> String {
    let bytes = unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)) };
    String::from_utf8_lossy(&bytes).into_owned()
}

#[unsafe(no_mangle)]
pub extern "C" fn out_ptr() -> *const u8 {
    OUT.with(|o| o.borrow().as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn out_len() -> usize {
    OUT.with(|o| o.borrow().len())
}
```

A few details:

- `#[unsafe(no_mangle)] pub extern "C"` exports a function under its plain name with the C calling convention: that's what JavaScript sees as `instance.exports.alloc`. (Edition 2024 spells the attribute `unsafe(...)` because exporting symbols can clash with other code.)
- `alloc` hands out a boxed slice and forgets it, and `take_string` turns it back into a box so Rust frees it. Using `Box<[u8]>` on both sides guarantees the allocation's size and layout match exactly.
- The VM lives in a `thread_local!`. wasm has only one thread, but this avoids `static mut` and keeps the code safe.

The rest of the interface is thin wrappers:

```rust
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
pub extern "C" fn step() -> u32 {
    with_vm(|vm| vm.run(1, false) as u32).unwrap_or(5)
}

#[unsafe(no_mangle)]
pub extern "C" fn state() {
    set_out(with_vm(|vm| inspect::state_json(vm)).unwrap_or_else(|| "null".into()));
}
```

The full list of exports is `alloc`, `out_ptr`, `out_len`, `tokenize`, `compile`, `reset`, `run`, `step`, `step_line`, `set_breakpoints`, `state` and `charts`.

## Snapshots as JSON

`inspect.rs` serializes the machine by hand (about 300 lines, still zero dependencies). One detail matters: **64-bit values are sent as hex strings.** A JSON number is a double, so it can't hold all 64 bits of a NaN-boxed value exactly. Each value also carries its **real address** in wasm memory:

```rust
fn value(out: &mut String, vm: &Vm, v: Value, addr: usize) {
    let _ = write!(out, "\"bits\":\"{:016x}\",\"kind\":\"{}\",\"addr\":{addr},\"text\":", v.0, kind_name(vm, v));
    string(out, &vm.repr(v, 1));
    // ...
}

// For stack slot i:  addr = vm.stack.as_ptr() as usize + i * 8
```

## The JavaScript side

`web/src/engine.ts` loads the module and wraps each export in a friendly method:

```ts
export async function loadEngine(wasm: BufferSource | Response | Promise<Response>): Promise<Engine> {
  const { instance } =
    wasm instanceof Response || wasm instanceof Promise
      ? await WebAssembly.instantiateStreaming(wasm, {})
      : await WebAssembly.instantiate(wasm, {});
  const ex = instance.exports as unknown as Exports;

  // Always build a fresh view: when memory grows, old views are detached.
  const bytes = () => new Uint8Array(ex.memory.buffer);

  /** Copy a string into wasm memory; Rust takes ownership of the buffer. */
  function send(text: string, fn: (ptr: number, len: number) => number | void): number | void {
    const data = encoder.encode(text);
    const ptr = ex.alloc(data.length);
    bytes().set(data, ptr);
    return fn(ptr, data.length);
  }

  function receive<T>(): T {
    const ptr = ex.out_ptr();
    const len = ex.out_len();
    return JSON.parse(decoder.decode(bytes().subarray(ptr, ptr + len))) as T;
  }

  return {
    compile(src) {
      send(src, ex.compile);
      return receive<CompileResult>();
    },
    step: () => void ex.step(),
    state() {
      ex.state();
      return receive<State | null>();
    },
    readBytes(addr, count) {
      return bytes().slice(addr, addr + count);
    },
    // ... tokenize, reset, run, stepLine, setBreakpoints, charts, memorySize
  };
}
```

The comment on `bytes()` is a real trap. When Rust's allocator needs more memory, wasm memory **grows**, and every existing `Uint8Array` over the old buffer becomes detached (length 0). Creating a fresh view each time sidesteps it.

`readBytes` is the payoff. Given a stack slot's address from the JSON snapshot, it reads the 8 bytes straight out of the VM's memory. The Bits panel shows these with the lowest byte first, and you can see little-endian storage with your own eyes: `42` is `00 00 00 00 00 00 45 40`.

## Checkpoint: the engine runs outside the browser too

`WebAssembly` is a JavaScript standard, so Node can load the same module. `web/scripts/verify.ts` does exactly that, and checks every level (more on that in chapter 10):

```bash
cd web
npm install
npm run verify
```

```text
ok   level  1 Hello, machine             start: Not yet. ...  solution: Challenge complete in 96 instructions.
...
ok   level 13 A transformer block        start: Not yet. ...  solution: Challenge complete in 21,548 instructions.

all levels verified
```

How fast is it? In the browser, the backprop level (about 5.9 million instructions) runs in about 80 ms: roughly 70 million instructions per second, with every one of them still pausable.

## Exercises

1. Add an export that returns the size of the heap in bytes. How much memory does the transformer level allocate?
2. Pass breakpoints as a `Uint32Array` written into wasm memory instead of a comma-separated string.

Next: [The editor →](07-the-editor.md)
