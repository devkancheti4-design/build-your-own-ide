//! Functions that come with the language. The VM implements them in Rust
//! (see `Vm::builtin`); this table is what the compiler and explainer know.

pub struct Builtin {
    pub name: &'static str,
    /// Smallest and largest number of arguments allowed.
    pub arity: (u8, u8),
    /// Finishes the sentence "this built-in will ...".
    pub doc: &'static str,
}

pub const BUILTINS: &[Builtin] = &[
    Builtin { name: "print", arity: (0, 255), doc: "write its arguments to the output" },
    Builtin { name: "len", arity: (1, 1), doc: "count the elements of an array (or characters of a string)" },
    Builtin { name: "push", arity: (2, 2), doc: "append a value to the end of an array on the heap" },
    Builtin { name: "array", arity: (2, 2), doc: "allocate a new array holding n copies of a value" },
    Builtin { name: "exp", arity: (1, 1), doc: "compute e raised to the power x" },
    Builtin { name: "log", arity: (1, 1), doc: "compute the natural logarithm of x" },
    Builtin { name: "sqrt", arity: (1, 1), doc: "compute the square root of x" },
    Builtin { name: "abs", arity: (1, 1), doc: "drop the sign of x" },
    Builtin { name: "floor", arity: (1, 1), doc: "round x down to a whole number" },
    Builtin { name: "sin", arity: (1, 1), doc: "compute the sine of x (in radians)" },
    Builtin { name: "cos", arity: (1, 1), doc: "compute the cosine of x (in radians)" },
    Builtin { name: "tanh", arity: (1, 1), doc: "compute the hyperbolic tangent of x" },
    Builtin { name: "pow", arity: (2, 2), doc: "raise a to the power b" },
    Builtin { name: "min", arity: (2, 2), doc: "return the smaller of two numbers" },
    Builtin { name: "max", arity: (2, 2), doc: "return the larger of two numbers" },
    Builtin {
        name: "random",
        arity: (0, 0),
        doc: "return a pseudo-random number in [0, 1) (the same sequence on every run, so results are reproducible)",
    },
    Builtin {
        name: "steps",
        arity: (0, 0),
        doc: "return how many instructions the machine has executed so far (a direct measure of cost)",
    },
    Builtin {
        name: "plot",
        arity: (3, 4),
        doc: "add the point (x, y) to the line chart with this name (an optional 4th argument names the line)",
    },
    Builtin { name: "scatter", arity: (4, 4), doc: "add a dot at (x, y), colored by group g, to the scatter chart with this name" },
    Builtin { name: "heatmap", arity: (2, 2), doc: "draw a 2D array of numbers as a grid of colors" },
    Builtin { name: "clearplot", arity: (1, 1), doc: "erase the chart with this name" },
];

pub fn find(name: &str) -> Option<u8> {
    BUILTINS.iter().position(|b| b.name == name).map(|i| i as u8)
}
