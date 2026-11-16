// LaTeX math ($...$ and $$...$$) → plain text with style markers.
//
// The print engine has no TeX, so formulas are set as ordinary text: Greek letters and
// operators become Unicode, variables are italic, `^` and `_` become real superscripts and
// subscripts, fractions become `a/b`. Anything beyond that (matrices, cases) is kept as
// readable text and reported, never dropped silently.

export const MATH_SUP_OPEN = "";
export const MATH_SUP_CLOSE = "";
export const MATH_SUB_OPEN = "";
export const MATH_SUB_CLOSE = "";
export const MATH_IT_OPEN = "";
export const MATH_IT_CLOSE = "";
export const MATH_OPEN = "";
export const MATH_CLOSE = "";

const SP = "\u2005";
const SYMBOLS: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ",
  iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", varpi: "ϖ", rho: "ρ", varrho: "ϱ", sigma: "σ", varsigma: "ς",
  tau: "τ", upsilon: "υ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  times: "×", cdot: "·", div: "÷", pm: "±", mp: "∓", ast: "∗", star: "⋆", circ: "∘", bullet: "•", oplus: "⊕", otimes: "⊗",
  leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠", approx: "≈", equiv: "≡", sim: "∼", simeq: "≃", cong: "≅", propto: "∝",
  ll: "≪", gg: "≫", infty: "∞", partial: "∂", nabla: "∇", sum: "∑", prod: "∏", int: "∫", oint: "∮", iint: "∬",
  to: "→", rightarrow: "→", leftarrow: "←", leftrightarrow: "↔", Rightarrow: "⇒", Leftarrow: "⇐", Leftrightarrow: "⇔", iff: "⇔",
  implies: "⇒", mapsto: "↦", uparrow: "↑", downarrow: "↓",
  in: "∈", notin: "∉", ni: "∋", subset: "⊂", supset: "⊃", subseteq: "⊆", supseteq: "⊇", cup: "∪", cap: "∩", emptyset: "∅", varnothing: "∅",
  forall: "∀", exists: "∃", neg: "¬", lnot: "¬", land: "∧", lor: "∨", wedge: "∧", vee: "∨",
  ldots: "…", cdots: "⋯", dots: "…", vdots: "⋮", degree: "°", prime: "′", angle: "∠", perp: "⊥", parallel: "∥", hbar: "ħ", ell: "ℓ",
  Re: "ℜ", Im: "ℑ", aleph: "ℵ", sqcup: "⊔", langle: "⟨", rangle: "⟩", lbrace: "{", rbrace: "}", lvert: "|", rvert: "|", vert: "|", Vert: "‖",
  lfloor: "⌊", rfloor: "⌋", lceil: "⌈", rceil: "⌉", dagger: "†", S: "§", P: "¶", "%": "%", "&": "&", "#": "#", $: "$", _: "_", "{": "{", "}": "}",
};
const SPACES: Record<string, string> = { ",": " ", ";": "\u2005", ":": "\u2005", "!": "", " ": " ", quad: " ", qquad: "  " };
const FUNCS = new Set(["sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "log", "ln", "lg", "exp", "lim", "liminf", "limsup", "min", "max", "sup", "inf", "det", "dim", "ker", "gcd", "deg", "arg", "Pr", "mod", "bmod"]);
const TEXTLIKE = new Set(["text", "mathrm", "textrm", "operatorname", "mathbf", "boldsymbol", "bm", "textbf", "mathbb", "mathcal", "mathsf", "mathtt", "mathit", "textit", "rm"]);
const DROP = new Set(["left", "right", "big", "Big", "bigg", "Bigg", "bigl", "bigr", "displaystyle", "textstyle", "scriptstyle", "limits", "nolimits", "nonumber", "notag", "label"]);
const ENV_OK = new Set(["aligned", "align", "align*", "split", "gathered", "gather", "gather*", "equation", "equation*"]);

interface Ctx {
  src: string;
  i: number;
  unsupported: Set<string>;
}

/** Read one argument: a `{group}` or a single token. Returns its raw source. */
function readArg(c: Ctx): string {
  while (c.src[c.i] === " ") c.i++;
  if (c.i >= c.src.length) return "";
  if (c.src[c.i] === "{") {
    let depth = 0;
    const start = c.i + 1;
    for (; c.i < c.src.length; c.i++) {
      const ch = c.src[c.i];
      if (ch === "\\") c.i++;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        c.i++;
        return c.src.slice(start, c.i - 1);
      }
    }
    return c.src.slice(start);
  }
  if (c.src[c.i] === "\\") {
    const m = /^\\([A-Za-z]+|.)/.exec(c.src.slice(c.i));
    const t = m ? m[0] : "\\";
    c.i += t.length;
    return t;
  }
  return c.src[c.i++];
}

function readOptional(c: Ctx): string | null {
  while (c.src[c.i] === " ") c.i++;
  if (c.src[c.i] !== "[") return null;
  const end = c.src.indexOf("]", c.i);
  if (end < 0) return null;
  const v = c.src.slice(c.i + 1, end);
  c.i = end + 1;
  return v;
}

const isSimple = (s: string) => /^[^\s+\-−=<>/(),]+$/.test(s) && s.length <= 3;

function sub(src: string, unsupported: Set<string>): string {
  return convert({ src, i: 0, unsupported });
}

function convert(c: Ctx): string {
  let out = "";
  let ital = "";
  const flush = () => {
    if (ital) out += MATH_IT_OPEN + ital + MATH_IT_CLOSE;
    ital = "";
  };
  const push = (s: string) => {
    flush();
    out += s;
  };
  while (c.i < c.src.length) {
    const ch = c.src[c.i++];
    if (ch === "\\") {
      const m = /^([A-Za-z]+|.)/.exec(c.src.slice(c.i));
      const name = m ? m[1] : "";
      c.i += name.length;
      if (name in SPACES) push(SPACES[name]);
      else if (name === "\\") push(" ");
      else if (name === "frac" || name === "dfrac" || name === "tfrac") {
        const a = sub(readArg(c), c.unsupported);
        const b = sub(readArg(c), c.unsupported);
        const plain = (s: string) => s.replace(/[-]/g, "");
        push(`${isSimple(plain(a)) ? a : `(${a})`}/${isSimple(plain(b)) ? b : `(${b})`}`);
      } else if (name === "binom") {
        push(`(${sub(readArg(c), c.unsupported)} choose ${sub(readArg(c), c.unsupported)})`);
      } else if (name === "sqrt") {
        const n = readOptional(c);
        const a = sub(readArg(c), c.unsupported);
        const plain = a.replace(/[-]/g, "");
        push((n ? MATH_SUP_OPEN + n + MATH_SUP_CLOSE : "") + "√" + (isSimple(plain) ? a : `(${a})`));
      } else if (name === "overline" || name === "bar") push(sub(readArg(c), c.unsupported) + "̅");
      else if (name === "hat") push(sub(readArg(c), c.unsupported) + "̂");
      else if (name === "vec") push(sub(readArg(c), c.unsupported) + "⃗");
      else if (name === "dot") push(sub(readArg(c), c.unsupported) + "̇");
      else if (name === "tilde") push(sub(readArg(c), c.unsupported) + "̃");
      else if (TEXTLIKE.has(name)) push(readArg(c).replace(/\\([,;: ])/g, " ").replace(/\\(.)/g, "$1"));
      else if (FUNCS.has(name)) push(name === "mod" || name === "bmod" ? " mod " : name);
      else if (DROP.has(name)) {
        if (name === "label") readArg(c);
        else if ((name === "left" || name === "right") && c.src[c.i] === ".") c.i++;
      } else if (name === "begin" || name === "end") {
        const env = readArg(c);
        if (!ENV_OK.has(env)) c.unsupported.add(env);
        else if (name === "begin") readOptional(c);
      } else if (name in SYMBOLS) {
        const s = SYMBOLS[name];
        // Relations and big operators get space around them.
        push(/^[≤≥≠≈≡∼≃≅∝≪≫→←↔⇒⇐⇔↦∈∉∋⊂⊃⊆⊇∧∨×÷±∓⊕⊗]$/.test(s) ? `${SP}${s}${SP}` : s);
      } else {
        c.unsupported.add("\\" + name);
        push(name);
      }
      continue;
    }
    if (ch === "^" || ch === "_") {
      const arg = sub(readArg(c), c.unsupported);
      push(ch === "^" ? MATH_SUP_OPEN + arg + MATH_SUP_CLOSE : MATH_SUB_OPEN + arg + MATH_SUB_CLOSE);
      continue;
    }
    if (ch === "{") {
      const start = --c.i;
      const inner = readArg(c);
      if (c.i === start) c.i++;
      push(sub(inner, c.unsupported));
      continue;
    }
    if (ch === "}") continue;
    if (ch === " ") continue;
    if (ch === "&") {
      push(" ");
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      ital += ch;
      continue;
    }
    if (ch === "-") push("−");
    else if (ch === "'") push("′");
    else if (ch === "*") push("∗");
    else if (ch === "=" || ch === "<" || ch === ">") push(`${SP}${ch}${SP}`);
    else if (ch === "~") push(" ");
    else if (ch === "+") push("\u2005+\u2005");
    else push(ch);
  }
  flush();
  return out;
}

export interface MathResult {
  text: string;
  /** Commands or environments set only as plain text. */
  unsupported: string[];
}

export function latexToMarkup(latex: string): MathResult {
  const unsupported = new Set<string>();
  const text = convert({ src: latex.replace(/\s+/g, " ").trim(), i: 0, unsupported });
  return { text, unsupported: [...unsupported] };
}
