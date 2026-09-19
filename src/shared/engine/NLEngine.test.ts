import { describe, expect, it, vi } from "vitest";
import { matchWording, type Term } from "./nl.ts";
import { NLEngine, solutionOf } from "./NLEngine.ts";
import { parseQuery, type Query } from "./program.ts";
import type { Unifier } from "./unify.ts";

// Stands in for Jev: rewrites known paraphrases into canonical wording, then matches by wording
const paraphrases: [RegExp, string][] = [
  [/^(.+)'s (?:father|dad) is (.+)$/, "$2 is the father of $1"],
  [/^(.+) is (.+)'s (father|dad)$/, "$1 is the father of $2"],
];
const canonical = (text: Term) => paraphrases.reduce((t, [pattern, replacement]) => t.replace(pattern, replacement), text);

const fakeJev: Unifier = async (goal, head) => {
  const match = matchWording(canonical(goal), canonical(head));
  return {
    unified: match?.unified ?? false,
    bindings: match?.bindings ?? {},
    method: "jev",
    confidence: match?.unified ? 0.9 : 0.1,
    checks: [],
    calls: 1,
    cached: false,
    usage: { input_tokens: 10, output_tokens: 2 },
  };
};

const FAMILY = `Orville is the father of Abe.
Abe is Homer's father.
Homer is the father of Bart.
Lisa's dad is Homer.
If X is the father of Y then X is a parent of Y.
X is a grandfather of Y if X is the father of Z and Z is a parent of Y.`;

describe("NLEngine", () => {
  it("finds every solution through paraphrased facts", async () => {
    const engine = new NLEngine(FAMILY, fakeJev);
    const { solutions, truncated } = await engine.run(parseQuery("X is a grandfather of Y?"));
    expect(truncated).toBe(false);
    expect(solutions.map((s) => s.bindings)).toEqual([
      { X: "Orville", Y: "Homer" },
      { X: "Abe", Y: "Bart" },
      { X: "Abe", Y: "Lisa" },
    ]);
    expect(solutions[1].answer).toBe("Abe is a grandfather of Bart.");
  });

  it("answers ground queries without bindings", async () => {
    const engine = new NLEngine(FAMILY, fakeJev);
    expect((await engine.run(parseQuery("Homer is a parent of Lisa?"))).solutions).toEqual([
      { bindings: {}, answer: "Homer is a parent of Lisa." },
    ]);
    expect((await new NLEngine(FAMILY, fakeJev).run(parseQuery("Bart is a parent of Homer?"))).solutions).toEqual([]);
  });

  it("only asks the unifier about sentences worded differently", async () => {
    const unifier = vi.fn(fakeJev);
    await new NLEngine("Abe is the father of Homer.\nAbe is Homer's father.", unifier).run(parseQuery("Abe is the father of X"));
    expect(unifier).toHaveBeenCalledTimes(1);
    expect(unifier.mock.calls).toEqual([["Abe is the father of X", "Abe is Homer's father"]]);
  });

  it("records each unification's outcome, and puts a solution on the step that completes it", async () => {
    const engine = new NLEngine("Abe is the father of Homer.", fakeJev);
    const { steps } = await engine.run(parseQuery("Abe is the father of X"));
    expect(steps).toMatchObject([{ type: "success", solution: { bindings: { X: "Homer" } } }]);
  });

  it("gives up on branches deeper than maxDepth", async () => {
    const engine = new NLEngine("X is an ancestor of Y if X is an ancestor of Y.", fakeJev);
    const { steps, solutions } = await engine.run(parseQuery("X is an ancestor of Bart"), { maxDepth: 5 });
    expect(solutions).toEqual([]);
    expect(steps.at(-1)).toMatchObject({ type: "cutoff" });
  });

  it("stops at maxSteps", async () => {
    const engine = new NLEngine("X is an ancestor of Y if X is an ancestor of Y.", fakeJev);
    const { steps, truncated } = await engine.run(parseQuery("X is an ancestor of Bart"), { maxSteps: 7 });
    expect(truncated).toBe(true);
    expect(steps).toHaveLength(7);
  });

  it("stops when aborted", async () => {
    const controller = new AbortController();
    const engine = new NLEngine(FAMILY, fakeJev);
    const run = engine.run(parseQuery("X is a grandfather of Y"), {
      signal: controller.signal,
      onStep: (_, i) => i === 3 && controller.abort(),
    });
    await expect(run).rejects.toThrow();
  });

  it("starts each run afresh", async () => {
    const engine = new NLEngine(FAMILY, fakeJev);
    await engine.run(parseQuery("X is an ancestor of Bart"), { maxSteps: 3 });
    const { steps, truncated } = await engine.run(parseQuery("Abe is the father of X"));
    expect(truncated).toBe(false);
    expect(steps.every((s) => s.goal === "Abe is the father of X")).toBe(true);
  });

  it("totals Jev usage", async () => {
    const engine = new NLEngine(FAMILY, fakeJev);
    const { stats } = await engine.run(parseQuery("Abe is the father of X"));
    expect(stats.calls).toBeGreaterThan(0);
    expect(stats.inputTokens).toBe(stats.calls * 10);
  });

  it("renames each clause's variables apart from the query's", async () => {
    const engine = new NLEngine("X is liked by Y if Y likes X.\nBart likes Lisa.", fakeJev);
    const { solutions, steps } = await engine.run(parseQuery("Lisa is liked by X"));
    expect(solutions.map((s) => s.bindings)).toEqual([{ X: "Bart" }]);
    const ruleHeads = steps.flatMap((s) =>
      (s.type === "success" || s.type === "failure") && s.clause.type === "rule" ? [s.clause.head] : [],
    );
    expect(ruleHeads[0]).toBe("X₁ is liked by Y₂");
  });
});

describe("NLEngine with or and not", () => {
  it("searches each alternative of a query in turn", async () => {
    const engine = new NLEngine(FAMILY, fakeJev);
    const { solutions } = await engine.run(parseQuery("X is the father of Abe or X is the father of Bart?"));
    expect(solutions.map((s) => s.bindings)).toEqual([{ X: "Orville" }, { X: "Homer" }]);
    expect(solutions[1].answer).toBe("Homer is the father of Bart.");
  });

  it("proves a negated goal by failing to prove it", async () => {
    const engine = new NLEngine(FAMILY, fakeJev);
    const { solutions, steps } = await engine.run(parseQuery("X is the father of Y and not X is a grandfather of Z"));
    // The fathers who aren't grandfathers: Homer, once per child
    expect(solutions.map((s) => s.bindings.X)).toEqual(["Homer", "Homer"]);
    expect(solutions[0].answer).toBe("Homer is the father of Bart and not Homer is a grandfather of Z.");
    const negations = steps.flatMap((s) => (s.type === "negation" ? [s] : []));
    expect(negations.map((s) => s.holds)).toEqual([false, false, true, true]);
    expect(negations[0]).toMatchObject({ goal: "Orville is a grandfather of Z", note: expect.stringContaining("Z was still unbound") });
    // The search for a proof stops at the first one it finds
    expect(steps.filter(solutionOf)).toHaveLength(2);
  });

  it("delays negated goals until the positive ones have bound their variables", async () => {
    const engine = new NLEngine(FAMILY, fakeJev);
    const { solutions, steps } = await engine.run(parseQuery("not X is a grandfather of Z and X is the father of Y"));
    expect(solutions.map((s) => s.bindings.X)).toEqual(["Homer", "Homer"]);
    expect(steps[0]).toMatchObject({ goal: "X is the father of Y" });
    const negation = steps.find((s) => s.type === "negation")!;
    expect(negation.frame.goals[0]).toEqual({ sentence: "Orville is a grandfather of Z", negated: true });
  });

  it("runs a query that was already read, restating its goals in the answers", async () => {
    const query: Query = {
      question: "Is Homer a father?",
      alternatives: [[{ sentence: "Homer is the father of X", negated: false }]],
      kind: "yes-no",
    };
    const engine = new NLEngine(FAMILY, fakeJev);
    const { solutions } = await engine.run(query);
    expect(solutions.map((s) => s.bindings)).toEqual([{ X: "Bart" }, { X: "Lisa" }]);
    expect(solutions.map((s) => s.answer)).toEqual(["Homer is the father of Bart.", "Homer is the father of Lisa."]);
  });

  it("counts translating the query in the run's stats", async () => {
    const query: Query = {
      ...parseQuery("Abe is the father of X"),
      translation: { calls: 1, cached: false, usage: { input_tokens: 500, output_tokens: 50 } },
    };
    const { stats } = await new NLEngine("Abe is the father of Homer.", fakeJev).run(query);
    expect(stats).toEqual({ calls: 1, cached: 0, inputTokens: 500, outputTokens: 50 });
  });

  it("rejects a query with an empty alternative", async () => {
    const query: Query = { question: "", alternatives: [[]], kind: "yes-no" };
    await expect(new NLEngine(FAMILY, fakeJev).run(query)).rejects.toThrow("The query is empty.");
  });
});
