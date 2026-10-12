# 9. Charts and machine learning

Machine learning is mostly arithmetic in loops, which our machine already runs. What it lacks is a way to *see* training happen. In this chapter programs learn to draw, and then we walk the ML levels to see how each formula from a paper becomes a few lines of Bitlens.

## Drawing from inside the VM

Four built-ins let a program draw:

| Built-in | Draws |
|---|---|
| `plot(chart, x, y)` / `plot(chart, x, y, series)` | a line chart; the optional `series` names one of several lines |
| `scatter(chart, x, y, group)` | a dot colored by group; group −1 is a centroid marker |
| `heatmap(chart, rows)` | a 2D array of numbers as colored cells |
| `clearplot(chart)` | erases a chart, so animations don't pile up |

The VM stores charts as plain data. It knows nothing about pixels:

```rust
pub struct Chart {
    pub name: String,
    pub kind: ChartKind,
    /// `[x, y, group]` for line and scatter charts.
    pub points: Vec<[f64; 3]>,
    /// Names of the lines in a line chart; a point's group indexes this.
    pub series: Vec<String>,
    pub matrix: Vec<Vec<f64>>,
}
```

Two small decisions keep this fast:

- **A version counter.** Every chart change bumps `charts_version`, which is included in each state snapshot. The page only fetches the (possibly large) chart data via the separate `charts()` export when the number changes.
- **Thinning instead of truncating.** A training loop may call `plot` a million times. When a line chart reaches 4,000 points, the VM drops every other point, so the whole history stays visible at lower resolution.

## Drawing on a canvas

`web/src/charts.ts` draws with the Canvas 2D API: no chart library. A few rules make the charts readable:

- **Colors come from CSS variables**, so light and dark themes each get their own tested shades. Lines use a fixed categorical order (blue, orange, aqua), chosen so neighbouring colors stay distinguishable for color-blind readers. Heatmaps use a single-hue ramp from light to dark, never a rainbow.
- **Recessive grid, readable ticks.** Hairline gridlines, and tick values rounded to 1, 2 or 5 times a power of ten:

  ```ts
  function ticks(lo: number, hi: number, count = 4): number[] {
    const raw = (hi - lo) / count;
    const pow = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
    // ... multiples of step between lo and hi
  }
  ```

- **Identity is never color alone.** Multi-line charts get a legend *and* labels at the line ends; centroids are an × shape, not just a color; every chart has a "Data table" below it.
- **Crisp on high-DPI screens.** The canvas's backing store is `devicePixelRatio` times its CSS size, then scaled back down.
- **Hover tooltips** show the values under the pointer for every chart type.

## The ML levels, formula by formula

Each level's lesson (in `web/src/levels.ts`) pairs the formula from the paper with the program you step through. Here are the key lines.

### Level 5 · Gradient descent

For a line `ŷ = w·x + b`, the mean-squared-error loss and its gradient are

$$\mathcal{L} = \frac{1}{n}\sum_i (w x_i + b - y_i)^2, \qquad \frac{\partial \mathcal L}{\partial w} = \frac{2}{n}\sum_i (w x_i + b - y_i)\,x_i$$

and in Bitlens:

```js
let err = (w * xs[i] + b) - ys[i];   // prediction minus truth
loss += err * err / n;               // mean squared error
dw += 2 * err * xs[i] / n;           // dLoss/dw
db += 2 * err / n;                   // dLoss/db
...
w -= lr * dw;
b -= lr * db;
```

The lesson goes one step further. The loss is a quadratic bowl whose curvature is the Hessian matrix; for this data its largest eigenvalue is `12 + √136 ≈ 23.66`. Gradient descent is stable only when `η < 2/λ_max ≈ 0.0845`. Try `lr = 0.084` and `lr = 0.085` in the IDE: the first converges, the second explodes toward Infinity. A result from optimization theory, confirmed in two runs.

### Level 8 · Backpropagation

The chain rule turns the output error into a "delta" and sends it back through each weight:

```js
let d_out = err * out * (1 - out);                 // δ_out = (ŷ − y) σ'(z)
for (let j = 0; j < H; j += 1) {
  let d_h = d_out * w2[j] * h[j] * (1 - h[j]);     // δ_h = δ_out · w2[j] · σ'(z_h)
  w2[j] -= lr * d_out * h[j];
  w1[j][0] -= lr * d_h * x[0];
  w1[j][1] -= lr * d_h * x[1];
  b1[j] -= lr * d_h;
}
```

Note the order: `d_h` uses `w2[j]` *before* it is updated. Swap those two lines and you've implemented a subtle bug that real frameworks avoid by computing all gradients first. Stepping through makes it visible.

### Level 9 · Softmax, the numerically stable way

```js
fn softmax(z) {
  // Subtract the max first. exp(1000) overflows to Infinity (level 2!), but
  // softmax(z) equals softmax(z - c) for any c, so this costs nothing.
  let m = z[0];
  for (let i = 1; i < len(z); i += 1) {
    m = max(m, z[i]);
  }
  ...
}
```

Level 2's floating-point lessons come back here: without the max-subtraction, `softmax([1000, 1001, 1002])` would compute `Infinity / Infinity = NaN`.

### Level 10 · Adam

```js
mx = beta1 * mx + (1 - beta1) * gx;        // 1st moment: running mean of gradients
vx = beta2 * vx + (1 - beta2) * gx * gx;   // 2nd moment: running mean of squares
let mhx = mx / (1 - pow(beta1, t));        // bias correction (both start at 0)
let vhx = vx / (1 - pow(beta2, t));
ax -= alpha * mhx / (sqrt(vhx) + eps);
```

Both optimizers race down the Rosenbrock valley on one chart (`plot("log loss", t, log(f), "Adam")`), and the gap is obvious.

### Level 12 · Attention

`softmax(QKᵀ/√d)V` written with loops: a dot product per query-key pair, a softmax per row, then a weighted sum of the values. The weights go to a heatmap:

```js
scores[j] = dot / sqrt(d);   // scale so big d doesn't saturate softmax
...
heatmap("attention weights (row = token, column = attends to)", weights);
```

### Level 13 · A transformer block

Positional encodings, Q/K/V projections, attention, a residual connection and LayerNorm, a ReLU feed-forward network, another residual and LayerNorm: the full post-norm block from *Attention Is All You Need*, in about 150 lines of Bitlens, using a small matrix toolkit (`matmul`, `transpose`, `add`) written in the language itself. The challenge is to add the **causal mask** that turns it into a GPT-style decoder.

## Checkpoint

`core/tests/examples.rs` asserts that the ML actually works, not just that it runs:

```rust
#[test]
fn backprop_learns_xor() {
    let vm = run(include_str!("../../examples/08_backprop_xor.bl"));
    assert!(global(&vm, "loss") < 0.01);
}

#[test]
fn attention_rows_sum_to_one() {
    let vm = run(include_str!("../../examples/12_attention.bl"));
    let chart = vm.charts.iter().find(|c| c.name.starts_with("attention")).unwrap();
    for row in &chart.matrix {
        assert!((row.iter().sum::<f64>() - 1.0).abs() < 1e-12);
    }
}
```

## Exercises

1. Add momentum (without Adam's second moment) as a third line on the level 10 chart.
2. Plot the decision boundary of the XOR network as a heatmap over a 20×20 grid of inputs.
3. Give level 13 two attention heads and concatenate them.

Next: [The game layer →](10-the-game-layer.md)
