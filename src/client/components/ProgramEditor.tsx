// The program editor: CodeMirror, with rule keywords and variables highlighted, comments dimmed, parse
// issues underlined, and the clause being traced highlighted along with its line number.
import { linter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { RangeSet, RangeSetBuilder, StateEffect, StateField, type EditorState, type Text } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, gutterLineClass, type DecorationSet } from "@codemirror/view";
import CodeMirror, { type BasicSetupOptions } from "@uiw/react-codemirror";
import { useEffect, useState } from "react";
import { findVariables } from "@shared/engine/nl";
import { isComment, isRule, KEYWORD, type ParseIssue } from "@shared/engine/program";

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** Zero-based line to highlight, or null */
  tracedLine: number | null;
  /** Problems parsing `value`, to underline */
  issues: ParseIssue[];
};

export function ProgramEditor({ value, onChange, tracedLine, issues }: Props) {
  const [view, setView] = useState<EditorView | null>(null);

  useEffect(() => {
    if (!view) return;
    view.dispatch({ effects: setTracedLine.of(tracedLine) });
    const start = tracedLineStart(view.state);
    if (start !== null) view.dispatch({ effects: EditorView.scrollIntoView(start, { y: "nearest" }) });
  }, [view, tracedLine]);

  useEffect(() => {
    if (view) view.dispatch(setDiagnostics(view.state, diagnostics(view.state.doc, issues)));
  }, [view, issues]);

  // Everything but `value` stays the same between renders: CodeMirror reconfigures when they change
  return (
    <CodeMirror
      className="h-full"
      height="100%"
      value={value}
      onChange={onChange}
      onCreateEditor={(created) => setView(created)}
      theme={THEME}
      basicSetup={BASIC_SETUP}
      extensions={EXTENSIONS}
    />
  );
}

// Highlighting: a rule's keywords, every variable outside comments, and comments as a whole

const KEYWORD_MARK = Decoration.mark({ class: "text-orange-400" });
const VARIABLE_MARK = Decoration.mark({ class: "text-amber-100" });
const COMMENT_LINE = Decoration.line({ class: "text-stone-500" });

function highlight(doc: Text): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (let n = 1; n <= doc.lines; n++) {
    const { from, text } = doc.line(n);
    if (isComment(text)) {
      builder.add(from, from, COMMENT_LINE);
      continue;
    }
    const keywords = isRule(text)
      ? [...text.matchAll(KEYWORD)].map((m) => ({ start: m.index!, end: m.index! + m[0].length, mark: KEYWORD_MARK }))
      : [];
    const variables = findVariables(text).map(({ start, end }) => ({ start, end, mark: VARIABLE_MARK }));
    for (const { start, end, mark } of [...keywords, ...variables].sort((a, b) => a.start - b.start)) {
      builder.add(from + start, from + end, mark);
    }
  }
  return builder.finish();
}

// The traced line, set by the component through an effect

const setTracedLine = StateEffect.define<number | null>();

const tracedLineField = StateField.define<number | null>({
  create: () => null,
  update(line, transaction) {
    for (const effect of transaction.effects) if (effect.is(setTracedLine)) line = effect.value;
    return line;
  },
});

// Where the traced line starts, if it's in the document
function tracedLineStart(state: EditorState): number | null {
  const line = state.field(tracedLineField);
  return line !== null && line < state.doc.lines ? state.doc.line(line + 1).from : null;
}

const TRACED_LINE = Decoration.line({ class: "bg-amber-400/15" });

class TracedLineNumber extends GutterMarker {
  elementClass = "bg-amber-400/15 text-amber-400";
}
const TRACED_LINE_NUMBER = new TracedLineNumber();

const tracedLine = [
  tracedLineField,
  EditorView.decorations.compute([tracedLineField, "doc"], (state) => {
    const start = tracedLineStart(state);
    return start === null ? Decoration.none : Decoration.set([TRACED_LINE.range(start)]);
  }),
  gutterLineClass.compute([tracedLineField, "doc"], (state) => {
    const start = tracedLineStart(state);
    return start === null ? RangeSet.empty : RangeSet.of([TRACED_LINE_NUMBER.range(start)]);
  }),
];

// Parse issues, each underlining its whole line
function diagnostics(doc: Text, issues: ParseIssue[]): Diagnostic[] {
  return issues
    .filter((issue) => issue.line < doc.lines)
    .map((issue) => {
      const { from, to } = doc.line(issue.line + 1);
      return { from, to, severity: "error", message: issue.message };
    });
}

const EXTENSIONS = [
  EditorView.lineWrapping,
  EditorView.contentAttributes.of({ "aria-label": "Program" }),
  EditorView.decorations.compute(["doc"], (state) => highlight(state.doc)),
  tracedLine,
  // Shows the diagnostics the component sets, without linting on its own
  linter(null),
];

// CodeMirror's defaults, less the ones meant for code
const BASIC_SETUP: BasicSetupOptions = {
  foldGutter: false,
  highlightActiveLine: false,
  highlightActiveLineGutter: false,
  highlightSelectionMatches: false,
  bracketMatching: false,
  closeBrackets: false,
  autocompletion: false,
  indentOnInput: false,
};

// The app's stone and amber palette. Colors for particular text are Tailwind classes, above.
const THEME = EditorView.theme(
  {
    "&": { height: "100%", backgroundColor: "transparent", color: "#fae283", fontSize: "15px" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.6" },
    ".cm-line": { padding: "0 0.5rem" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-amber-400)" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "color-mix(in oklab, var(--color-amber-400) 15%, transparent)",
    },
    ".cm-gutters": { backgroundColor: "transparent", color: "var(--color-stone-600)", border: "none" },
    ".cm-lineNumbers .cm-gutterElement": { minWidth: "2.5rem", padding: "0 0.5rem 0 0" },
    ".cm-tooltip": { backgroundColor: "var(--muted)", color: "var(--popover-foreground)", border: "1px solid var(--input)" },
    ".cm-diagnostic-error": { borderLeftColor: "var(--destructive)" },
  },
  { dark: true },
);
