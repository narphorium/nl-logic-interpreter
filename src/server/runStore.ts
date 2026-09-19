// Runs programs on the server and keeps each program's latest run in memory: its trace, results, and
// status. Browsers stream a run's trace from the start, then follow it live until it ends, so a run
// keeps going when the browser switches to another program and its trace is there when it comes back.
import { NLEngine, solutionOf } from "../shared/engine/NLEngine.ts";
import { TraceEncoder, type RunStatus, type TraceEvent, type TraceStats } from "../shared/engine/trace.ts";
import type { Unifier } from "../shared/engine/unify.ts";
import type { RunSummary } from "../shared/protocol.ts";
import { readQuery, type Translator } from "./questionTranslator.ts";

type Listener = (event: TraceEvent) => void;

type Run = RunSummary & { events: TraceEvent[]; listeners: Set<Listener>; controller: AbortController };

/** Runs programs with `unifier`, and translates plain-English questions with `translate` if given one */
export function createRunStore(unifier: Unifier, translate: Translator | null = null) {
  const runs = new Map<string, Run>();

  /** Starts running `program` for `name`, replacing its previous run */
  function start(name: string, program: string, query: string) {
    runs.get(name)?.controller.abort();
    const run: Run = {
      program,
      query,
      status: "running",
      solutions: 0,
      events: [],
      listeners: new Set(),
      controller: new AbortController(),
    };
    runs.set(name, run);

    const emit = (event: TraceEvent) => {
      run.events.push(event);
      for (const listener of run.listeners) listener(event);
    };
    emit({ type: "start", program, query });

    const engine = new NLEngine(program, unifier);
    const started = performance.now();
    const stats = (): TraceStats => ({ ...engine.stats, elapsedMs: performance.now() - started });
    const encoder = new TraceEncoder();
    const { signal } = run.controller;
    const end = (status: Exclude<RunStatus, "running">, error?: string) => {
      run.status = status;
      emit({ type: "end", status, error, stats: stats(), truncated: engine.truncated });
      run.listeners.clear();
    };
    const execute = async () => {
      const parsed = await readQuery(program, query, translate, signal);
      signal.throwIfAborted();
      emit({ type: "query", parsed });
      await engine.run(parsed, {
        signal,
        onStep: (step) => {
          if (solutionOf(step)) run.solutions++;
          emit({ type: "step", ...encoder.encode(step), stats: stats() });
        },
      });
    };
    execute().then(
      () => end("done"),
      (error: unknown) => (signal.aborted ? end("stopped") : end("error", error instanceof Error ? error.message : String(error))),
    );
  }

  /**
   * Sends every event of `name`'s run so far to `listener`, then each new one until the run ends.
   * Returns a function that stops listening, or null if `name` hasn't been run.
   */
  function watch(name: string, listener: Listener): (() => void) | null {
    const run = runs.get(name);
    if (!run) return null;
    for (const event of run.events) listener(event);
    if (run.status === "running") run.listeners.add(listener);
    return () => run.listeners.delete(listener);
  }

  const summary = (name: string): RunSummary | null => {
    const run = runs.get(name);
    return run ? { program: run.program, query: run.query, status: run.status, solutions: run.solutions } : null;
  };

  return {
    start,
    watch,
    summary,
    stop: (name: string) => runs.get(name)?.controller.abort(),
  };
}
