// The front end of the notebook's proof widget (notebooks/proofWidget.ts), built into one script by
// `pnpm build:widget`. It renders into a shadow root, so Tailwind's reset and the notebook's styles
// stay out of each other's way.
import { createRoot } from "react-dom/client";
import css from "../index.css?inline";
import { ProofWidget, type WidgetModel } from "./ProofWidget";

// Styles for the notebook page itself, outside the shadow root. Tailwind declares some of its
// variables with @property, which only takes effect in the document's own stylesheets, so without
// those its borders and rings vanish. The output cell's own background goes transparent, as in the
// refinery widget, so the widget's dark panel doesn't sit in a lighter box: VS Code's cell first,
// then JupyterLab's.
const PAGE_CSS = `
.cell-output-ipywidget-background {
  background-color: transparent !important;
  padding-left: 0 !important;
  padding-right: 0 !important;
}
.jp-OutputArea-output {
  background-color: transparent !important;
}
`;

function addPageStyles() {
  const id = "nl-proof-widget-page-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = [...(css.match(/@property[^{]+\{[^}]*\}/g) ?? []), PAGE_CSS].join("\n");
  document.head.appendChild(style);
}

/** anywidget's render: draws the widget in `el`, and returns a function that removes it */
export function render({ model, el }: { model: WidgetModel; el: HTMLElement }) {
  addPageStyles();
  const host = el.appendChild(document.createElement("div"));
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = css;
  const container = document.createElement("div");
  shadow.append(style, container);
  const root = createRoot(container);
  root.render(<ProofWidget model={model} />);
  return () => {
    root.unmount();
    host.remove();
  };
}
