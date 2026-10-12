// The journey: 13 levels from raw bits up to a transformer block.
// Each level is a program in ../examples, a short lesson, the key formulas
// (with the papers they come from), and a challenge that the IDE checks by
// running your code.

const tex = String.raw;

export interface Paper {
  cite: string;
  url?: string;
}

export interface Challenge {
  goal: string;
  /** Bitlens code appended after the program; it must set the global `__check`. */
  check: string;
  hint: string;
  /** Text replacements that turn the starting program into a passing one. */
  solution: [string, string][];
}

export interface Level {
  id: number;
  file: string;
  region: string;
  title: string;
  tagline: string;
  story: string[];
  hood: string[];
  formulas: { tex: string; caption: string }[];
  papers: Paper[];
  tryThis: string[];
  challenge: Challenge;
}

export interface Region {
  id: string;
  name: string;
  blurb: string;
}

export const REGIONS: Region[] = [
  { id: "bits", name: "Floor 0 · Bits", blurb: "Everything a computer knows is a pattern of 1s and 0s. Start here." },
  { id: "machine", name: "Floor 1 · The machine", blurb: "Instructions, the stack, the heap: how code actually runs." },
  { id: "learning", name: "Floor 2 · Learning from data", blurb: "Programs that improve themselves by measuring their mistakes." },
  { id: "neural", name: "Floor 3 · Neural networks", blurb: "Stack neurons in layers and teach them with calculus." },
  { id: "language", name: "Floor 4 · Language and transformers", blurb: "Predict the next word. Then do it with attention." },
];

export const LEVELS: Level[] = [
  {
    id: 1,
    file: "01_hello.bl",
    region: "bits",
    title: "Hello, machine",
    tagline: "Watch a CPU-style machine run your code one instruction at a time.",
    story: [
      "Your code never runs as written. A compiler first turns it into <b>bytecode</b>: a list of tiny instructions like <code>CONST</code>, <code>MUL</code> and <code>JUMP</code>, each just a few bytes long.",
      "A <b>virtual machine</b> then repeats one loop forever: fetch the instruction at the instruction pointer, move the pointer forward, do what the instruction says. Real CPUs run the very same loop in silicon, billions of times per second.",
      "Press <b>Step</b> and you become the clock. Every press runs exactly one instruction.",
    ],
    hood: [
      "<code>x * y</code> becomes three instructions: push x, push y, multiply. The machine has no registers, only a <b>stack</b> of values.",
      "<code>while</code> and <code>if</code> don't exist down here. They compile to conditional and unconditional <code>JUMP</code>s.",
      "Each instruction is one opcode byte plus operands. Hover a bytecode row to see which source code produced it.",
    ],
    formulas: [
      {
        tex: tex`\textbf{loop: }\; op \leftarrow \mathrm{code}[ip],\quad ip \leftarrow ip + \mathrm{size}(op),\quad \mathrm{execute}(op)`,
        caption: "The fetch-decode-execute cycle, the heartbeat of every stored-program computer.",
      },
    ],
    papers: [{ cite: "J. von Neumann (1945). First Draft of a Report on the EDVAC.", url: "https://doi.org/10.1109/85.238389" }],
    tryThis: ["Turn on Predict mode and guess each value before it lands on the stack.", "Click a line number to set a breakpoint, then press Run."],
    challenge: {
      goal: "Make the loop run 5 times instead of 3.",
      check: "let __check = i == 5;",
      hint: "The loop keeps going while its condition is true. Which number decides when it stops?",
      solution: [["while (i < 3)", "while (i < 5)"]],
    },
  },
  {
    id: 2,
    file: "02_floats.bl",
    region: "bits",
    title: "Numbers are bits",
    tagline: "Why 0.1 + 0.2 ≠ 0.3, told by the 64 bits themselves.",
    story: [
      "Every number in Bitlens (and in JavaScript, and in most ML code) is a <b>64-bit IEEE-754 double</b>: 1 sign bit, 11 exponent bits and 52 mantissa bits. That's scientific notation in base 2.",
      "0.1 has no finite binary expansion, just like 1/3 has none in decimal. So the machine stores the closest double it can, and every operation rounds its answer to the nearest representable double.",
      "Click any number on the stack. The Bits panel decodes it field by field, shows the exact decimal value hiding inside, and lets you flip individual bits.",
    ],
    hood: [
      "Bitlens uses <b>NaN-boxing</b>: non-numbers (nil, booleans, pointers) are hidden inside the bit patterns of “not a number”, so every value is exactly 64 bits.",
      "The gap between neighbouring doubles (one <i>ulp</i>) grows with the number. Past 2<sup>53</sup> the gap is 2, so <code>2^53 + 1</code> rounds back down.",
      "Infinity, −0 and NaN are ordinary bit patterns with special meanings.",
    ],
    formulas: [
      {
        tex: tex`x = (-1)^{s} \times \Big(1 + \sum_{i=1}^{52} m_i\,2^{-i}\Big) \times 2^{\,e-1023}`,
        caption: "How sign s, exponent e and mantissa bits m turn into a value (normal numbers).",
      },
      {
        tex: tex`\mathrm{fl}(a \oplus b) = (a \oplus b)(1+\delta), \qquad |\delta| \le u = 2^{-53} \approx 1.1 \times 10^{-16}`,
        caption: "Every operation is exact, then rounded: the relative error is at most the unit roundoff u.",
      },
    ],
    papers: [
      { cite: "D. Goldberg (1991). What Every Computer Scientist Should Know About Floating-Point Arithmetic. ACM Computing Surveys 23(1).", url: "https://doi.org/10.1145/103162.103163" },
      { cite: "IEEE 754-2019. Standard for Floating-Point Arithmetic.", url: "https://doi.org/10.1109/IEEESTD.2019.8766229" },
    ],
    tryThis: ["Click the result of 0.1 + 0.2 and press “next double down”: one step below sits the double closest to 0.3.", "Flip the sign bit of a number, then the top exponent bit."],
    challenge: {
      goal: "Make `sum == 0.3` come out true by changing a and b, without setting either to 0.",
      check: "let __check = sum == 0.3 && a != 0 && b != 0;",
      hint: "Rounding errors can cancel out. Try two equal numbers, or look at the bits of 0.3 and find a pair that adds up to exactly that pattern.",
      solution: [
        ["let a = 0.1;", "let a = 0.15;"],
        ["let b = 0.2;", "let b = 0.15;"],
      ],
    },
  },
  {
    id: 3,
    file: "03_call_stack.bl",
    region: "machine",
    title: "The call stack",
    tagline: "Recursion, frames and return addresses, live.",
    story: [
      "When a function is called, the machine opens a <b>frame</b>: a window onto the stack whose first slots are the arguments the caller already pushed. Locals simply pile on top.",
      "The frame also remembers the <b>return address</b>, the instruction to resume after <code>RETURN</code>. That's the whole trick behind functions, and behind “stack overflow” errors.",
      "Recursive <code>fib</code> calls itself twice per call, so the number of frames explodes. The <code>steps()</code> built-in counts every instruction executed, the honest cost of your algorithm.",
    ],
    hood: [
      "<code>CALL fib/1</code> carries a 2-byte function index and a 1-byte argument count.",
      "On <code>RETURN</code> the machine throws away the whole frame in one go: it just moves the stack top back down.",
      "The Stack panel groups slots by frame and puts variable names next to raw values, using debug info the compiler recorded.",
    ],
    formulas: [
      { tex: tex`\mathrm{fib}(n) = \mathrm{fib}(n-1) + \mathrm{fib}(n-2), \qquad \mathrm{fib}(0)=0,\ \mathrm{fib}(1)=1`, caption: "The definition, written straight into the code." },
      {
        tex: tex`C(n) = C(n-1) + C(n-2) + 1 = 2F_{n+1} - 1 = \Theta(\varphi^{n}), \qquad \varphi = \tfrac{1+\sqrt5}{2}`,
        caption: "Calls made by the naive version: exponential, because it recomputes the same values again and again.",
      },
    ],
    papers: [{ cite: "E. W. Dijkstra (1960). Recursive Programming. Numerische Mathematik 2.", url: "https://doi.org/10.1007/BF01386232" }],
    tryThis: ["Use Step line to dive into fib, and watch new frames appear on the Stack panel.", "Change fib(6) to fib(20) and press Run at full speed. How many instructions does it take?"],
    challenge: {
      goal: "Compute fib(25) = 75025 into `result` using fewer than 3,000 instructions in total.",
      check: "let __check = result == 75025 && steps() < 3000;",
      hint: "Recursion recomputes everything. A loop that keeps only the last two numbers needs about 25 iterations.",
      solution: [
        [
          "let result = fib(6);",
          "let a = 0;\nlet b = 1;\nfor (let i = 0; i < 25; i += 1) {\n  let next = a + b;\n  a = b;\n  b = next;\n}\nlet result = a;",
        ],
      ],
    },
  },
  {
    id: 4,
    file: "04_heap.bl",
    region: "machine",
    title: "Pointers and the heap",
    tagline: "Why changing one array changes “another”.",
    story: [
      "A 64-bit slot can't hold five numbers. So arrays live on the <b>heap</b>, a separate region of memory, and variables hold only their <b>address</b>.",
      "Copying a variable copies the address, not the array. <code>alias</code> and <code>data</code> point at the same heap object, so sorting one “sorts” both.",
      "Every element of a heap array is itself a 64-bit value with a real address in WebAssembly memory. Click one to see its bytes.",
    ],
    hood: [
      "A reference is a NaN-boxed value: the sign bit plus the quiet-NaN pattern, with the heap address in the low 32 bits.",
      "<code>GET_INDEX</code> pops an index and a reference, follows the reference to the heap, and pushes the element.",
      "Bitlens has no garbage collector: objects are never freed. Real runtimes trace which objects are still reachable and reclaim the rest.",
    ],
    formulas: [
      { tex: tex`\mathrm{addr}(a[i]) = \mathrm{base}(a) + 8\,i`, caption: "Arrays are contiguous: element i sits 8·i bytes past the start." },
      { tex: tex`\sum_{i=0}^{n-2} (n-1-i) = \frac{n(n-1)}{2} = \Theta(n^2)`, caption: "Comparisons made by bubble sort on n elements." },
    ],
    papers: [{ cite: "J. McCarthy (1960). Recursive Functions of Symbolic Expressions and Their Computation by Machine, Part I. CACM 3(4). (Heap cells and the first garbage collector.)", url: "https://doi.org/10.1145/367177.367199" }],
    tryThis: ["Click data in Globals, then follow its pointer to the Heap panel.", "Watch the heap during the sort: the array changes in place, the references never do."],
    challenge: {
      goal: "Sort `data` from largest to smallest.",
      check: "let __check = data[0] == 8 && data[4] == 1 && alias[0] == 8;",
      hint: "Bubble sort swaps neighbours that are in the wrong order. Flip what “wrong order” means.",
      solution: [["if (a[j] > a[j + 1])", "if (a[j] < a[j + 1])"]],
    },
  },
  {
    id: 5,
    file: "05_gradient_descent.bl",
    region: "learning",
    title: "Gradient descent",
    tagline: "Roll downhill on a loss surface until the line fits.",
    story: [
      "Machine learning starts with a <b>loss</b>: one number that says how wrong the model is. Here it's the mean squared distance between the line's predictions and the real points.",
      "The <b>gradient</b> points uphill on that loss. Take a small step the other way and the loss shrinks. Repeat a few hundred times and the line fits.",
      "The step size η (the learning rate) is everything. Too small and you crawl; too big and every step overshoots further than the last, and the numbers explode toward Infinity.",
    ],
    hood: [
      "Each <code>plot(...)</code> call adds a point to the live chart. Run at full speed and watch the loss curve fall.",
      "Every update is ordinary float arithmetic: <code>MUL</code>, <code>SUB</code>, <code>SET_GLOBAL</code>.",
      "For this data the loss is a quadratic bowl, so we can compute exactly how big η may get before training blows up.",
    ],
    formulas: [
      { tex: tex`\mathcal{L}(w,b) = \frac{1}{n}\sum_{i=1}^{n} \big(w x_i + b - y_i\big)^2`, caption: "Mean squared error." },
      {
        tex: tex`\frac{\partial \mathcal L}{\partial w} = \frac{2}{n}\sum_i (w x_i + b - y_i)\,x_i, \qquad \frac{\partial \mathcal L}{\partial b} = \frac{2}{n}\sum_i (w x_i + b - y_i)`,
        caption: "The gradient: how the loss changes when w or b moves a little.",
      },
      { tex: tex`\theta \leftarrow \theta - \eta\, \nabla_{\theta}\mathcal{L}`, caption: "The update rule (Cauchy, 1847)." },
      {
        tex: tex`\nabla^2 \mathcal L = \frac{2}{n}\begin{pmatrix}\sum x_i^2 & \sum x_i \\ \sum x_i & n\end{pmatrix} = \begin{pmatrix}22 & 6\\ 6 & 2\end{pmatrix}, \qquad \eta < \frac{2}{\lambda_{\max}} = \frac{2}{12+\sqrt{136}} \approx 0.0845`,
        caption: "Stability limit: the step size must stay below 2 divided by the largest curvature (eigenvalue of the Hessian).",
      },
    ],
    papers: [
      { cite: "A.-L. Cauchy (1847). Méthode générale pour la résolution des systèmes d'équations simultanées. Comptes Rendus 25." },
      { cite: "H. Robbins, S. Monro (1951). A Stochastic Approximation Method. Annals of Mathematical Statistics 22(3).", url: "https://doi.org/10.1214/aoms/1177729586" },
    ],
    tryThis: ["Set lr to 0.084 and then 0.085. The formula above predicts which one explodes.", "Plot w instead of loss to watch the weight converge."],
    challenge: {
      goal: "Get the loss below 0.00001 in the same 300 epochs, by changing only lr.",
      check: "let __check = loss < 0.00001;",
      hint: "Bigger steps converge faster, up to the stability limit η < 0.0845 derived above.",
      solution: [["let lr = 0.02;", "let lr = 0.08;"]],
    },
  },
  {
    id: 6,
    file: "06_perceptron.bl",
    region: "learning",
    title: "The perceptron",
    tagline: "The 1958 neuron that started it all.",
    story: [
      "A perceptron takes a weighted sum of its inputs and fires (outputs 1) if that sum is positive. Learning means nudging the weights every time it gets an example wrong.",
      "Rosenblatt proved it always finds a perfect answer, <i>if one exists</i>: if a straight line can separate the two classes.",
      "AND and OR are separable. XOR is not, and Minsky and Papert's 1969 book pointing this out helped freeze neural network research for over a decade. Level 8 shows the fix.",
    ],
    hood: [
      "<code>if (sum > 0)</code> compiles to <code>GT</code> then <code>JUMP_IF_FALSE</code>: the neuron's threshold is a conditional jump.",
      "With lr = 0.1, the weights become values like 0.30000000000000004. Floating point (level 2) is everywhere.",
    ],
    formulas: [
      { tex: tex`\hat y = \mathbb{1}\left[\mathbf{w}\cdot\mathbf{x} + b > 0\right]`, caption: "The neuron: weighted sum, then a hard threshold." },
      { tex: tex`\mathbf{w} \leftarrow \mathbf{w} + \eta\,(y - \hat y)\,\mathbf{x}, \qquad b \leftarrow b + \eta\,(y - \hat y)`, caption: "The perceptron learning rule: change nothing when right, move toward the example when wrong." },
      { tex: tex`\text{mistakes} \le \left(\frac{R}{\gamma}\right)^{2}`, caption: "Novikoff's bound: data within radius R, separable with margin γ, means a finite number of mistakes." },
    ],
    papers: [
      { cite: "F. Rosenblatt (1958). The Perceptron: A Probabilistic Model for Information Storage and Organization in the Brain. Psychological Review 65(6).", url: "https://doi.org/10.1037/h0042519" },
      { cite: "A. B. J. Novikoff (1962). On Convergence Proofs on Perceptrons. Symposium on the Mathematical Theory of Automata." },
      { cite: "M. Minsky, S. Papert (1969). Perceptrons. MIT Press." },
    ],
    tryThis: ["Set the targets to XOR, [0, 1, 1, 0], and watch the mistakes chart never reach zero."],
    challenge: {
      goal: "Teach the perceptron OR instead of AND.",
      check: "let __check = targets[0] == 0 && targets[1] == 1 && targets[2] == 1 && targets[3] == 1 && mistakes == 0;",
      hint: "OR is 1 whenever at least one input is 1. Only the training data needs to change.",
      solution: [["let targets = [0, 0, 0, 1];   // AND", "let targets = [0, 1, 1, 1];   // OR"]],
    },
  },
  {
    id: 7,
    file: "07_kmeans.bl",
    region: "learning",
    title: "k-means clustering",
    tagline: "Finding groups nobody labelled.",
    story: [
      "No right answers this time, just points. k-means guesses k centres, then alternates two steps: give every point to its nearest centre, then move each centre to the average of its points.",
      "Each round can only lower the total squared distance, so the algorithm always settles. It may settle somewhere silly, though: the result depends on where the centres start.",
    ],
    hood: [
      "<code>scatter(name, x, y, group)</code> draws a dot. Group −1 draws a centroid.",
      "<code>clearplot</code> wipes the chart each round, so you see the clusters move instead of piling up.",
    ],
    formulas: [
      { tex: tex`c_i = \arg\min_{j}\ \lVert \mathbf{x}_i - \boldsymbol{\mu}_j \rVert^2`, caption: "Assignment step." },
      { tex: tex`\boldsymbol{\mu}_j = \frac{1}{|S_j|} \sum_{i \in S_j} \mathbf{x}_i`, caption: "Update step: each centroid moves to the mean of its cluster S_j." },
      { tex: tex`J = \sum_{i} \lVert \mathbf{x}_i - \boldsymbol{\mu}_{c_i} \rVert^2`, caption: "The objective. Neither step can increase it, so J only ever goes down." },
    ],
    papers: [
      { cite: "S. P. Lloyd (1982, written 1957). Least Squares Quantization in PCM. IEEE Transactions on Information Theory 28(2).", url: "https://doi.org/10.1109/TIT.1982.1056489" },
      { cite: "J. MacQueen (1967). Some Methods for Classification and Analysis of Multivariate Observations. (Coined “k-means”.)" },
    ],
    tryThis: ["Start both centroids on the same far-away point. What happens to the empty cluster?"],
    challenge: {
      goal: "Find three clusters: set k = 3 and give the algorithm a third starting centroid.",
      check:
        "let __n2 = 0;\nfor (let i = 0; i < len(group); i += 1) {\n  if (group[i] == 2) {\n    __n2 += 1;\n  }\n}\nlet __check = k == 3 && len(cx) == 3 && __n2 > 0;",
      hint: "cx and cy need a third entry. Start it on a point far from the other two, like point 3.",
      solution: [
        ["let k = 2;", "let k = 3;"],
        ["let cx = [px[0], px[1]];", "let cx = [px[0], px[1], px[3]];"],
        ["let cy = [py[0], py[1]];", "let cy = [py[0], py[1], py[3]];"],
      ],
    },
  },
  {
    id: 8,
    file: "08_backprop_xor.bl",
    region: "neural",
    title: "Backpropagation",
    tagline: "The chain rule that taught networks to learn.",
    story: [
      "A hidden layer lets a network bend its decision boundary, so XOR becomes learnable. But how do you know which hidden weight to blame for a wrong answer?",
      "<b>Backpropagation</b> applies the chain rule backwards. The output's error is turned into a “delta”, and each hidden neuron receives a share of it in proportion to the weight connecting them.",
      "It's the same algorithm that trains today's largest models: forward pass, loss, backward pass, update.",
    ],
    hood: [
      "Weights start random, using the deterministic <code>random()</code>, so every run is identical and steppable.",
      "Each training step is about a thousand instructions. Run at full speed and watch the loss chart.",
      "Constant factors from the loss (like the 2 in a squared error) are folded into the learning rate.",
    ],
    formulas: [
      { tex: tex`\sigma(z) = \frac{1}{1+e^{-z}}, \qquad \sigma'(z) = \sigma(z)\,\big(1-\sigma(z)\big)`, caption: "The sigmoid, and its convenient derivative." },
      { tex: tex`\delta^{\text{out}} = (\hat y - y)\,\sigma'(z^{\text{out}}), \qquad \delta^{h}_j = \delta^{\text{out}}\; w^{(2)}_j\; \sigma'(z^{h}_j)`, caption: "Deltas flow backwards: the output's error, scaled by each connecting weight." },
      { tex: tex`\frac{\partial \mathcal L}{\partial w^{(2)}_j} = \delta^{\text{out}}\, h_j, \qquad \frac{\partial \mathcal L}{\partial w^{(1)}_{jk}} = \delta^{h}_j\, x_k`, caption: "Every weight's gradient is (delta of the neuron it feeds) × (input it carries)." },
    ],
    papers: [
      { cite: "D. E. Rumelhart, G. E. Hinton, R. J. Williams (1986). Learning Representations by Back-propagating Errors. Nature 323.", url: "https://doi.org/10.1038/323533a0" },
      { cite: "P. Werbos (1974). Beyond Regression. PhD thesis, Harvard. (An earlier derivation.)" },
    ],
    tryThis: ["Set H = 1. Can a single hidden neuron learn XOR?", "Try lr = 5: what happens to the loss curve?"],
    challenge: {
      goal: "Get the final loss below 0.001.",
      check: "let __check = loss < 0.001;",
      hint: "More epochs, a larger learning rate, or more hidden neurons all help.",
      solution: [["epoch < 3000", "epoch < 6000"]],
    },
  },
  {
    id: 9,
    file: "09_softmax.bl",
    region: "neural",
    title: "Softmax and cross-entropy",
    tagline: "From raw scores to probabilities, and from surprise to gradients.",
    story: [
      "Classifiers output one score per class. <b>Softmax</b> turns any scores into probabilities: exponentiate, then divide by the total.",
      "<b>Cross-entropy</b> is the loss: −log of the probability given to the right class. It's large when the model is confidently wrong, and it's Shannon's measure of surprise.",
      "Their combination has a famously clean gradient: just p − y. That one fact is used in nearly every classifier and language model.",
    ],
    hood: [
      "exp(1000) overflows to Infinity (level 2!). Subtracting the largest score first changes nothing mathematically and keeps every exponent ≤ 0.",
      "Each call to <code>softmax</code> allocates a new array on the heap. Peek at the Heap panel: nothing is ever freed.",
    ],
    formulas: [
      { tex: tex`\mathrm{softmax}(\mathbf z)_i = \frac{e^{z_i}}{\sum_j e^{z_j}} = \frac{e^{z_i - m}}{\sum_j e^{z_j - m}}, \quad m = \max_j z_j`, caption: "Shift invariance: the stable way to compute softmax." },
      { tex: tex`\mathcal L = -\log p_{y}, \qquad \frac{\partial \mathcal L}{\partial z_i} = p_i - \mathbb{1}[i = y]`, caption: "Cross-entropy loss and its gradient with respect to the scores." },
      { tex: tex`H(p) = -\sum_i p_i \log p_i`, caption: "Shannon entropy: the average surprise of a distribution." },
    ],
    papers: [
      { cite: "J. S. Bridle (1990). Probabilistic Interpretation of Feedforward Classification Network Outputs. Neurocomputing, NATO ASI Series.", url: "https://doi.org/10.1007/978-3-642-76153-9_28" },
      { cite: "C. E. Shannon (1948). A Mathematical Theory of Communication. Bell System Technical Journal 27.", url: "https://doi.org/10.1002/j.1538-7305.1948.tb01338.x" },
    ],
    tryThis: ["Remove the max-subtraction from softmax and run it on [1000, 1001, 1002]."],
    challenge: {
      goal: "Push the final cross-entropy below 0.005.",
      check: "let __check = loss < 0.005;",
      hint: "This data is separable, so the loss can keep shrinking. Take bigger or more steps.",
      solution: [["let lr = 0.1;", "let lr = 0.5;"]],
    },
  },
  {
    id: 10,
    file: "10_adam.bl",
    region: "neural",
    title: "Adam",
    tagline: "The optimizer behind most modern deep learning.",
    story: [
      "Plain gradient descent struggles in long, narrow valleys: the gradient points mostly across the valley, not along it. The Rosenbrock “banana” function is the classic torture test.",
      "<b>Adam</b> keeps two running averages per parameter: the mean gradient (momentum, to roll through noise) and the mean squared gradient (to scale each step to the terrain).",
      "Both averages start at zero, which would bias early steps toward zero. Adam divides that bias back out.",
    ],
    hood: [
      "The two optimizers are drawn as two named lines on one chart: <code>plot(chart, x, y, series)</code>.",
      "The chart plots the natural log of the loss: every 1 the curve drops means the loss got e ≈ 2.7 times smaller.",
    ],
    formulas: [
      { tex: tex`m_t = \beta_1 m_{t-1} + (1-\beta_1)\, g_t, \qquad v_t = \beta_2 v_{t-1} + (1-\beta_2)\, g_t^{2}`, caption: "First and second moment estimates." },
      { tex: tex`\hat m_t = \frac{m_t}{1-\beta_1^{t}}, \qquad \hat v_t = \frac{v_t}{1-\beta_2^{t}}, \qquad \theta_t = \theta_{t-1} - \alpha\, \frac{\hat m_t}{\sqrt{\hat v_t} + \epsilon}`, caption: "Bias correction and the update (defaults β₁ = 0.9, β₂ = 0.999, ε = 10⁻⁸)." },
      { tex: tex`f(x,y) = (1-x)^2 + 100\,(y-x^2)^2`, caption: "The Rosenbrock function. Its minimum is f(1, 1) = 0." },
    ],
    papers: [
      { cite: "D. P. Kingma, J. Ba (2014). Adam: A Method for Stochastic Optimization. arXiv:1412.6980.", url: "https://arxiv.org/abs/1412.6980" },
      { cite: "H. H. Rosenbrock (1960). An Automatic Method for Finding the Greatest or Least Value of a Function. The Computer Journal 3(3).", url: "https://doi.org/10.1093/comjnl/3.3.175" },
    ],
    tryThis: ["Set beta1 = 0 (no momentum). How does Adam's curve change?", "Raise gradient descent's lr until it diverges."],
    challenge: {
      goal: "Get Adam within 0.001 of the minimum (1, 1).",
      check: "let __check = abs(ax - 1) < 0.001 && abs(ay - 1) < 0.001;",
      hint: "Adam's step size is roughly alpha in every direction. Larger alpha means faster travel down the valley.",
      solution: [["let alpha = 0.02;", "let alpha = 0.05;"]],
    },
  },
  {
    id: 11,
    file: "11_bigram.bl",
    region: "language",
    title: "A tiny language model",
    tagline: "Predict the next word. That's the whole job of an LLM.",
    story: [
      "A language model gives a probability to every possible next word. The simplest one just counts: how often did each word follow the previous one in the training text?",
      "To write new text, <b>sample</b>: pick the next word at random, weighted by those probabilities, then repeat. Shannon generated English-like text this way in 1948, by hand.",
      "<b>Perplexity</b> measures how surprised the model is by real text. A perplexity of 1.5 means it's as unsure as choosing between 1.5 equally likely words.",
    ],
    hood: [
      "Words are just integers (token ids) that index the vocab array. LLMs work the same way, with vocabularies of around 100,000 tokens.",
      "The heatmap is the model itself: a table of counts. A neural language model replaces this table with a function that generalises.",
    ],
    formulas: [
      { tex: tex`P(w_t \mid w_{t-1}) = \frac{C(w_{t-1}, w_t)}{\sum_{w} C(w_{t-1}, w)}`, caption: "The bigram model: counts, normalised per previous word." },
      { tex: tex`\mathrm{PPL} = \exp\!\Big(-\frac{1}{N}\sum_{t=1}^{N} \log P(w_t \mid w_{t-1})\Big)`, caption: "Perplexity: exponentiated average cross-entropy (level 9)." },
    ],
    papers: [
      { cite: "C. E. Shannon (1948). A Mathematical Theory of Communication. (Section 3: n-gram approximations to English.)", url: "https://doi.org/10.1002/j.1538-7305.1948.tb01338.x" },
      { cite: "Y. Bengio, R. Ducharme, P. Vincent, C. Jauvin (2003). A Neural Probabilistic Language Model. JMLR 3.", url: "https://www.jmlr.org/papers/v3/bengio03a.html" },
    ],
    tryThis: ["Add more sentences to the corpus and watch the heatmap fill in.", "What happens to perplexity if a pair in the corpus never appeared in training? (Hint: log 0.)"],
    challenge: {
      goal: "Teach the model that a dog can run: P(ran | dog) must be above 0.",
      check: "let __check = counts[3][5] > 0;",
      hint: "The model only knows what's in the corpus. Add “the dog ran .” as word ids: 1, 3, 5, 9.",
      solution: [["9, 1, 2, 5, 9];", "9, 1, 2, 5, 9, 1, 3, 5, 9];"]],
    },
  },
  {
    id: 12,
    file: "12_attention.bl",
    region: "language",
    title: "Attention",
    tagline: "softmax(QKᵀ/√d)V, one multiply at a time.",
    story: [
      "Attention lets every token look at every other token and decide what's relevant. Each token emits a <b>query</b> (“what am I looking for?”), a <b>key</b> (“what do I contain?”) and a <b>value</b> (“what do I pass on?”).",
      "A query's dot product with each key gives a score; softmax turns the scores into weights; the output is the weighted blend of the values.",
      "The heatmap is the attention pattern: each row says where one token looked.",
    ],
    hood: [
      "Dividing by √d keeps the scores from growing with the dimension, so softmax doesn't saturate into a one-hot spike with vanishing gradients.",
      "In a real transformer, Q, K and V come from multiplying each token's embedding by learned matrices (level 13).",
    ],
    formulas: [
      { tex: tex`\mathrm{Attention}(Q, K, V) = \mathrm{softmax}\!\left(\frac{QK^{\top}}{\sqrt{d_k}}\right) V`, caption: "Scaled dot-product attention." },
      { tex: tex`q_i, k_i \sim \text{i.i.d. } (0, 1) \ \Rightarrow\ \mathrm{Var}(\mathbf q \cdot \mathbf k) = d_k`, caption: "Why √d: it rescales the scores back to unit variance." },
    ],
    papers: [
      { cite: "A. Vaswani et al. (2017). Attention Is All You Need. arXiv:1706.03762.", url: "https://arxiv.org/abs/1706.03762" },
      { cite: "D. Bahdanau, K. Cho, Y. Bengio (2014). Neural Machine Translation by Jointly Learning to Align and Translate. arXiv:1409.0473.", url: "https://arxiv.org/abs/1409.0473" },
    ],
    tryThis: ["Remove the / sqrt(d) and scale every Q by 10. How peaky do the weights get?"],
    challenge: {
      goal: "Make “the” (token 0) put more than 80% of its attention on “sat” (token 2), changing only Q[0].",
      check:
        "let __check = weights[0][2] > 0.8 && K[0][0] == 1 && K[0][1] == 0 && K[1][0] == 0 && K[1][1] == 2 && K[2][0] == 1 && K[2][1] == 1;",
      hint: "Score j is Q[0]·K[j]. You need “sat”'s key [1, 1] to beat both [1, 0] and [0, 2] by a wide margin.",
      solution: [["let Q = [[1, 0], [0, 1], [1, 1]];", "let Q = [[10, 5], [0, 1], [1, 1]];"]],
    },
  },
  {
    id: 13,
    file: "13_transformer_block.bl",
    region: "language",
    title: "A transformer block",
    tagline: "Embeddings, positions, attention, residuals, LayerNorm and an MLP.",
    story: [
      "Stack this block a few dozen times, add an embedding table at the bottom and a softmax over the vocabulary at the top, and you have a GPT-style language model.",
      "Attention has no sense of order, so <b>positional encodings</b> (sines and cosines at different frequencies) are added to each token's embedding.",
      "<b>Residual connections</b> add each sub-layer's output to its input, so signals and gradients have a highway through deep stacks. <b>LayerNorm</b> keeps each token's vector at a stable scale.",
    ],
    hood: [
      "Everything here is the same few instructions you met on floor 1: loads, multiplies, adds and jumps, millions of them.",
      "This is the original post-norm layout. Most modern models normalise <i>before</i> each sub-layer (pre-norm), which trains more stably when the stack is deep.",
      "GPT models also add a <b>causal mask</b>, so a token can't attend to tokens after it. That's the challenge.",
    ],
    formulas: [
      { tex: tex`PE_{(pos,\,2i)} = \sin\!\big(pos / 10000^{2i/d}\big), \qquad PE_{(pos,\,2i+1)} = \cos\!\big(pos / 10000^{2i/d}\big)`, caption: "Sinusoidal positional encoding." },
      { tex: tex`\mathrm{LN}(\mathbf x) = \boldsymbol\gamma \odot \frac{\mathbf x - \mu}{\sqrt{\sigma^2 + \epsilon}} + \boldsymbol\beta`, caption: "Layer normalisation over a token's features (here γ = 1, β = 0)." },
      { tex: tex`\mathbf x_1 = \mathrm{LN}\big(\mathbf x + \mathrm{Attn}(\mathbf x)\big), \qquad \mathbf x_2 = \mathrm{LN}\big(\mathbf x_1 + \mathrm{FFN}(\mathbf x_1)\big)`, caption: "One post-norm transformer block." },
      { tex: tex`\mathrm{FFN}(\mathbf x) = \max(0,\ \mathbf x W_1 + b_1)\, W_2 + b_2, \qquad S_{ij} = -\infty \ \text{ for } j > i \ \text{(causal mask)}`, caption: "The feed-forward network, and the mask that makes a model autoregressive." },
    ],
    papers: [
      { cite: "A. Vaswani et al. (2017). Attention Is All You Need. arXiv:1706.03762.", url: "https://arxiv.org/abs/1706.03762" },
      { cite: "J. L. Ba, J. R. Kiros, G. E. Hinton (2016). Layer Normalization. arXiv:1607.06450.", url: "https://arxiv.org/abs/1607.06450" },
      { cite: "K. He, X. Zhang, S. Ren, J. Sun (2015). Deep Residual Learning for Image Recognition. arXiv:1512.03385.", url: "https://arxiv.org/abs/1512.03385" },
      { cite: "R. Xiong et al. (2020). On Layer Normalization in the Transformer Architecture. arXiv:2002.04745.", url: "https://arxiv.org/abs/2002.04745" },
    ],
    tryThis: ["Remove the positional encoding (use x = E). Does the attention pattern change?", "Switch to pre-norm: x1 = x + Attn(LN(x))."],
    challenge: {
      goal: "Add a causal mask: no token may attend to a later token (all weights above the diagonal ≈ 0).",
      check: "let __check = A[0][1] < 0.000001 && A[0][2] < 0.000001 && A[1][2] < 0.000001;",
      hint: "Before the softmax, set scores[i][j] to a huge negative number whenever j > i. exp of it is 0.",
      solution: [["    scores[i][j] /= sqrt(d);\n", "    scores[i][j] /= sqrt(d);\n    if (j > i) {\n      scores[i][j] = -1e9;\n    }\n"]],
    },
  },
];

export function applySolution(source: string, level: Level): string {
  return level.challenge.solution.reduce((src, [from, to]) => src.replace(from, to), source);
}
