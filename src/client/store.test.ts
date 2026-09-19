import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutionStep } from "@shared/engine/NLEngine";
import type { RunEvent, TraceStats } from "@shared/engine/trace";
import type { ProgramDetails } from "@shared/protocol";
import * as api from "./api";
import { actions, applyEvent, currentIndex, IDLE, moveCursor, useInterpreter, type RunView } from "./store";

vi.mock("./api", () => ({
  listPrograms: vi.fn(),
  loadProgram: vi.fn(),
  startRun: vi.fn(),
  stopRun: vi.fn(),
  watchRun: vi.fn(),
}));

const stats: TraceStats = { calls: 1, cached: 0, inputTokens: 10, outputTokens: 2, elapsedMs: 5 };
const frame = { id: "R1", goals: [], substitution: {}, depth: 0 };
const cutoff = (goal: string): ExecutionStep => ({ type: "cutoff", goal, frame, reason: "Too deep." });
const trace = (...goals: string[]): RunEvent[] => [
  { type: "start", program: "p", query: "q" },
  ...goals.map((goal): RunEvent => ({ type: "step", step: cutoff(goal), stats })),
];
const viewOf = (events: RunEvent[]) => events.reduce(applyEvent, IDLE);

describe("applyEvent", () => {
  it("builds a run's view from its trace", () => {
    const query = { question: "q", alternatives: [], kind: "yes-no" as const };
    const view = viewOf([
      ...trace("a", "b"),
      { type: "query", parsed: query },
      { type: "end", status: "done", stats, truncated: true },
    ]);
    expect(view).toMatchObject({ status: "done", query, stats, truncated: true, cursor: null });
    expect(view.steps.map((s) => s.goal)).toEqual(["a", "b"]);
  });

  it("starts over when a run starts", () => {
    const view: RunView = { ...viewOf(trace("a")), cursor: 0, edits: { 0: "mine" } };
    expect(applyEvent(view, { type: "start", program: "p", query: "q" })).toEqual({ ...IDLE, status: "running" });
  });
});

describe("moveCursor", () => {
  const view = viewOf(trace("a", "b", "c"));

  it("follows the newest step until moved off it", () => {
    expect(currentIndex(view)).toBe(2);
    const back = moveCursor(view, 1);
    expect(currentIndex(applyEvent(back, { type: "step", step: cutoff("d"), stats }))).toBe(1);
    expect(moveCursor(back, 2).cursor).toBeNull();
  });

  it("stays put when asked to go past either end", () => {
    expect(moveCursor(view, -1)).toBe(view);
    expect(moveCursor(view, 3)).toBe(view);
    expect(currentIndex(IDLE)).toBe(-1);
  });
});

describe("actions", () => {
  const file = (name: string, run: ProgramDetails["run"] = null): ProgramDetails => ({ name, program: `${name} program`, query: `${name}?`, run });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(api.stopRun).mockResolvedValue({ run: null });
    useInterpreter.setState({ programs: [], selected: null, program: "", query: "", view: IDLE });
  });

  it("open a program and follow its latest run", async () => {
    const run = { program: "edited", query: "edited?", status: "running" as const, solutions: 0 };
    vi.mocked(api.loadProgram).mockResolvedValue(file("family", run));
    vi.mocked(api.watchRun).mockImplementation(async (_name, onEvents) => onEvents(trace("a")));
    await actions.open("family");
    const state = useInterpreter.getState();
    expect(state).toMatchObject({ selected: "family", program: "edited", query: "edited?" });
    expect(state.view.steps).toHaveLength(1);
  });

  it("drop a program that finishes loading after another was opened", async () => {
    let finishSlow!: (file: ProgramDetails) => void;
    vi.mocked(api.loadProgram)
      .mockReturnValueOnce(new Promise((resolve) => (finishSlow = resolve)))
      .mockResolvedValueOnce(file("birds"));
    const slow = actions.open("family");
    expect(useInterpreter.getState().selected).toBeNull();
    await actions.open("birds");
    finishSlow(file("family"));
    await slow;
    expect(useInterpreter.getState()).toMatchObject({ selected: "birds", program: "birds program" });
  });

  it("stop a running run and clear its trace when the program is edited", () => {
    useInterpreter.setState({ selected: "family", view: viewOf(trace("a")) });
    actions.editProgram("new program");
    expect(api.stopRun).toHaveBeenCalledWith("family");
    expect(useInterpreter.getState()).toMatchObject({ program: "new program", view: IDLE });
  });

  it("ignore a trace once the run it follows has been replaced", async () => {
    let deliver!: (events: RunEvent[]) => void;
    vi.mocked(api.startRun).mockResolvedValue({ run: null });
    vi.mocked(api.watchRun).mockImplementation(async (_name, onEvents) => {
      deliver = onEvents;
    });
    useInterpreter.setState({ selected: "family", query: "q" });
    await actions.run();
    actions.editProgram("new program");
    deliver(trace("a"));
    expect(useInterpreter.getState().view).toBe(IDLE);
  });
});
