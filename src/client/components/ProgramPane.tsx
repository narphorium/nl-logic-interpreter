// The program pane: the program file menu, the editor and any problems parsing it, and the query box.
import { Play, Square, Terminal, TriangleAlert } from "lucide-react";
import { useMemo } from "react";
import { plural } from "@/describe";
import { actions, useCurrentStep, useInterpreter } from "@/store";
import { parseProgram } from "@shared/engine/program";
import { ProgramEditor } from "./ProgramEditor";
import { ProgramPicker } from "./ProgramPicker";
import { IconButton } from "./controls";

export function ProgramPane() {
  const programs = useInterpreter((s) => s.programs);
  const selected = useInterpreter((s) => s.selected);
  const program = useInterpreter((s) => s.program);
  const query = useInterpreter((s) => s.query);
  const running = useInterpreter((s) => s.view.status === "running");
  const step = useCurrentStep();

  const parsed = useMemo(() => parseProgram(program), [program]);
  const facts = parsed.clauses.filter((c) => c.type === "fact").length;
  const rules = parsed.clauses.length - facts;
  // Highlight the clause the current step is trying
  const tracedLine = step && "clause" in step ? step.clause.line : null;

  return (
    <div className="flex flex-col border border-amber-400 rounded-lg overflow-hidden h-full">
      <div className="flex items-center justify-between gap-3 min-h-11 p-2">
        <ProgramPicker programs={programs} value={selected} onSelect={actions.open} onOpen={actions.refreshPrograms} />
        <div className="text-xs text-stone-500">
          {facts} {plural(facts, "fact")} · {rules} {plural(rules, "rule")}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {/* A new editor for each program file, so undo can't reach back into the one before */}
        <ProgramEditor key={selected} value={program} onChange={actions.editProgram} tracedLine={tracedLine} issues={parsed.issues} />
      </div>
      {parsed.issues.length > 0 && (
        <div className="border-t border-amber-400 p-2 text-sm text-red-400 space-y-1">
          {parsed.issues.map((issue) => (
            <div key={issue.line} className="flex items-start">
              <TriangleAlert size={14} className="mr-2 mt-0.5 shrink-0" />
              Line {issue.line + 1}: {issue.message}
            </div>
          ))}
        </div>
      )}
      <div className="border-t border-amber-400 flex items-center">
        <Terminal size={16} className="ml-2 shrink-0" aria-hidden />
        <input
          className="flex-1 min-w-0 p-2 font-mono text-[15px] text-[#fae283] caret-amber-400 bg-transparent placeholder:text-stone-500 focus:outline-none"
          value={query}
          onChange={(e) => actions.setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !running && query.trim()) actions.run();
          }}
          placeholder="Who is Bart's grandfather?"
          aria-label="Query"
        />
        {running ? (
          <IconButton className="m-2" onClick={actions.stop} aria-label="Stop" title="Stop">
            <Square className="size-3.5" fill="currentColor" />
          </IconButton>
        ) : (
          <IconButton className="m-2" onClick={actions.run} disabled={!query.trim()} aria-label="Run" title="Run">
            <Play className="size-4.5" />
          </IconButton>
        )}
      </div>
    </div>
  );
}
