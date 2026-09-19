// A run's trace as it travels from the server to the browser: newline-delimited JSON events. Steps
// refer to frames by id, and each frame is sent once, just before the first step that needs it, so a
// long trace doesn't repeat its whole stack in every step.
import type { Substitution } from "./nl.ts";
import type { ExecutionStep, Frame, RunStats } from "./NLEngine.ts";
import type { Literal, Query } from "./program.ts";

export type RunStatus = "running" | "done" | "stopped" | "error";

/** The engine's usage stats, plus how long the run has taken so far */
export type TraceStats = RunStats & { elapsedMs: number };

export type FrameData = { id: string; goals: Literal[]; substitution: Substitution; depth: number; parentId?: string };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type StepData = DistributiveOmit<ExecutionStep, "frame"> & { frameId: string };

export type TraceEvent =
  | { type: "start"; program: string; query: string }
  /** How the query was read, once that's known: it may take an AI call */
  | { type: "query"; parsed: Query }
  | { type: "step"; step: StepData; frames: FrameData[]; stats: TraceStats }
  | { type: "end"; status: Exclude<RunStatus, "running">; error?: string; stats: TraceStats; truncated: boolean };

/** A trace event as the browser handles it, with its step rebuilt */
export type RunEvent = Exclude<TraceEvent, { type: "step" }> | { type: "step"; step: ExecutionStep; stats: TraceStats };

/** Turns steps into step data, collecting the frames the browser hasn't seen yet */
export class TraceEncoder {
  #sent = new Set<string>();

  encode(step: ExecutionStep): { step: StepData; frames: FrameData[] } {
    const frames: FrameData[] = [];
    const send = (frame: Frame) => {
      if (this.#sent.has(frame.id)) return;
      if (frame.parent) send(frame.parent);
      this.#sent.add(frame.id);
      const { parent, ...data } = frame;
      frames.push({ ...data, parentId: parent?.id });
    };
    send(step.frame);
    const { frame, ...rest } = step;
    return { step: { ...rest, frameId: frame.id } as StepData, frames };
  }
}

/** Rebuilds the steps of a trace's events, and the frames they share */
export class TraceDecoder {
  #frames = new Map<string, Frame>();

  decode(event: TraceEvent): RunEvent {
    if (event.type !== "step") return event;
    for (const { parentId, ...data } of event.frames) {
      this.#frames.set(data.id, { ...data, parent: parentId ? this.#frames.get(parentId) : undefined });
    }
    const { frameId, ...rest } = event.step;
    const frame = this.#frames.get(frameId);
    if (!frame) throw new Error(`The trace refers to frame ${frameId} before sending it.`);
    return { type: "step", step: { ...rest, frame } as ExecutionStep, stats: event.stats };
  }
}
