// Parses a program of natural-language facts and rules, one per line, and queries. A line that
// contains "if", "then", or "when" is a rule; any other line is a fact. Conditions and queries can
// join goals with "and", offer alternatives with "or", and negate a goal with a leading "not". A
// comment starting with "Try:" suggests a question to ask, and a program file's first one is its query.
import { variablesIn, type Term } from "./nl.ts";
import type { Cost } from "./unify.ts";

/** A goal to prove, or, when negated, a goal that must have no proof */
export type Literal = { sentence: Term; negated: boolean };

export type Clause = {
  type: "fact" | "rule";
  head: Term;
  body: Literal[];
  /** Zero-based line number in the program */
  line: number;
  text: string;
};
export type ParseIssue = { line: number; message: string };
export type Program = { clauses: Clause[]; issues: ParseIssue[] };

/** A query holds when all the goals of any one of its alternatives hold */
export type Query = {
  /** The query as the user wrote it */
  question: string;
  alternatives: Literal[][];
  /** Whether the question wants a verdict, or the values of its variables */
  kind: "yes-no" | "wh";
  /** What translating the question into goals cost, when an AI model did */
  translation?: Cost;
};

/** The file extension of program files */
export const PROGRAM_EXTENSION = ".nl";

const RULE_WORD = /\b(?:if|then|when)\b/i;
const NOT = /^(?:not|it is not the case that|it's not the case that)\b\s*/i;
const QUESTION_WORD =
  /^(?:who|whom|whose|what|which|where|when|why|how|is|are|was|were|am|do|does|did|has|have|had|can|could|will|would|should|shall|must|may|might)\b/i;

/** The words that give rules and queries their structure */
export const KEYWORD = /\b(?:if|then|when|and|or|not)\b/gi;

export const isRule = (line: string) => RULE_WORD.test(line);
export const isComment = (line: string) => /^\s*(?:#|%|\/\/)/.test(line);
/** Whether `text` reads as a plain-English question rather than a goal with variables */
export const looksLikeQuestion = (text: string) => QUESTION_WORD.test(text.trim());

/** Trims a sentence and drops its closing punctuation */
export const stripSentence = (text: string) => text.trim().replace(/[.?!]+$/, "").trim();

/** Reads a goal, taking a leading "not" as negation */
export function parseLiteral(text: string): Literal {
  const sentence = stripSentence(text);
  const not = sentence.match(NOT);
  return not ? { sentence: sentence.slice(not[0].length).trim(), negated: true } : { sentence, negated: false };
}

/** Writes a literal back as a goal */
export const showLiteral = (literal: Literal): string => (literal.negated ? `not ${literal.sentence}` : literal.sentence);

/** Splits a conjunction ("X is a bird and X is small") into its goals */
export function splitConjuncts(text: string): string[] {
  return stripSentence(text)
    .split(/\s*(?:,\s*and\b|\band\b|[;,])\s*/i)
    .map((goal) => goal.trim())
    .filter(Boolean);
}

/** Splits alternatives ("X is a bird or X is a bat") on "or"; "and" binds tighter than "or" */
export function splitDisjuncts(text: string): string[] {
  return stripSentence(text)
    .replace(/^either\b\s*/i, "")
    .split(/\s*(?:,\s*or\b|\bor\b)\s*/i)
    .map((alternative) => alternative.trim())
    .filter(Boolean);
}

/** Reads conditions as alternatives of goals: "or" between conjunctions, "and" within them */
export const parseConditions = (text: string): Literal[][] =>
  splitDisjuncts(text).map((alternative) => splitConjuncts(alternative).map(parseLiteral));

/**
 * Splits a rule into its conclusion (head) and conditions, one body per alternative. Accepts
 * "If B, then H", "If B, H", "When B, H", "B then H", and "H if B" / "H when B".
 */
export function parseRule(sentence: string): { head: Term; bodies: Literal[][] } | { error: string } {
  const s = stripSentence(sentence);
  const thenSplit = (text: string) => text.match(/^(.*?)\s*,?\s*\bthen\b\s*(.*)$/i);
  let head: string | undefined;
  let body: string | undefined;

  const leading = s.match(/^(?:if|when)\b\s*(.*)$/i);
  if (leading) {
    const rest = leading[1];
    const then = thenSplit(rest);
    const comma = rest.lastIndexOf(",");
    if (then) [body, head] = [then[1], then[2]];
    else if (comma >= 0) [body, head] = [rest.slice(0, comma), rest.slice(comma + 1)];
  } else {
    const then = thenSplit(s);
    const condition = s.match(/^(.*?)\s*,?\s*\b(?:if|when)\b\s*(.*)$/i);
    if (then) [body, head] = [then[1].replace(/^(?:if|when)\b\s*/i, ""), then[2]];
    else if (condition) [head, body] = [condition[1], condition[2]];
  }

  head = head?.trim();
  const bodies = body ? parseConditions(body) : [];
  if (!head) return { error: 'Can\'t find the conclusion. Write "If …, then …" or "… if …".' };
  if (bodies.length === 0 || bodies.some((goals) => goals.length === 0)) {
    return { error: "Can't find the conditions of this rule." };
  }
  if (isRule(head) || bodies.flat().some((goal) => isRule(goal.sentence))) {
    return { error: 'A rule can only have one "if", "then", or "when".' };
  }
  if (/\bor\b/i.test(head)) return { error: 'A rule can only conclude one thing. Write two rules instead of "or".' };
  if (parseLiteral(head).negated) return { error: 'A rule can\'t conclude "not". Rules only prove positive facts.' };
  return { head, bodies };
}

export function parseProgram(text: string): Program {
  const clauses: Clause[] = [];
  const issues: ParseIssue[] = [];
  text.split("\n").forEach((raw, line) => {
    const sentence = raw.trim();
    if (!sentence || isComment(sentence)) return;
    if (!isRule(sentence)) {
      clauses.push({ type: "fact", head: stripSentence(sentence), body: [], line, text: sentence });
      return;
    }
    const rule = parseRule(sentence);
    if ("error" in rule) issues.push({ line, message: rule.error });
    else rule.bodies.forEach((body) => clauses.push({ type: "rule", head: rule.head, body, line, text: sentence }));
  });
  return { clauses, issues };
}

/** The distinct variables in a query's goals, in order of appearance */
export const queryVariables = (query: Query): string[] => [
  ...new Set(query.alternatives.flat().flatMap((goal) => variablesIn(goal.sentence))),
];

/**
 * Reads a query written as goals: one or more goals joined by "and", alternatives joined by "or",
 * a leading "not" for negation, and an optional question mark.
 */
export function parseQuery(text: string): Query {
  const query: Query = { question: text.trim(), alternatives: parseConditions(text), kind: "yes-no" };
  if (queryVariables(query).length > 0) query.kind = "wh";
  return query;
}

// A comment suggesting a question, like "# Try: Who is Bart's grandfather?"
const TRY = /^\s*(?:#|%|\/\/)\s*try:(.*)$/i;

/** Reads a program file: the whole file is the program, and its first "Try:" comment is its query */
export function parseProgramFile(text: string): { program: string; query: string } {
  const program = text.replace(/\r\n/g, "\n").trimEnd();
  const query = program
    .split("\n")
    .map((line) => line.match(TRY)?.[1].trim())
    .find(Boolean);
  return { program, query: query ?? "" };
}
