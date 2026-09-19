// The contract between the engine and whatever decides whether two sentences unify.
import type { Substitution, Term } from "./nl.ts";

export type Usage = { input_tokens: number; output_tokens: number };

export const noUsage = (): Usage => ({ input_tokens: 0, output_tokens: 0 });

/** What an AI model's answer cost: the calls made for it, and their tokens */
export type Cost = { calls: number; cached: boolean; usage: Usage };

/** The cost of an answer served from a cache: nothing */
export const cachedCost = (): Cost => ({ calls: 0, cached: true, usage: noUsage() });

/** One question put to Jev while unifying, with the probability it answered yes */
export type Check = {
  question: string;
  probability: number;
  /** Whether the probability cleared this question's threshold */
  passed: boolean;
};

/** A unification decided without AI, because the sentences match word for word */
export type WordingUnification = {
  method: "wording";
  unified: boolean;
  bindings: Substitution;
  note: string;
};

/** A unification Jev decided */
export type JevUnification = Cost & {
  method: "jev";
  unified: boolean;
  /** Bindings for variables on either side, to be merged into the caller's substitution */
  bindings: Substitution;
  /** Probability that the goal and head state the same fact */
  confidence: number;
  checks: Check[];
  /** How the decision was reached, when there's more to say than the confidence */
  note?: string;
};

export type Unification = WordingUnification | JevUnification;

/** Decides whether a goal unifies with a clause's head when their wording differs */
export type Unifier = (goal: Term, head: Term) => Promise<JevUnification>;
