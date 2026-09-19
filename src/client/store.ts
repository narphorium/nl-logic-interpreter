// The app's state: the program on screen, and the view of its latest run. A run view is built from
// the run's trace events by `applyEvent`, and `actions` hold the async work of loading programs and
// following runs. Each reset of the view starts a new generation, so work that finishes after the
// user has moved on is dropped.
import { create } from "zustand";
import type { ExecutionStep } from "@shared/engine/NLEngine";
import type { Query } from "@shared/engine/program";
import type { RunEvent, RunStatus, TraceStats } from "@shared/engine/trace";
import type { ProgramInfo } from "@shared/protocol";
import { listPrograms, loadProgram, startRun, stopRun, watchRun } from "./api";

const DEFAULT_PROGRAM = "family";

/** A run's trace as the browser has received it so far, and where the user is in it */
export type RunView = {
  status: RunStatus | "idle";
  error: string | null;
  /** How the run read the query, once it has: translating a question takes an AI call */
  query: Query | null;
  steps: ExecutionStep[];
  stats: TraceStats | null;
  truncated: boolean;
  /** The step on screen, or null to follow the newest one */
  cursor: number | null;
  /** Step descriptions the user has rewritten, by step index */
  edits: Record<number, string>;
};

export const IDLE: RunView = { status: "idle", error: null, query: null, steps: [], stats: null, truncated: false, cursor: null, edits: {} };

export function applyEvent(view: RunView, event: RunEvent): RunView {
  switch (event.type) {
    case "start":
      return { ...IDLE, status: "running" };
    case "query":
      return { ...view, query: event.parsed };
    case "step":
      return { ...view, steps: [...view.steps, event.step], stats: event.stats };
    case "end":
      return { ...view, status: event.status, error: event.error ?? null, stats: event.stats, truncated: event.truncated };
  }
}

/** The index of the step on screen, or -1 before the first step */
export const currentIndex = (view: RunView) => view.cursor ?? view.steps.length - 1;

/** Moves to step `index`, following new steps again once it's the newest */
export function moveCursor(view: RunView, index: number): RunView {
  if (index < 0 || index >= view.steps.length) return view;
  return { ...view, cursor: index === view.steps.length - 1 ? null : index };
}

type State = {
  programs: ProgramInfo[];
  /** The program file on screen */
  selected: string | null;
  program: string;
  query: string;
  view: RunView;
};

export const useInterpreter = create<State>()(() => ({ programs: [], selected: null, program: "", query: "", view: IDLE }));

/** The step on screen, if there is one */
export const useCurrentStep = () => useInterpreter((s): ExecutionStep | undefined => s.view.steps[currentIndex(s.view)]);

const { getState: get, setState: set } = useInterpreter;
const updateView = (update: (view: RunView) => RunView) => set((s) => ({ view: update(s.view) }));

let generation = 0;
let watcher: AbortController | null = null;

// Stops showing the current trace, leaving its run alone, and returns the new generation
function reset(view = IDLE): number {
  watcher?.abort();
  watcher = null;
  set({ view });
  return ++generation;
}

function fail(current: number, error: unknown) {
  if (current !== generation) return;
  updateView((view) => ({ ...view, status: "error", error: error instanceof Error ? error.message : String(error) }));
}

const showError = (error: unknown) => fail(generation, error);

// Shows the trace of `name`'s latest run, following along while it runs
async function follow(name: string, current: number) {
  watcher = new AbortController();
  try {
    await watchRun(
      name,
      (events) => {
        if (current === generation) updateView((view) => events.reduce(applyEvent, view));
      },
      watcher.signal,
    );
  } catch (error) {
    fail(current, error);
  }
}

export const actions = {
  /** Lists the programs and opens the default one */
  async init() {
    try {
      const programs = await listPrograms();
      set({ programs });
      const initial = programs.find((p) => p.name === DEFAULT_PROGRAM) ?? programs[0];
      if (initial) await actions.open(initial.name);
    } catch (error) {
      showError(error);
    }
  },

  refreshPrograms() {
    listPrograms().then((programs) => set({ programs }), showError);
  },

  /** Loads a program file, or its latest run's program and trace if it has one */
  async open(name: string) {
    const current = reset();
    try {
      const file = await loadProgram(name);
      if (current !== generation) return;
      set({ selected: name, program: file.run?.program ?? file.program, query: file.run?.query ?? file.query });
      if (file.run) follow(name, current);
    } catch (error) {
      fail(current, error);
    }
  },

  async run() {
    const { selected, program, query } = get();
    if (!selected) return;
    const current = reset({ ...IDLE, status: "running" });
    try {
      await startRun(selected, { program, query });
      if (current === generation) follow(selected, current);
    } catch (error) {
      fail(current, error);
    }
  },

  stop() {
    const { selected } = get();
    if (selected) stopRun(selected).catch(showError);
  },

  /** Edits the program, which makes the trace of the old one meaningless */
  editProgram(program: string) {
    set({ program });
    const { status } = get().view;
    if (status === "idle") return;
    if (status === "running") actions.stop();
    reset();
  },

  setQuery(query: string) {
    set({ query });
  },

  goToStep(index: number) {
    updateView((view) => moveCursor(view, index));
  },

  stepBy(delta: number) {
    updateView((view) => moveCursor(view, currentIndex(view) + delta));
  },

  /** Rewrites step `index`'s description, or restores its default with null */
  editDescription(index: number, text: string | null) {
    updateView((view) => {
      const edits = { ...view.edits };
      if (text === null) delete edits[index];
      else edits[index] = text;
      return { ...view, edits };
    });
  },
};
