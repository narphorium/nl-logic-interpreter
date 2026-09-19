// The proof pane: the solutions found up to the current step, the goals it works on, Jev's prediction
// for its match, and the frames those goals came from.
import { ListTree, Sparkles } from "lucide-react";
import type React from "react";
import { useMemo } from "react";
import { describeQuery, frameBindings, percent, plural, quote } from "@/describe";
import { cn } from "cn";
import { actions, currentIndex, useInterpreter } from "@/store";
import { solutionOf, type ExecutionStep, type Frame, type Solution } from "@shared/engine/NLEngine";
import { queryVariables, showLiteral } from "@shared/engine/program";
import type { JevUnification } from "@shared/engine/unify";
import { NumberBadge } from "./controls";

export function ProofPane() {
  const steps = useInterpreter((s) => s.view.steps);
  const current = useInterpreter((s) => currentIndex(s.view));
  const status = useInterpreter((s) => s.view.status);
  const query = useInterpreter((s) => s.view.query);
  const step: ExecutionStep | undefined = steps[current];

  const solutions = useMemo(
    () =>
      steps.slice(0, current + 1).flatMap((s, index) => {
        const solution = solutionOf(s);
        return solution ? [{ ...solution, index }] : [];
      }),
    [steps, current],
  );
  const variables = useMemo(() => (query ? queryVariables(query) : []), [query]);

  // The frame whose first goal this step works on, then the frames it came from. A success step's
  // own frame is the new one, where that goal has already been replaced, so start from the one before it.
  const stack = useMemo(() => {
    const frames: Frame[] = [];
    const working = step?.type === "success" ? step.frame.parent : step?.frame;
    for (let frame = working; frame; frame = frame.parent) frames.push(frame);
    return frames;
  }, [step]);
  const [currentFrame, ...earlierFrames] = stack;

  // Jev's prediction for this step's match. A match on wording alone gets no card: it has no checks,
  // and the step's description already says the wording is the same.
  const prediction =
    step && (step.type === "success" || step.type === "failure") && step.unification.method === "jev"
      ? step.unification
      : undefined;

  const verdict = query?.kind === "yes-no";
  // Once the whole trace has been seen without a solution, the answer is no
  const noSolutions = status === "done" && solutions.length === 0 && current >= steps.length - 1;

  return (
    <div className="border border-amber-400 rounded-lg overflow-hidden h-full flex flex-col">
      <div className="flex items-center justify-between gap-3 min-h-11 p-2">
        <div className="flex items-center">
          <ListTree size={16} className="mr-2" />
          <h2>PROOF</h2>
        </div>
        {/* How deep the current goals are, as in the message when a branch goes too deep */}
        {currentFrame && <div className="text-xs text-stone-500">depth {currentFrame.depth}</div>}
      </div>

      <div className="space-y-2 overflow-auto flex-1 p-2 pt-0 text-sm">
        {solutions.length > 0 && <SolutionsCard solutions={solutions} verdict={verdict} current={current} />}

        {noSolutions && query && (
          <div className="p-2 border border-red-400 rounded-sm text-red-400">
            <h3 className="mb-1">{verdict ? "NO" : "NO SOLUTIONS"}</h3>
            <span className="text-red-700">Nothing in the program proves {quote(describeQuery(query))}.</span>
          </div>
        )}

        {currentFrame && currentFrame.goals.length > 0 && <GoalsCard frame={currentFrame} variables={variables} />}

        {prediction && <PredictionCard unification={prediction} />}

        {earlierFrames.map((frame) => (
          <FrameCard key={frame.id} frame={frame} variables={variables} />
        ))}
      </div>
    </div>
  );
}

// A card whose rows reach its edges, like the traced line in the program editor. The last row holds
// the card's bottom padding, so its highlight reaches the bottom edge too.
function Card({ className, title, children }: { className: string; title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={cn("px-2 pt-2 border rounded-sm overflow-hidden", className)}>
      <h3 className="flex items-center mb-1">{title}</h3>
      <div className="-mx-2">{children}</div>
    </div>
  );
}

const ROW = "block w-full px-2 last:pb-2 text-left";

// Each solution found so far, restating the query with its values. Clicking one goes to its step.
function SolutionsCard({ solutions, verdict, current }: { solutions: (Solution & { index: number })[]; verdict: boolean; current: number }) {
  const title = verdict ? (
    "YES"
  ) : (
    <>
      <NumberBadge className="mr-2 min-w-5 h-5 px-1 text-xs border-green-500 text-green-400">{solutions.length}</NumberBadge>
      {plural(solutions.length, "SOLUTION")}
    </>
  );
  return (
    <Card className="border-green-500 text-green-400" title={title}>
      {solutions.map((s) => (
        <button
          key={s.index}
          className={cn(ROW, "text-green-300", s.index === current ? "bg-green-500/20" : "hover:bg-green-500/10")}
          onClick={() => actions.goToStep(s.index)}
        >
          {s.answer}
        </button>
      ))}
    </Card>
  );
}

// The goals left to prove, with the one the current step works on highlighted: always the first
function GoalsCard({ frame, variables }: { frame: Frame; variables: string[] }) {
  const bindings = frameBindings(frame, variables);
  const title = (
    <>
      <NumberBadge className="mr-2 min-w-5 h-5 px-1 text-xs border-amber-400 text-amber-400">{frame.goals.length}</NumberBadge>
      {plural(frame.goals.length, "GOAL")}
    </>
  );
  return (
    <Card className="border-amber-400" title={title}>
      {frame.goals.map((goal, i) => (
        <div key={i} className={cn(ROW, "text-[#fae283]", i === 0 && "bg-amber-400/15")}>
          {showLiteral(goal)}
        </div>
      ))}
      {bindings && <div className={cn(ROW, "text-stone-400")}>θ: {bindings}</div>}
    </Card>
  );
}

function PredictionCard({ unification }: { unification: JevUnification }) {
  return (
    <div className="p-2 border border-stone-600 rounded-sm">
      <div className="flex items-center mb-1 text-amber-200">
        <Sparkles size={14} className="mr-2" />
        {plural(unification.checks.length, "PREDICTION")}
        {unification.cached && <span className="ml-2 text-stone-500">cached</span>}
      </div>
      <div className="space-y-2">
        {unification.checks.map((check, i) => (
          <div key={i} className="flex items-start gap-3">
            {/* The percentage sits over its bar, level with the question's first line */}
            <div className={cn("w-16 shrink-0", check.passed ? "text-amber-400" : "text-stone-400")}>
              <div>{percent(check.probability)}</div>
              <div className="h-1.5 mt-0.5 bg-stone-700">
                <div className={cn("h-full", check.passed ? "bg-amber-400" : "bg-stone-500")} style={{ width: percent(check.probability) }} />
              </div>
            </div>
            <span className={check.passed ? "text-[#fae283]" : "text-stone-400"}>{check.question}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// A frame the current goals came from
function FrameCard({ frame, variables }: { frame: Frame; variables: string[] }) {
  const bindings = frameBindings(frame, variables);
  return (
    <div className="p-2 border border-stone-700 rounded-sm text-stone-500">
      {frame.goals.map((goal, i) => (
        <div key={i}>? {showLiteral(goal)}</div>
      ))}
      {bindings && <div>θ: {bindings}</div>}
    </div>
  );
}
