// The app: the program and the proof side by side, over the timeline of the latest run.
import { useEffect } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { actions } from "@/store";
import { ProgramPane } from "./ProgramPane";
import { ProofPane } from "./ProofPane";
import { TimelinePane } from "./TimelinePane";

export default function NLInterpreter() {
  useEffect(() => {
    actions.init();
  }, []);

  return (
    <div className="flex flex-col h-full bg-stone-900 font-mono p-4 text-amber-400">
      <PanelGroup direction="vertical">
        <Panel defaultSize={70} minSize={40}>
          <PanelGroup direction="horizontal">
            <Panel defaultSize={58} minSize={30}>
              <ProgramPane />
            </Panel>
            <PanelResizeHandle className="w-2" />
            <Panel defaultSize={42} minSize={20}>
              <ProofPane />
            </Panel>
          </PanelGroup>
        </Panel>
        <PanelResizeHandle className="h-2" />
        <Panel defaultSize={30} minSize={15}>
          <TimelinePane />
        </Panel>
      </PanelGroup>
    </div>
  );
}
