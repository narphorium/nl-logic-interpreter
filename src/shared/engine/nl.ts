// Natural-language terms. A term is a sentence such as "Abe is the father of Homer", and a variable is
// a single capital letter (X, Y, Z, optionally numbered: X1, X₂) that stands for a phrase. "A" and "I"
// are ordinary words, since so many sentences start with them.

export type Term = string;
export type Substitution = { [variable: string]: Term };

const VARIABLE_PATTERN = "[A-Z](?:[0-9]+|[₀-₉]+)?";
const VARIABLE = new RegExp(String.raw`(?<![\p{L}\p{N}_])${VARIABLE_PATTERN}(?![\p{L}\p{N}_])`, "gu");
const WHOLE_VARIABLE = new RegExp(`^${VARIABLE_PATTERN}$`, "u");
const NOT_VARIABLES = new Set(["A", "I"]);

export function isVariable(term: Term): boolean {
  return WHOLE_VARIABLE.test(term) && !NOT_VARIABLES.has(term);
}

/** Replaces each variable in `text` with `replace(variable)` */
export function replaceVariables(text: Term, replace: (variable: string) => string): Term {
  return text.replace(VARIABLE, (match) => (isVariable(match) ? replace(match) : match));
}

/** Each variable occurrence in `text`, with its offsets */
export function findVariables(text: Term): { variable: string; start: number; end: number }[] {
  return [...text.matchAll(VARIABLE)]
    .filter((m) => isVariable(m[0]))
    .map((m) => ({ variable: m[0], start: m.index!, end: m.index! + m[0].length }));
}

/** The distinct variables in `text`, in order of appearance */
export const variablesIn = (text: Term): string[] => [...new Set(findVariables(text).map((v) => v.variable))];

/**
 * Follows a chain of variable bindings to the variable's value, or to the last unbound variable.
 * `bind` never makes a cycle, so a chain this long means something bypassed it.
 */
export function walk(term: Term, substitution: Substitution): Term {
  let current = term;
  for (let hops = 0; isVariable(current) && substitution[current] !== undefined; hops++) {
    if (hops === 1000) throw new Error(`The bindings of ${term} form a cycle.`);
    current = substitution[current];
  }
  return current;
}

/** Replaces every bound variable in `text` with its value */
export function substitute(text: Term, substitution: Substitution): Term {
  return replaceVariables(text, (variable) => {
    const value = walk(variable, substitution);
    return isVariable(value) ? value : substitute(value, substitution);
  });
}

const SUBSCRIPTS = "₀₁₂₃₄₅₆₇₈₉";
export const subscript = (n: number) => String(n).replace(/\d/g, (d) => SUBSCRIPTS[Number(d)]);

/** Renames each variable in `text` to a fresh one (X → X₃), sharing `renames` across a clause */
export function freshen(text: Term, renames: Map<string, string>, next: () => number): Term {
  return replaceVariables(text, (variable) => {
    if (!renames.has(variable)) {
      renames.set(variable, variable.replace(/[0-9₀-₉]+$/u, "") + subscript(next()));
    }
    return renames.get(variable)!;
  });
}

export type Token = { text: string; start: number; end: number };

// Words, clitics split off their word ("Homer's" → "Homer" + "'s"), and single punctuation marks
const TOKEN = /[\p{L}\p{N}_]+(?:-[\p{L}\p{N}_]+)*|['’]\p{L}+|\S/gu;

export function tokenize(text: string): Token[] {
  return [...text.matchAll(TOKEN)].map((m) => ({ text: m[0], start: m.index!, end: m.index! + m[0].length }));
}

/** The tokens of `text` that carry meaning: words and clitics, but not punctuation */
export function words(text: string): Token[] {
  return tokenize(text).filter((t) => /^(?:[\p{L}\p{N}_]|['’]\p{L})/u.test(t.text));
}

const wordKey = (word: string) => (isVariable(word) ? word : word.toLowerCase().replace("’", "'"));

/** A comparison key that ignores case, spacing, and punctuation */
export function normalize(text: Term): string {
  return words(text)
    .map((t) => wordKey(t.text))
    .join(" ");
}

/**
 * Unifies two terms under `substitution`, binding a variable to the other side's value. Two ground
 * phrases unify only when their wording matches; deciding whether different wordings mean the
 * same thing is Jev's job. Mutates `substitution` and returns false on a conflict.
 */
export function bind(a: Term, b: Term, substitution: Substitution): boolean {
  const resolve = (t: Term) => (isVariable(t) ? walk(t, substitution) : substitute(t, substitution));
  const x = resolve(a);
  const y = resolve(b);
  if (normalize(x) === normalize(y)) return true;
  if (isVariable(x)) {
    if (variablesIn(y).includes(x)) return false;
    substitution[x] = y;
    return true;
  }
  if (isVariable(y)) {
    if (variablesIn(x).includes(y)) return false;
    substitution[y] = x;
    return true;
  }
  return false;
}

/** Extends `substitution` with `bindings`, or returns null if they conflict */
export function extend(substitution: Substitution, bindings: Substitution): Substitution | null {
  const next = { ...substitution };
  for (const [variable, value] of Object.entries(bindings)) {
    if (!bind(variable, value, next)) return null;
  }
  return next;
}

/**
 * Unifies two sentences that use the same wording, with variables standing in for phrases.
 * Returns null when the wording differs, which leaves the question to Jev.
 */
export function matchWording(a: Term, b: Term): { unified: boolean; bindings: Substitution } | null {
  const left = words(a);
  const right = words(b);
  const aligned =
    left.length === right.length &&
    left.every((t, i) => isVariable(t.text) || isVariable(right[i].text) || wordKey(t.text) === wordKey(right[i].text));

  if (aligned) {
    const bindings: Substitution = {};
    const unified = left.every((t, i) => bind(t.text, right[i].text, bindings));
    return { unified, bindings: unified ? bindings : {} };
  }

  // A variable can span several words, but only when the other side is ground
  const [pattern, text, source] = variablesIn(b).length === 0 ? [left, right, b] : [right, left, a];
  if (variablesIn(source).length > 0) return null;
  const bindings = globMatch(pattern, text, source);
  return bindings ? { unified: true, bindings } : null;
}

// Matches `pattern` against `text`, where each variable in `pattern` matches one or more words
function globMatch(pattern: Token[], text: Token[], source: string): Substitution | null {
  const go = (p: number, t: number, bindings: Substitution): Substitution | null => {
    if (p === pattern.length) return t === text.length ? bindings : null;
    const token = pattern[p].text;
    if (!isVariable(token)) {
      return t < text.length && wordKey(token) === wordKey(text[t].text) ? go(p + 1, t + 1, bindings) : null;
    }
    const minRest = pattern.length - p - 1;
    for (let end = t + 1; end <= text.length - minRest; end++) {
      const value = source.slice(text[t].start, text[end - 1].end);
      const bound = bindings[token];
      if (bound !== undefined && normalize(bound) !== normalize(value)) continue;
      const found = go(p + 1, end, { ...bindings, [token]: value });
      if (found) return found;
    }
    return null;
  };
  return go(0, 0, {});
}

/**
 * The phrases of `text` a variable could stand for: every run of words without a variable in it,
 * plus each variable on its own. Which of them makes sense as a binding is Jev's call.
 */
export function candidatePhrases(text: Term): string[] {
  const ws = words(text);
  const found = new Map<string, string>();
  for (let i = 0; i < ws.length; i++) {
    if (isVariable(ws[i].text)) {
      found.set(ws[i].text, ws[i].text);
      continue;
    }
    for (let j = i; j < ws.length && !isVariable(ws[j].text); j++) {
      const phrase = text.slice(ws[i].start, ws[j].end);
      if (!found.has(phrase.toLowerCase())) found.set(phrase.toLowerCase(), phrase);
    }
  }
  return [...found.values()];
}

/** Capitalizes the first letter and ends the sentence with a period */
export function asSentence(text: Term): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  return trimmed[0].toUpperCase() + trimmed.slice(1) + (/[.?!]$/.test(trimmed) ? "" : ".");
}
