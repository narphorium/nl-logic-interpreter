// The timeline pane: a block for each step of the run, the current step's description, which the user
// can rewrite, and buttons to step through the trace. The step count, run status, blocks, and
// buttons are exported for the notebook widget, which pages through a proof with them.
import { ArrowLeft, ArrowRight, LoaderCircle, SquarePlay } from "lucide-react";
import { useEffect, useRef } from "react";
import { describeStep, formatDuration, plural } from "@/describe";
import { cn } from "cn";
import { actions, currentIndex, useInterpreter } from "@/store";
import { solutionOf, type ExecutionStep } from "@shared/engine/NLEngine";
import type { RunStatus } from "@shared/engine/trace";
import { IconButton, NumberBadge } from "./controls";

// The colors of a kind of step: its block in the timeline, and its description. Solutions are green,
// other steps that make progress pale yellow like the editor's text, and dead ends gray. Gray steps'
// descriptions are a lighter gray than their blocks so the text stays readable.
const SOLUTION = { fill: "bg-green-400", text: "text-green-300" };
const PROGRESS = { fill: "bg-[#fae283]", text: "text-[#fae283]" };
const NO_PROGRESS = { fill: "bg-stone-600", text: "text-stone-400" };

function stepColors(step: ExecutionStep) {
  if (solutionOf(step)) return SOLUTION;
  return step.type === "success" || (step.type === "negation" && step.holds) ? PROGRESS : NO_PROGRESS;
}

export function TimelinePane() {
  const view = useInterpreter((s) => s.view);
  const hasQuery = useInterpreter((s) => s.query.trim() !== "");
  const { steps, status, stats, error } = view;
  const current = currentIndex(view);
  const step: ExecutionStep | undefined = steps[current];

  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  const defaultDescription = step
    ? describeStep(step)
    : status === "error"
      ? `Error: ${error}`
      : status === "running"
        ? view.query
          ? "Running…"
          : "Reading the question…"
        : hasQuery
          ? "Press Enter, or click the play button, to answer the question."
          : "Write facts and rules in plain English, then ask a question.";
  const description = view.edits[current] ?? defaultDescription;

  // Size the description to its text. Measuring from "auto" (one row) rather than "inherit", which
  // would make it at least as tall as the panel.
  useEffect(() => {
    const textarea = descriptionRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [description]);

  // Arrow keys step through the timeline when no text field has focus
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowLeft") actions.stepBy(-1);
      if (e.key === "ArrowRight") actions.stepBy(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    // The step buttons float over the bottom right corner, outside the scrolling content
    <div className="relative border border-amber-400 rounded-lg h-full overflow-hidden">
      <div className="h-full flex flex-col overflow-auto">
        <div className="flex flex-wrap items-center justify-between gap-2 min-h-11 p-2">
          <div className="flex items-center">
            <SquarePlay size={16} className="mr-2" />
            {steps.length === 0 ? <h2>TIMELINE</h2> : <StepCount current={current} count={steps.length} truncated={view.truncated} />}
            <RunState status={status} truncated={view.truncated} />
          </div>
          {stats && (
            <div className="text-xs text-stone-500">
              {stats.calls} API {plural(stats.calls, "call")} · {(stats.inputTokens + stats.outputTokens).toLocaleString()} tokens ·{" "}
              {formatDuration(stats.elapsedMs)}
            </div>
          )}
        </div>
        <StepTimeline steps={steps} current={current} onGoToStep={actions.goToStep} />

        {/* The description and error run to the panel's bottom but stay clear of the step buttons:
            they take 80px of the right edge, and pr-24 pads 96px */}
        <textarea
          ref={descriptionRef}
          className={cn(
            "w-full shrink-0 p-2 pr-24 resize-none overflow-hidden bg-transparent italic font-mono text-[15px] leading-[1.6] border-none outline-none min-h-[1.6em]",
            step ? stepColors(step).text : status === "error" ? "text-red-400" : "text-amber-200",
          )}
          value={description}
          onChange={(e) => {
            const text = e.target.value;
            actions.editDescription(current, text === defaultDescription || !text.trim() ? null : text);
          }}
          placeholder="Step description..."
          rows={1}
          disabled={!step}
        />
        {error && step && <div className="pl-2 pr-24 pb-2 text-sm text-red-400">Error: {error}</div>}
      </div>

      <StepButtons className="absolute bottom-0 right-0 p-2" current={current} count={steps.length} onGoToStep={actions.goToStep} />
    </div>
  );
}

/** A block for each step, scrolling sideways when they don't fit, with the current one kept in view */
export function StepTimeline({ steps, current, onGoToStep }: { steps: ExecutionStep[]; current: number; onGoToStep: (index: number) => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const stepsRef = useRef<HTMLDivElement>(null);

  // Scroll the timeline to keep the current step in view. Only the timeline scrolls: scrollIntoView
  // would scroll the page too, pulling a notebook to the widget with every step.
  useEffect(() => {
    const box = boxRef.current;
    const block = stepsRef.current?.children[current] as HTMLElement | undefined;
    if (!box || !block) return;
    const padding = 4; // scroll-px-1
    const left = block.offsetLeft - padding;
    const right = block.offsetLeft + block.offsetWidth + padding;
    if (left < box.scrollLeft) box.scrollLeft = left;
    else if (right > box.scrollLeft + box.clientWidth) box.scrollLeft = right - box.clientWidth;
  }, [current, steps.length]);

  return (
    // The scrolling box is padded so the outline around a hovered or current step isn't cut off,
    // with extra room at the bottom for the scrollbar
    <div className="p-1">
      <div
        ref={boxRef}
        className="relative overflow-x-auto p-1 pb-3 scroll-px-1 [scrollbar-width:thin] [scrollbar-color:var(--color-stone-600)_transparent]"
      >
        {/* Steps are 6px wide plus a 2px gap, scrolling sideways when they don't fit. The hatching
            runs unbroken under the steps ahead and any room left after them, while steps up to the
            current one sit on the plain background so the gaps between them stay clear. Steps up to
            the current one are filled with their color, and the current one is outlined in gold. */}
        <div ref={stepsRef} className="h-5 w-max min-w-full flex hatched">
          {steps.map((s, index) => (
            <div
              key={index}
              className={cn("group h-full w-2 shrink-0 pr-0.5 cursor-pointer", index <= current && "bg-background")}
              title={`${index + 1}: ${solutionOf(s) ? "solution" : s.type}`}
              onClick={() => onGoToStep(index)}
            >
              <div
                className={cn(
                  "relative h-full rounded-[2px] group-hover:z-20 group-hover:outline-2 group-hover:outline-offset-1 group-hover:outline-amber-200",
                  index <= current && stepColors(s).fill,
                  index === current && "outline-2 outline-offset-1 outline-amber-400 z-10",
                )}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** "STEP 3 OF 12", with a "+" on the count when the run stopped at its step limit */
export function StepCount({ current, count, truncated }: { current: number; count: number; truncated: boolean }) {
  return (
    <h2 className="flex items-center">
      STEP
      <NumberBadge className="mx-2 border-amber-400 text-amber-400">{current + 1}</NumberBadge>
      OF
      <NumberBadge className="ml-2 border-amber-400 text-amber-400">
        {count}
        {truncated ? "+" : ""}
      </NumberBadge>
    </h2>
  );
}

/** A spinner while the run goes on, or a note when it stopped early */
export function RunState({ status, truncated }: { status: RunStatus | "idle"; truncated: boolean }) {
  if (status === "running") return <LoaderCircle size={16} className="ml-2 animate-spin" aria-label="Running" />;
  if (status === "stopped") return <span className="ml-2 text-stone-500">stopped</span>;
  if (status === "done" && truncated) return <span className="ml-2 text-stone-500">step limit reached</span>;
  return null;
}

/** Buttons to the previous and next steps */
export function StepButtons({
  className,
  current,
  count,
  onGoToStep,
}: {
  className?: string;
  current: number;
  count: number;
  onGoToStep: (index: number) => void;
}) {
  return (
    <div className={cn("flex space-x-2", className)}>
      <IconButton onClick={() => onGoToStep(current - 1)} disabled={current <= 0} aria-label="Previous step" title="Previous step">
        <ArrowLeft className="size-4.5" />
      </IconButton>
      <IconButton onClick={() => onGoToStep(current + 1)} disabled={current >= count - 1} aria-label="Next step" title="Next step">
        <ArrowRight className="size-4.5" />
      </IconButton>
    </div>
  );
}
