// A combobox for loading one of the program files, showing how each one's latest run went.
import { ChevronsUpDown, FileText, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { plural } from "@/describe";
import { PROGRAM_EXTENSION } from "@shared/engine/program";
import type { ProgramInfo, RunSummary } from "@shared/protocol";

type Props = {
  programs: ProgramInfo[];
  value: string | null;
  onSelect: (name: string) => void;
  /** Called when the list opens, so run summaries can be refreshed */
  onOpen?: () => void;
};

export function ProgramPicker({ programs, value, onSelect, onOpen }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) onOpen?.();
      }}
    >
      <PopoverTrigger asChild>
        <button
          role="combobox"
          aria-expanded={open}
          aria-label="Program file"
          className="flex items-center h-7 min-w-0 -ml-1.5 px-1.5 rounded-md uppercase hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-muted-foreground data-[state=open]:bg-muted"
        >
          <FileText size={16} className="mr-2 shrink-0" />
          <span className="truncate">{value ? `${value}${PROGRAM_EXTENSION}` : "Choose a program…"}</span>
          <ChevronsUpDown size={14} className="ml-1.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 p-0 font-mono uppercase bg-muted ring-0 shadow-lg shadow-black/60"
      >
        <Command className="bg-transparent">
          <CommandInput placeholder="Search programs…" className="uppercase placeholder:text-stone-500" />
          <CommandList>
            <CommandEmpty className="text-stone-500">No programs found.</CommandEmpty>
            <CommandGroup>
              {programs.map((program) => (
                <CommandItem
                  key={program.name}
                  value={program.name}
                  data-checked={program.name === value}
                  onSelect={() => {
                    onSelect(program.name);
                    setOpen(false);
                  }}
                  className="text-amber-200 data-selected:bg-amber-400 data-selected:text-stone-900 data-selected:*:[svg]:text-stone-900"
                >
                  <span className="flex-1 truncate">{program.name}{PROGRAM_EXTENSION}</span>
                  <RunBadge run={program.run} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function RunBadge({ run }: { run: RunSummary | null }) {
  if (!run) return null;
  const className = "flex items-center gap-1 text-xs text-stone-500 group-data-selected/command-item:text-stone-700";
  if (run.status === "running") {
    return (
      <span className={className}>
        <LoaderCircle className="size-3! animate-spin" />
        running
      </span>
    );
  }
  const label =
    run.status === "error" ? "error" : `${run.solutions} ${plural(run.solutions, "solution")}`;
  return <span className={className}>{run.status === "stopped" ? `stopped · ${label}` : label}</span>;
}
