import { describe, expect, it } from "vitest";
import { NLEngine, solutionOf, type ExecutionStep } from "./NLEngine.ts";
import { parseQuery } from "./program.ts";
import { TraceDecoder, TraceEncoder, type TraceEvent } from "./trace.ts";
import type { Unifier } from "./unify.ts";

// Unifies only sentences with the same wording
const noAI: Unifier = async () => ({
  unified: false,
  bindings: {},
  method: "jev",
  confidence: 0,
  checks: [],
  calls: 0,
  cached: false,
  usage: { input_tokens: 0, output_tokens: 0 },
});

const stats = { calls: 0, cached: 0, inputTokens: 0, outputTokens: 0, elapsedMs: 0 };

const PROGRAM = `Abe is the father of Homer.
Homer is the father of Bart.
If X is the father of Y then X is a parent of Y.
X is a grandparent of Y if X is a parent of Z and Z is a parent of Y.`;

describe("TraceEncoder and TraceDecoder", () => {
  it("round-trip a run's steps through JSON, sharing frames between steps", async () => {
    const { steps } = await new NLEngine(PROGRAM, noAI).run(parseQuery("X is a grandparent of Bart"));
    const encoder = new TraceEncoder();
    const decoder = new TraceDecoder();
    const wire: TraceEvent[] = steps.map((step) => JSON.parse(JSON.stringify({ type: "step", ...encoder.encode(step), stats })));
    const decoded = wire.map((event) => {
      const decodedEvent = decoder.decode(event);
      if (decodedEvent.type !== "step") throw new Error("Expected a step event.");
      return decodedEvent.step;
    });

    const strip = (step: ExecutionStep) => {
      const chain = [];
      for (let f: ExecutionStep["frame"] | undefined = step.frame; f; f = f.parent) chain.push(f.id);
      return { ...step, frame: step.frame.id, chain };
    };
    expect(decoded.map(strip)).toEqual(steps.map(strip));
    expect(decoded.find(solutionOf)).toMatchObject({ solution: { bindings: { X: "Abe" } } });

    // Each frame crosses the wire once, and steps on the same frame share one object
    const sent = wire.flatMap((event) => (event.type === "step" ? event.frames.map((f) => f.id) : []));
    expect(new Set(sent).size).toBe(sent.length);
    const [first, second] = decoded.filter((s) => s.frame.id === "R1");
    expect(first.frame).toBe(second.frame);
  });

  it("rejects a step whose frame was never sent", () => {
    const event: TraceEvent = { type: "step", step: { type: "cutoff", goal: "g", reason: "r", frameId: "R9" }, frames: [], stats };
    expect(() => new TraceDecoder().decode(event)).toThrow(/R9/);
  });

  it("passes other events through", () => {
    const event: TraceEvent = { type: "start", program: "p", query: "q" };
    expect(new TraceDecoder().decode(event)).toBe(event);
  });
});
