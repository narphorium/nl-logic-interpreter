// A Jupyter widget that pages through a run's proof, drawn by the app's proof pane. Its front end is
// src/client/widget, built by `pnpm build:widget`. This side sends it the run's trace as it happens,
// in the events the server streams to the browser (src/shared/engine/trace.ts).
import { widget, type Model } from "jsr:@anywidget/deno@0.2.3";
import type { ExecutionStep, RunStats } from "../src/shared/engine/NLEngine.ts";
import type { Query } from "../src/shared/engine/program.ts";
import { TraceEncoder, type RunStatus, type TraceEvent, type TraceStats } from "../src/shared/engine/trace.ts";

const BUNDLE = new URL("../dist/widget/proof-widget.js", import.meta.url);

// How often to send the trace while the run goes on: each send carries all of it
const SEND_INTERVAL_MS = 200;

// The global the bundle declares
declare const NLProofWidget: { render(context: { model: unknown; el: unknown }): () => void };

async function readBundle(): Promise<string> {
  try {
    return await Deno.readTextFile(BUNDLE);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) throw new Error("The proof widget isn't built: run `pnpm build:widget`.");
    throw error;
  }
}

/** A run's trace on its way to the widget. Display it, then report each step and the run's end. */
export class ProofWidget {
  #model: Model<{ events: TraceEvent[] }>;
  #events: TraceEvent[] = [];
  #encoder = new TraceEncoder();
  #started = performance.now();
  #timer: number | undefined;

  private constructor(model: Model<{ events: TraceEvent[] }>) {
    this.#model = model;
  }

  /** A widget for a run of `program`, asking `question`, which was read as `query` */
  static async create(program: string, question: string, query: Query): Promise<ProofWidget> {
    const model = widget({
      state: { events: [] as TraceEvent[] },
      imports: await readBundle(),
      render: ({ model, el }) => NLProofWidget.render({ model, el }),
    });
    const proof = new ProofWidget(model);
    proof.#emit({ type: "start", program, query: question });
    proof.#emit({ type: "query", parsed: query });
    proof.#send();
    return proof;
  }

  /** Adds a step, with the engine's stats so far */
  step(step: ExecutionStep, stats: RunStats) {
    this.#emit({ type: "step", ...this.#encoder.encode(step), stats: this.#stats(stats) });
    this.#timer ??= setTimeout(() => this.#send(), SEND_INTERVAL_MS);
  }

  /** Ends the run, sending the rest of its trace */
  end(status: Exclude<RunStatus, "running">, { stats, truncated, error }: { stats: RunStats; truncated: boolean; error?: unknown }) {
    const message = error === undefined ? undefined : error instanceof Error ? error.message : String(error);
    this.#emit({ type: "end", status, error: message, stats: this.#stats(stats), truncated });
    this.#send();
  }

  [Symbol.for("Jupyter.display")]() {
    // @ts-expect-error: the model's display function is on the proxy anywidget wraps it in
    return this.#model[Symbol.for("Jupyter.display")]();
  }

  #emit(event: TraceEvent) {
    this.#events.push(event);
  }

  #stats(stats: RunStats): TraceStats {
    return { ...stats, elapsedMs: performance.now() - this.#started };
  }

  #send() {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#model.set("events", [...this.#events]);
  }
}
