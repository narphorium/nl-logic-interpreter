// Unifies natural-language sentences with Jev, TypeSafe's System One model. Jev answers questions
// rather than generating text, so unification is two rounds of questions:
//   1. Align: could the sentences state the same fact, and which phrase does each variable stand for?
//      This is a loose filter that only rules out sentences that are clearly unrelated.
//   2. Verify: with those bindings filled in, do the sentences state the same fact about the same
//      people and things? Jev picks from a few relations, so a fact that merely implies the other
//      ("Lisa's dad is Homer" and "Homer is a parent of Lisa") has somewhere to go other than "same",
//      and a separate question catches the same relation between different people.
import { choice, noul, type Questions, type SystemOneRequest, type SystemOneResult } from "@typesafe-ai/sdk";
import {
  bind,
  candidatePhrases,
  normalize,
  replaceVariables,
  substitute,
  variablesIn,
  type Substitution,
  type Term,
} from "../shared/engine/nl.ts";
import { cachedCost, noUsage, type Check, type JevUnification, type Unifier } from "../shared/engine/unify.ts";
import { promiseCache } from "./promiseCache.ts";

export type Ask = <const Q extends Questions>(request: SystemOneRequest<Q>) => Promise<SystemOneResult<Q>>;

/**
 * Jev must be at least this sure that two sentences state the same fact about the same things. True
 * paraphrases score above 0.9; facts that merely imply each other ("Lisa's dad is Homer" and "Homer
 * is a parent of Lisa") can score up to about 0.5.
 */
export const MATCH_THRESHOLD = 0.7;
/** Alignment passes sentences on to verification unless Jev is this sure they can't match */
export const ALIGN_THRESHOLD = 0.3;

const VARIABLES =
  "Single capital letters such as X, Y and Z (optionally numbered, like X₂) are variables: placeholders that can stand for any person, thing, or value.";
const SAME_FACT =
  "Paraphrases, synonyms, and different word order count as the same fact. A different or merely related relation does not (father is not grandfather, parent is not child), and neither does swapping who does what to whom.";
const NONE = "(none of these)";

const RELATIONS = {
  same: "b states the same fact as a: a rewording, perhaps with synonyms or a different word order",
  more_specific:
    'b states a more specific fact that implies a without being the same fact, like "Rex is a dog" compared with "Rex is an animal"',
  more_general: 'b states a more general fact that a implies, like "Rex is an animal" compared with "Rex is a dog"',
  swapped: "b uses the same relation as a, but with the participants in different roles",
  different: "b states a different fact",
};
const SAME_PARTICIPANTS =
  "After filling in any variables, do statements a and b refer to exactly the same people and things? A name always refers to the same individual, and different names refer to different individuals.";
const MISMATCH: Record<string, string> = {
  more_specific: "The clause states a more specific fact, not the same one.",
  more_general: "The clause states a more general fact, not the same one.",
  swapped: "The participants play different roles.",
  different: "These state different facts.",
};

export async function aiUnify(goal: Term, head: Term, ask: Ask): Promise<JevUnification> {
  const usage = noUsage();
  const checks: Check[] = [];
  let calls = 0;
  const tally = (result: SystemOneResult<Questions>) => {
    calls++;
    usage.input_tokens += result.usage.input_tokens;
    usage.output_tokens += result.usage.output_tokens;
  };
  const decide = (unified: boolean, confidence: number, bindings: Substitution = {}, note?: string): JevUnification => ({
    unified,
    bindings: unified ? bindings : {},
    method: "jev",
    confidence,
    checks,
    note,
    calls,
    cached: false,
    usage,
  });

  // Decides whether the goal and head state the same fact once any bindings are filled in
  const verify = async (bindings: Substitution) => {
    const a = substitute(goal, bindings);
    const b = substitute(head, bindings);
    const result = await ask({
      state: { variables: VARIABLES, a, b },
      questions: {
        relation: choice("How does statement b relate to statement a?", RELATIONS),
        participants: noul(SAME_PARTICIPANTS),
      },
    });
    tally(result);
    const { choice: relation, probabilities } = result.answers.relation;
    const pRelation = probabilities.same;
    const pParticipants = result.answers.participants.noul;
    checks.push(
      {
        question: `Does "${a}" state the same fact as "${b}"?`,
        probability: pRelation,
        passed: pRelation >= MATCH_THRESHOLD,
      },
      {
        question: "Are they about the same people and things?",
        probability: pParticipants,
        passed: pParticipants >= MATCH_THRESHOLD,
      },
    );
    const p = Math.min(pRelation, pParticipants);
    if (p >= MATCH_THRESHOLD) return decide(true, p, bindings);
    const note =
      pParticipants < MATCH_THRESHOLD
        ? "These are about different people or things."
        : (MISMATCH[relation] ?? MISMATCH.different);
    return decide(false, p, bindings, note);
  };

  const goalVariables = variablesIn(goal);
  const headVariables = variablesIn(head);
  if (goalVariables.length === 0 && headVariables.length === 0) return verify({});

  // Align: one choice question per variable, over the phrases of the other sentence
  const slots: { variable: string; key: string }[] = [];
  const questions: Questions = {
    match: noul(`Could the goal and the candidate state the same fact once their variables are filled in? ${SAME_FACT}`),
  };
  const alignVariables = (variables: string[], side: string, other: Term, otherSide: string) => {
    const phrases = candidatePhrases(other);
    for (const variable of variables) {
      const options = phrases.filter((p) => p !== variable);
      if (options.length === 0) continue;
      const key = `binding_${slots.length}`;
      slots.push({ variable, key });
      questions[key] = choice(
        `The variable ${variable} appears in the ${side}. Which phrase from the ${otherSide} does ${variable} stand for?`,
        Object.fromEntries([...options, NONE].map((option) => [option, null])),
      );
    }
  };
  alignVariables(goalVariables, "goal", head, "candidate");
  alignVariables(headVariables, "candidate", goal, "goal");

  const aligned = await ask({ state: { variables: VARIABLES, goal, candidate: head }, questions });
  tally(aligned);
  const answers = aligned.answers as Record<string, { noul?: number; choice?: string }>;
  const pMatch = answers.match.noul ?? 0;
  checks.push({
    question: `Could "${goal}" and "${head}" state the same fact?`,
    probability: pMatch,
    passed: pMatch >= ALIGN_THRESHOLD,
  });
  if (pMatch < ALIGN_THRESHOLD) return decide(false, pMatch, {}, "These can't state the same fact.");

  const bindings: Substitution = {};
  for (const { variable, key } of slots) {
    const pick = answers[key].choice;
    if (!pick || pick === NONE) continue;
    if (!bind(variable, pick, bindings)) {
      return decide(false, 0, {}, `Binding ${variable} to "${pick}" conflicts with its other bindings.`);
    }
  }

  // Identical wording needs no second opinion
  if (normalize(substitute(goal, bindings)) === normalize(substitute(head, bindings))) {
    return decide(true, 1, bindings, "With the variables filled in, the sentences read the same.");
  }
  return verify(bindings);
}

// Variables named in order of appearance, so the cache ignores which fresh names a clause got
const CANONICAL = "XYZWVUTSRQPONMLKJHGFEDCB".split("");

function canonicalize(goal: Term, head: Term) {
  const toCanonical = new Map<string, string>();
  const rename = (text: Term) =>
    replaceVariables(text, (v) => {
      if (!toCanonical.has(v)) {
        const n = toCanonical.size;
        toCanonical.set(v, n < CANONICAL.length ? CANONICAL[n] : `X${n}`);
      }
      return toCanonical.get(v)!;
    });
  const canonical = { goal: rename(goal), head: rename(head) };
  const original = new Map([...toCanonical].map(([v, c]) => [c, v]));
  const restore = (text: string) => replaceVariables(text, (c) => original.get(c) ?? c);
  return { ...canonical, restore };
}

/** Runs at most `max` tasks at once */
function limiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

/** A cached, rate-limited `aiUnify` */
export function createAIUnifier(ask: Ask, { concurrency = 8 } = {}): Unifier {
  const cache = promiseCache<JevUnification>();
  const limit = limiter(concurrency);
  const limitedAsk: Ask = (request) => limit(() => ask(request));

  return async (goal, head) => {
    const { goal: g, head: h, restore } = canonicalize(goal, head);
    const { value, cached } = await cache(JSON.stringify([g, h]), () => aiUnify(g, h, limitedAsk));
    const result = {
      ...value,
      bindings: Object.fromEntries(Object.entries(value.bindings).map(([v, bound]) => [restore(v), restore(bound)])),
      checks: value.checks.map((c) => ({ ...c, question: restore(c.question) })),
      note: value.note && restore(value.note),
    };
    return cached ? { ...result, ...cachedCost() } : result;
  };
}
