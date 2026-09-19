// SLD resolution over natural-language clauses. Works like a Prolog interpreter, except that
// unification asks Jev whether two sentences state the same fact whenever their wording differs.
// A query's alternatives are searched in turn, and a negated goal ("not X is a bird") holds when
// the search for the positive goal finds no proof.
import { asSentence, extend, freshen, matchWording, substitute, variablesIn, type Substitution, type Term } from "./nl.ts";
import { parseProgram, queryVariables, showLiteral, type Clause, type Literal, type Program, type Query } from "./program.ts";
import type { Cost, Unification, Unifier } from "./unify.ts";

export type Frame = {
  id: string;
  goals: Literal[];
  substitution: Substitution;
  depth: number;
  parent?: Frame;
};

export type Solution = {
  /** The query's variables and their values */
  bindings: Record<string, Term>;
  /** The query restated with its variables filled in */
  answer: string;
};

// A step that proves the last goal completes a solution to the query, and carries it
export type ExecutionStep =
  | { type: "success"; goal: Term; clause: Clause; frame: Frame; unification: Unification; solution?: Solution }
  | { type: "failure"; goal: Term; clause: Clause; frame: Frame; unification: Unification }
  | { type: "cutoff"; goal: Term; frame: Frame; reason: string }
  /** The outcome of a negated goal: it holds when the search for `goal` found no proof */
  | { type: "negation"; goal: Term; frame: Frame; holds: boolean; note?: string; solution?: Solution };

/** The solution a step completes, if it completes one */
export const solutionOf = (step: ExecutionStep): Solution | undefined => ("solution" in step ? step.solution : undefined);

/** What a run's AI calls cost, from translating its query to its last unification */
export type RunStats = { calls: number; cached: number; inputTokens: number; outputTokens: number };

export type RunOptions = {
  onStep?: (step: ExecutionStep, index: number) => void;
  signal?: AbortSignal;
  /** Deepest proof to search before giving up on a branch */
  maxDepth?: number;
  /** Stop searching after this many steps */
  maxSteps?: number;
};

export type RunResult = {
  steps: ExecutionStep[];
  solutions: Solution[];
  stats: RunStats;
  /** True when the search stopped at `maxSteps` before exploring every branch */
  truncated: boolean;
};

const LIMITS = { maxDepth: 25, maxSteps: 2000 };

// What a search does with each proof it finds, returning the solution if it keeps one, and whether it
// has seen enough
type Search = { onSolution: (frame: Frame) => Solution | undefined; done: () => boolean };

// A step that makes progress: it completes a solution when it leaves no goals to prove
type Progress = Extract<ExecutionStep, { type: "success" | "negation" }>;

// Thrown by the step that reaches `maxSteps`, to end the whole search
class StepLimit extends Error {}

// Negated goals go last, so their variables are bound by the time they're tried
const delayNegations = (goals: Literal[]): Literal[] => [...goals.filter((g) => !g.negated), ...goals.filter((g) => g.negated)];

const emptyStats = (): RunStats => ({ calls: 0, cached: 0, inputTokens: 0, outputTokens: 0 });

function tally(stats: RunStats, cost: Cost) {
  stats.calls += cost.calls;
  stats.cached += cost.cached ? 1 : 0;
  stats.inputTokens += cost.usage.input_tokens;
  stats.outputTokens += cost.usage.output_tokens;
}

export class NLEngine {
  readonly program: Program;
  /** The current run's AI costs so far */
  stats = emptyStats();
  /** Whether the current run stopped at `maxSteps` */
  truncated = false;

  #unifier: Unifier;
  #options: RunOptions & typeof LIMITS = LIMITS;
  #steps: ExecutionStep[] = [];
  #solutions: Solution[] = [];
  #variableCounter = 0;
  #frameCounter = 0;

  constructor(programText: string, unifier: Unifier) {
    this.program = parseProgram(programText);
    this.#unifier = unifier;
  }

  async run(query: Query, options: RunOptions = {}): Promise<RunResult> {
    const { alternatives } = query;
    if (alternatives.length === 0 || alternatives.some((goals) => goals.length === 0)) throw new Error("The query is empty.");
    this.#options = { ...LIMITS, ...options };
    this.#steps = [];
    this.#solutions = [];
    this.stats = emptyStats();
    this.truncated = false;
    if (query.translation) tally(this.stats, query.translation);

    const variables = queryVariables(query);
    try {
      for (const goals of alternatives) {
        const root: Frame = { id: this.#frameId(), goals: delayNegations(goals), substitution: {}, depth: 0 };
        await this.#solve(root, { onSolution: (frame) => this.#solution(frame, goals, variables), done: () => false });
      }
    } catch (error) {
      if (!(error instanceof StepLimit)) throw error;
      this.truncated = true;
    }
    return { steps: this.#steps, solutions: this.#solutions, stats: this.stats, truncated: this.truncated };
  }

  #solution(frame: Frame, goals: Literal[], variables: string[]): Solution {
    const bindings = Object.fromEntries(variables.map((v) => [v, substitute(v, frame.substitution)]));
    const answer = goals.map((goal) => showLiteral({ ...goal, sentence: substitute(goal.sentence, frame.substitution) }));
    const solution = { bindings, answer: asSentence(answer.join(" and ")) };
    this.#solutions.push(solution);
    return solution;
  }

  async #solve(frame: Frame, search: Search): Promise<void> {
    this.#options.signal?.throwIfAborted();
    const [goal, ...rest] = frame.goals;
    if (frame.depth >= this.#options.maxDepth) {
      this.#record({ type: "cutoff", goal: goal.sentence, frame, reason: `Gave up on this branch at depth ${frame.depth}.` });
      return;
    }
    if (goal.negated) return this.#solveNegation(goal.sentence, rest, frame, search);

    // Unifying the goal with each clause is independent, so ask about them all at once
    const clauses = this.program.clauses.map((clause) => this.#freshen(clause));
    const unifications = await untilAborted(
      Promise.all(clauses.map((clause) => this.#unify(goal.sentence, clause.head))),
      this.#options.signal,
    );

    for (const [i, clause] of clauses.entries()) {
      if (search.done()) return;
      const unification = unifications[i];
      const substitution = unification.unified ? extend(frame.substitution, unification.bindings) : null;
      if (!substitution) {
        const failed = unification.unified
          ? { ...unification, unified: false, note: "The bindings conflict with ones already made." }
          : unification;
        this.#record({ type: "failure", goal: goal.sentence, clause, frame, unification: failed });
        continue;
      }
      const next: Frame = {
        id: this.#frameId(),
        goals: delayNegations([...clause.body, ...rest].map((g) => ({ ...g, sentence: substitute(g.sentence, substitution) }))),
        substitution,
        depth: frame.depth + 1,
        parent: frame,
      };
      await this.#advance({ type: "success", goal: goal.sentence, clause, frame: next, unification }, next, search);
    }
  }

  // Negation as failure: "not G" holds when a search for G finds no proof. It binds nothing.
  async #solveNegation(goal: Term, rest: Literal[], frame: Frame, search: Search): Promise<void> {
    let proved = false;
    const attempt: Frame = {
      id: this.#frameId(),
      goals: [{ sentence: goal, negated: false }],
      substitution: frame.substitution,
      depth: frame.depth + 1,
      parent: frame,
    };
    await this.#solve(attempt, {
      onSolution: () => {
        proved = true;
        return undefined;
      },
      done: () => proved,
    });

    const unbound = variablesIn(goal);
    const note =
      unbound.length > 0
        ? `${unbound.join(" and ")} ${unbound.length === 1 ? "was" : "were"} still unbound, so this asked whether anything at all can be proved.`
        : undefined;
    if (proved) {
      this.#record({ type: "negation", goal, frame, holds: false, note });
      return;
    }
    const next: Frame = { id: this.#frameId(), goals: rest, substitution: frame.substitution, depth: frame.depth + 1, parent: frame };
    await this.#advance({ type: "negation", goal, frame, holds: true, note }, next, search);
  }

  // Records a step that leads to `next`, then proves next's goals. With none left, the step completes
  // a proof and carries its solution.
  async #advance(step: Progress, next: Frame, search: Search): Promise<void> {
    const solution = next.goals.length === 0 ? search.onSolution(next) : undefined;
    this.#record({ ...step, solution });
    if (next.goals.length > 0) await this.#solve(next, search);
  }

  // Sentences with the same wording unify without AI; Jev decides the rest
  async #unify(goal: Term, head: Term): Promise<Unification> {
    const match = matchWording(goal, head);
    if (match) {
      const note = match.unified ? "Same wording." : "Same wording, but a variable would need two different values.";
      return { method: "wording", ...match, note };
    }
    const unification = await this.#unifier(goal, head);
    tally(this.stats, unification);
    return unification;
  }

  #freshen(clause: Clause): Clause {
    const renames = new Map<string, string>();
    const next = () => ++this.#variableCounter;
    return {
      ...clause,
      head: freshen(clause.head, renames, next),
      body: clause.body.map((goal) => ({ ...goal, sentence: freshen(goal.sentence, renames, next) })),
    };
  }

  #frameId() {
    return `R${++this.#frameCounter}`;
  }

  #record(step: ExecutionStep) {
    this.#steps.push(step);
    this.#options.onStep?.(step, this.#steps.length - 1);
    if (this.#steps.length >= this.#options.maxSteps) throw new StepLimit();
  }
}

// Settles like `promise`, or rejects as soon as `signal` aborts, so stopping a run doesn't wait for a
// batch of unifications to come back
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
