// Plain-English descriptions of queries, matches, and steps, for the proof and timeline panes.
import type { ExecutionStep, Frame } from "@shared/engine/NLEngine";
import { substitute, type Substitution, type Term } from "@shared/engine/nl";
import { showLiteral, type Query } from "@shared/engine/program";
import type { Unification } from "@shared/engine/unify";

export const quote = (text: Term) => `“${text}”`;
export const percent = (p: number) => `${Math.round(p * 100)}%`;

/** `word`, or its plural unless there's exactly one: "1 rule", "2 rules", "2 SOLUTIONS" */
export const plural = (count: number, word: string) => (count === 1 ? word : `${word}${word === word.toUpperCase() ? "S" : "s"}`);

/** 850 ms → "0.9s", 75 s → "1m 15s" */
export function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${String(Math.round(seconds % 60)).padStart(2, "0")}s`;
}

const formatBindings = (bindings: Substitution) =>
  Object.entries(bindings)
    .map(([variable, value]) => `${variable} = ${value}`)
    .join(", ");

/** The query's variables that `frame` has bound, with their values */
export function frameBindings(frame: Frame, queryVariables: string[]): string {
  return formatBindings(
    Object.fromEntries(
      queryVariables.map((v) => [v, substitute(v, frame.substitution)] as const).filter(([v, value]) => value !== v),
    ),
  );
}

/** A query as goals: alternatives joined by "or", and each one's goals by "and" */
export const describeQuery = (query: Query) =>
  query.alternatives.map((goals) => goals.map(showLiteral).join(" and ")).join(" or ");

function describeMatch(u: Unification): string {
  if (u.method === "wording") return u.note;
  const cached = u.cached ? " (cached)" : "";
  if (u.unified && u.note) return `${u.note.replace(/\.$/, "")}${cached}.`;
  const likelihood = `${percent(u.confidence)} likely they state the same fact${cached}.`;
  return u.unified ? likelihood : `${u.note ?? ""} ${likelihood}`.trim();
}

export function describeStep(step: ExecutionStep): string {
  switch (step.type) {
    case "success": {
      const bindings = formatBindings(step.unification.bindings);
      const goals = step.solution
        ? `That was the last goal, so this is a solution: ${step.solution.answer}`
        : step.frame.goals.length
          ? `New goals: ${step.frame.goals.map((g) => quote(showLiteral(g))).join(", ")}.`
          : "No goals left.";
      return `Unified ${quote(step.goal)} with ${quote(step.clause.head)} (line ${step.clause.line + 1}). ${describeMatch(step.unification)} ${
        bindings ? `Bindings: {${bindings}}. ` : ""
      }${goals}`;
    }
    case "failure":
      return `No match between ${quote(step.goal)} and ${quote(step.clause.head)} (line ${step.clause.line + 1}). ${describeMatch(step.unification)}`;
    case "cutoff":
      return `${quote(step.goal)}: ${step.reason}`;
    case "negation": {
      const note = step.note ? ` ${step.note}` : "";
      const solution = step.solution ? ` That was the last goal, so this is a solution: ${step.solution.answer}` : "";
      return step.holds
        ? `${quote(`not ${step.goal}`)} holds: no proof of ${quote(step.goal)} was found.${note}${solution}`
        : `${quote(`not ${step.goal}`)} fails: ${quote(step.goal)} was proved.${note}`;
    }
  }
}
