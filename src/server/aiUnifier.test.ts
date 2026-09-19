import type { Questions, SystemOneRequest, SystemOneResult } from "@typesafe-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { createAIUnifier, aiUnify, type Ask } from "./aiUnifier.ts";

type Answers = Record<
  string,
  { type: "noul"; noul: number } | { type: "choice"; choice: string; probabilities?: Record<string, number> }
>;

// Jev's answers to the verification questions: the relation it picks, with p(same) = `same`, and
// whether both statements are about the same people and things
const relation = (same: number, pick = same >= 0.5 ? "same" : "different", participants = 1): Answers => ({
  relation: { type: "choice", choice: pick, probabilities: { same, [pick]: pick === "same" ? same : 1 - same } },
  participants: { type: "noul", noul: participants },
});

// A fake Jev that answers each request with the next scripted set of answers, keyed by question text
function scriptedAsk(script: ((request: SystemOneRequest<Questions>) => Answers)[]) {
  const requests: SystemOneRequest<Questions>[] = [];
  const ask = vi.fn(async (request: SystemOneRequest<Questions>) => {
    requests.push(request);
    const answers = script[requests.length - 1](request);
    return { model: "jev-test", answers, usage: { input_tokens: 100, output_tokens: 10 } } as SystemOneResult<Questions>;
  });
  return { ask: ask as unknown as Ask, requests, calls: ask };
}

// Answers each binding question by picking the option `pick(variable)` names
function bindingAnswers(request: SystemOneRequest<Questions>, match: number, pick: Record<string, string>): Answers {
  const answers: Answers = { match: { type: "noul", noul: match } };
  for (const [key, question] of Object.entries(request.questions)) {
    if (question.type !== "choice") continue;
    const variable = String(question.instructions).match(/variable (\S+) appears/)![1];
    answers[key] = { type: "choice", choice: pick[variable] ?? "(none of these)" };
  }
  return answers;
}

describe("aiUnify", () => {
  it("asks one yes/no question when neither side has variables", async () => {
    const { ask, requests } = scriptedAsk([() => relation(0.97)]);
    const result = await aiUnify("Abe is the father of Homer", "Abe is Homer's father", ask);
    expect(result).toMatchObject({ unified: true, bindings: {}, method: "jev", confidence: 0.97, calls: 1 });
    expect(requests[0].state).toMatchObject({ a: "Abe is the father of Homer", b: "Abe is Homer's father" });
  });

  it("binds variables to phrases, then verifies the filled-in sentences", async () => {
    const { ask, requests } = scriptedAsk([
      (r) => bindingAnswers(r, 0.8, { X: "Abe", Y: "Homer" }),
      () => relation(0.95),
    ]);
    const result = await aiUnify("X is the father of Y", "Homer's father is Abe", ask);
    expect(result).toMatchObject({ unified: true, bindings: { X: "Abe", Y: "Homer" }, confidence: 0.95, calls: 2 });
    expect(result.usage).toEqual({ input_tokens: 200, output_tokens: 20 });
    expect(Object.keys(requests[0].questions)).toEqual(["match", "binding_0", "binding_1"]);
    expect(requests[1].state).toMatchObject({ a: "Abe is the father of Homer", b: "Homer's father is Abe" });
  });

  it("skips verification when the filled-in sentences read the same", async () => {
    const { ask, calls } = scriptedAsk([(r) => bindingAnswers(r, 0.9, { X: "Abe", Y: "Homer" })]);
    const result = await aiUnify("X is the father of Y", "Abe is the father of Homer.", ask);
    expect(result).toMatchObject({ unified: true, bindings: { X: "Abe", Y: "Homer" }, confidence: 1 });
    expect(result.note).toBeTruthy();
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it("fails without binding when Jev says the sentences can't match", async () => {
    const { ask, calls } = scriptedAsk([(r) => bindingAnswers(r, 0.05, { X: "Abe" })]);
    const result = await aiUnify("X is the grandfather of Bart", "Abe is the father of Bart", ask);
    expect(result).toMatchObject({ unified: false, bindings: {}, confidence: 0.05 });
    expect(result.note).toBeTruthy();
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it("fails when the filled-in sentences state different facts", async () => {
    const { ask } = scriptedAsk([
      (r) => bindingAnswers(r, 0.6, { X: "Homer", Y: "Abe" }),
      () => relation(0.1, "swapped"),
    ]);
    const result = await aiUnify("X is the father of Y", "Homer's father is Abe", ask);
    expect(result).toMatchObject({ unified: false, bindings: {}, confidence: 0.1 });
    expect(result.note).toMatch(/roles/);
  });

  it("passes weak alignments on to verification, which rejects implied facts", async () => {
    const { ask, calls } = scriptedAsk([
      (r) => bindingAnswers(r, 0.4, { Y: "Lisa" }),
      () => relation(0.41, "more_specific"),
    ]);
    const result = await aiUnify("Homer is a parent of Y", "Lisa's dad is Homer", ask);
    expect(calls).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ unified: false, confidence: 0.41 });
    expect(result.note).toMatch(/more specific/);
  });

  it("rejects the same relation between different people", async () => {
    const { ask } = scriptedAsk([
      (r) => bindingAnswers(r, 0.39, { Y: "Maggie" }),
      () => relation(0.53, "same", 0.08),
    ]);
    const result = await aiUnify("Abe is the father of Y", "Homer is Maggie's father", ask);
    expect(result).toMatchObject({ unified: false, confidence: 0.08 });
    expect(result.note).toMatch(/different people/);
    expect(result.checks.map((c) => c.probability)).toEqual([0.39, 0.53, 0.08]);
    // The first question is a loose filter, so 39% passes it; the others need 70%
    expect(result.checks.map((c) => c.passed)).toEqual([true, false, false]);
  });

  it("binds variables on both sides to each other", async () => {
    const { ask } = scriptedAsk([
      (r) => bindingAnswers(r, 0.9, { X: "W", Y: "Bart", W: "X", Z: "Bart" }),
      () => relation(0.9),
    ]);
    const result = await aiUnify("X is Bart's grandfather", "W is a grandfather of Z", ask);
    expect(result).toMatchObject({ unified: true, bindings: { X: "W", Z: "Bart" } });
  });
});

describe("createAIUnifier", () => {
  it("caches results across renamings of the same variables", async () => {
    const { ask, calls } = scriptedAsk([
      (r) => bindingAnswers(r, 0.9, { X: "Abe", Y: "Homer" }),
      () => relation(0.9),
    ]);
    const unify = createAIUnifier(ask);
    const first = await unify("X₁ is the father of Z₂", "Homer's father is Abe");
    const second = await unify("X₇ is the father of Z₉", "Homer's father is Abe");
    expect(calls).toHaveBeenCalledTimes(2);
    expect(first).toMatchObject({ cached: false, calls: 2, bindings: { "X₁": "Abe", "Z₂": "Homer" } });
    expect(second).toMatchObject({ cached: true, calls: 0, bindings: { "X₇": "Abe", "Z₉": "Homer" } });
    expect(second.usage).toEqual({ input_tokens: 0, output_tokens: 0 });
    expect(second.checks[0].question).toContain("X₇");
  });

  it("doesn't cache failed requests", async () => {
    let fail = true;
    const ask = (async () => {
      if (fail) throw new Error("rate limited");
      return { model: "jev-test", answers: relation(1), usage: { input_tokens: 1, output_tokens: 1 } };
    }) as unknown as Ask;
    const unify = createAIUnifier(ask);
    await expect(unify("Abe is old", "Abe is elderly")).rejects.toThrow("rate limited");
    fail = false;
    await expect(unify("Abe is old", "Abe is elderly")).resolves.toMatchObject({ unified: true });
  });
});
