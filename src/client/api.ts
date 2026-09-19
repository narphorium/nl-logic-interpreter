// The browser side of the server's API (see server/apiPlugin.ts and src/protocol.ts).
import { TraceDecoder, type RunEvent, type TraceEvent } from "@shared/engine/trace";
import type { ProgramDetails, ProgramList, RunRequest, RunResponse } from "@shared/protocol";

// The error the server sent back, or one naming the HTTP status
async function failure(response: Response): Promise<Error> {
  const body = await response.json().catch(() => ({}));
  return new Error(body.error ?? `Request failed (HTTP ${response.status}).`);
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw await failure(response);
  return response.json() as Promise<T>;
}

const programUrl = (name: string) => `/api/programs/${encodeURIComponent(name)}`;

export const listPrograms = () => request<ProgramList>("/api/programs").then((body) => body.programs);

export const loadProgram = (name: string) => request<ProgramDetails>(programUrl(name));

export const startRun = (name: string, run: RunRequest) =>
  request<RunResponse>(`${programUrl(name)}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(run),
  });

export const stopRun = (name: string) => request<RunResponse>(`${programUrl(name)}/stop`, { method: "POST" });

/**
 * Streams the trace of `name`'s latest run: every event so far, then each new one until the run
 * ends. Events that arrive together are handed over together. Resolves when the stream closes.
 */
export async function watchRun(name: string, onEvents: (events: RunEvent[]) => void, signal: AbortSignal): Promise<void> {
  const response = await fetch(`${programUrl(name)}/run`, { signal });
  if (!response.ok || !response.body) throw await failure(response);

  const decoder = new TraceDecoder();
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const lines = (buffer + value).split("\n");
    buffer = lines.pop()!;
    const events = lines.filter((line) => line.trim()).map((line) => decoder.decode(JSON.parse(line) as TraceEvent));
    if (events.length > 0) onEvents(events);
  }
}
