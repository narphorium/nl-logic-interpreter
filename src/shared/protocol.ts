// The server's HTTP API (server/apiPlugin.ts), shared with the browser (src/api.ts). A run's trace
// streams as the events in engine/trace.ts.
import type { RunStatus } from "./engine/trace.ts";

/** A program file: its facts and rules, and the query stored with them */
export type ProgramFile = { name: string; program: string; query: string };

/** How a program's latest run went, or is going */
export type RunSummary = { program: string; query: string; status: RunStatus; solutions: number };

export type ProgramInfo = { name: string; run: RunSummary | null };

/** GET /api/programs */
export type ProgramList = { programs: ProgramInfo[] };

/** GET /api/programs/:name: the file, and the program and query its latest run used */
export type ProgramDetails = ProgramFile & { run: RunSummary | null };

/** The body of POST /api/programs/:name/run */
export type RunRequest = { program: string; query: string };

/** POST /api/programs/:name/run and /stop */
export type RunResponse = { run: RunSummary | null };

export type ErrorResponse = { error: string };
