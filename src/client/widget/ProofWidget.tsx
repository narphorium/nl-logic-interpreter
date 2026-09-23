// The notebook's proof widget: the proof pane for a run's trace, with a timeline of its steps and
// buttons to page through them. The trace arrives as anywidget state, in the events the server
// streams to the browser, and grows while the run goes on. Like the app, it follows the newest step
// until the user moves off it.
import type React from "react";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { ProofView } from "@/components/ProofPane";
import { RunState, StepButtons, StepCount, StepTimeline } from "@/components/TimelinePane";
import { applyEvent, currentIndex, IDLE, moveCursor } from "@/store";
import { TraceDecoder, type TraceEvent } from "@shared/engine/trace";

/** The part of anywidget's front-end model the widget uses */
export type WidgetModel = {
  get(name: "events"): TraceEvent[];
  on(name: "change:events", callback: () => void): void;
  off(name: "change:events", callback: () => void): void;
};

export function ProofWidget({ model }: { model: WidgetModel }) {
  const events = useSyncExternalStore(
    useCallback(
      (onChange: () => void) => {
        model.on("change:events", onChange);
        return () => model.off("change:events", onChange);
      },
      [model],
    ),
    () => model.get("events"),
  );

  // The kernel sends the whole trace each time, so rebuild it from the start
  const run = useMemo(() => {
    const decoder = new TraceDecoder();
    return events.map((event) => decoder.decode(event)).reduce(applyEvent, IDLE);
  }, [events]);

  const [cursor, setCursor] = useState<number | null>(null);
  const view = { ...run, cursor };
  const { steps, status, error } = view;
  const current = currentIndex(view);
  const goToStep = (index: number) => setCursor(moveCursor(view, index).cursor);

  // The step count, the timeline, and the buttons to page through it
  const footer = (
    <div className="flex items-center justify-between gap-2 min-h-13 p-2 border-t border-amber-400/40">
      <div className="flex shrink-0 items-center">
        {steps.length === 0 ? (
          <span className={status === "error" ? "text-red-400" : "text-amber-200"}>
            {status === "error" ? `Error: ${error}` : status === "running" ? "Running…" : "No steps."}
          </span>
        ) : (
          <StepCount current={current} count={steps.length} truncated={view.truncated} />
        )}
        <RunState status={status} truncated={view.truncated} />
        {status === "error" && steps.length > 0 && <span className="ml-2 text-red-400">Error: {error}</span>}
      </div>
      {/* The timeline keeps room under its steps for the scrollbar. The same room above centers the
          steps on the heading and buttons, and the negative margin keeps the footer from growing. */}
      <div className="flex-1 min-w-0 -my-2 pt-2">
        <StepTimeline steps={steps} current={current} onGoToStep={goToStep} />
      </div>
      <StepButtons className="shrink-0" current={current} count={steps.length} onGoToStep={goToStep} />
    </div>
  );

  // Arrow keys step through the proof while the widget has focus. The notebook keeps its own keys.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const delta = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (!delta) return;
    e.preventDefault();
    e.stopPropagation();
    goToStep(current + delta);
  };

  return (
    <div className="h-120 mt-4 bg-stone-900 font-mono text-base text-amber-400 outline-none" tabIndex={0} onKeyDown={onKeyDown}>
      <ProofView steps={steps} current={current} status={status} query={view.query} onGoToStep={goToStep} footer={footer} />
    </div>
  );
}
