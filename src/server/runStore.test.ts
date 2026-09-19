import { describe, expect, it } from "vitest";
import type { TraceEvent } from "../shared/engine/trace.ts";
import type { JevUnification, Unifier } from "../shared/engine/unify.ts";
import type { Translator } from "./questionTranslator.ts";
import { createRunStore } from "./runStore.ts";

const noMatch: JevUnification = {
  unified: false,
  bindings: {},
  method: "jev",
  confidence: 0,
  checks: [],
  calls: 1,
  cached: false,
  usage: { input_tokens: 5, output_tokens: 1 },
};

// A unifier that never matches differently worded sentences, and can be held until released
function heldUnifier() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const unifier: Unifier = async () => {
    await gate;
    return noMatch;
  };
  return { unifier, release: () => release() };
}

const PROGRAM = "Abe is the father of Homer.\nHomer is Bart's dad.";
const QUERY = "Abe is the father of X?";

// A listener that records events, and a promise for the run's end
const collect = () => {
  const events: TraceEvent[] = [];
  let resolveEnd!: (event: TraceEvent) => void;
  const ended = new Promise<TraceEvent>((resolve) => (resolveEnd = resolve));
  const listener = (event: TraceEvent) => {
    events.push(event);
    if (event.type === "end") resolveEnd(event);
  };
  return { events, ended, listener };
};

describe("createRunStore", () => {
  it("streams a run live, then replays it whole once it's done", async () => {
    const { unifier, release } = heldUnifier();
    const store = createRunStore(unifier);
    store.start("family", PROGRAM, QUERY);
    expect(store.summary("family")).toMatchObject({ status: "running", program: PROGRAM, query: QUERY });

    const live = collect();
    store.watch("family", live.listener);
    expect(live.events).toMatchObject([{ type: "start", query: QUERY }]);
    release();
    expect(await live.ended).toMatchObject({ type: "end", status: "done", stats: { calls: 1 } });
    expect(live.events[1]).toMatchObject({ type: "query", parsed: { kind: "wh" } });
    expect(store.summary("family")).toMatchObject({ status: "done", solutions: 1 });

    const replay = collect();
    store.watch("family", replay.listener);
    expect(replay.events).toEqual(live.events);
    // A match that completes the solution, then a clause that doesn't match
    expect(replay.events.filter((e) => e.type === "step")).toHaveLength(2);
  });

  it("keeps a stopped run's trace", async () => {
    const { unifier } = heldUnifier();
    const store = createRunStore(unifier);
    store.start("family", PROGRAM, QUERY);
    const watcher = collect();
    store.watch("family", watcher.listener);
    store.stop("family");
    expect(await watcher.ended).toMatchObject({ status: "stopped" });
    expect(store.summary("family")).toMatchObject({ status: "stopped" });
  });

  it("ends the old run's watchers when a program is run again", async () => {
    const { unifier, release } = heldUnifier();
    const store = createRunStore(unifier);
    store.start("family", PROGRAM, QUERY);
    const old = collect();
    store.watch("family", old.listener);
    store.start("family", PROGRAM, "Homer is the father of X?");
    expect(await old.ended).toMatchObject({ status: "stopped" });
    release();
    const current = collect();
    store.watch("family", current.listener);
    expect(current.events[0]).toMatchObject({ type: "start", query: "Homer is the father of X?" });
  });

  it("keeps programs' runs separate", async () => {
    const { unifier, release } = heldUnifier();
    const store = createRunStore(unifier);
    store.start("a", PROGRAM, QUERY);
    store.start("b", PROGRAM, QUERY);
    const a = collect();
    store.watch("a", a.listener);
    store.stop("a");
    expect(await a.ended).toMatchObject({ status: "stopped" });
    release();
    const b = collect();
    store.watch("b", b.listener);
    expect(await b.ended).toMatchObject({ status: "done" });
    expect(store.summary("never-run")).toBeNull();
    expect(store.watch("never-run", () => {})).toBeNull();
  });

  it("reports errors, like an empty query", async () => {
    const store = createRunStore(heldUnifier().unifier);
    store.start("family", PROGRAM, "");
    const watcher = collect();
    store.watch("family", watcher.listener);
    expect(await watcher.ended).toMatchObject({ status: "error", error: "The query is empty." });
  });

  it("translates plain-English questions, and counts the translation in the stats", async () => {
    const { unifier, release } = heldUnifier();
    const translate: Translator = async (_program, question) => ({
      question,
      alternatives: [[{ sentence: "Abe is the father of X", negated: false }]],
      kind: "wh",
      translation: { calls: 1, cached: false, usage: { input_tokens: 1, output_tokens: 1 } },
    });
    const store = createRunStore(unifier, translate);
    store.start("family", PROGRAM, "Who is Abe the father of?");
    const watcher = collect();
    store.watch("family", watcher.listener);
    release();
    // One call to translate the question, and one to unify with the differently worded fact
    expect(await watcher.ended).toMatchObject({ status: "done", stats: { calls: 2 } });
    expect(watcher.events[1]).toMatchObject({ type: "query", parsed: { kind: "wh", translation: { calls: 1 } } });
    expect(store.summary("family")).toMatchObject({ query: "Who is Abe the father of?", solutions: 1 });
  });

  it("reports a translator that fails", async () => {
    const store = createRunStore(heldUnifier().unifier, async () => {
      throw new Error("No translator.");
    });
    store.start("family", PROGRAM, "Who is Abe?");
    const watcher = collect();
    store.watch("family", watcher.listener);
    expect(await watcher.ended).toMatchObject({ status: "error", error: "No translator." });
  });

  it("without a translator, refuses plain-English questions", async () => {
    const store = createRunStore(heldUnifier().unifier);
    store.start("family", PROGRAM, "Who is Abe the father of?");
    const watcher = collect();
    store.watch("family", watcher.listener);
    expect(await watcher.ended).toMatchObject({ status: "error", error: expect.stringContaining("CLAUDE_API_KEY") });
  });
});
