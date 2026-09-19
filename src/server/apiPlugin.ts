// Serves the app's API from the Vite dev and preview servers. Programs run here, not in the browser, so
// the TypeSafe and Claude API keys stay on the server and each program's latest run can be kept in
// memory. The request and response types are in src/protocol.ts.
//
//   GET    /api/programs             program names, with a summary of each one's latest run
//   GET    /api/programs/:name       the program file, and its latest run's program and query
//   POST   /api/programs/:name/run   start a run of { program, query }
//   GET    /api/programs/:name/run   the run's trace as newline-delimited JSON, live until it ends
//   POST   /api/programs/:name/stop  stop the run, keeping its trace
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { loadEnv, type Plugin, type ResolvedConfig } from "vite";
import { z } from "zod";
import type { Unifier } from "../shared/engine/unify.ts";
import type { ErrorResponse, ProgramDetails, ProgramList, RunRequest, RunResponse } from "../shared/protocol.ts";
import { createAIUnifier } from "./aiUnifier.ts";
import { listPrograms, readProgram } from "./programs.ts";
import { claudeCompleter, createTranslator, DEFAULT_MODEL, ollamaCompleter, type Translator } from "./questionTranslator.ts";
import { createRunStore } from "./runStore.ts";

export function apiPlugin(): Plugin {
  return {
    name: "nl-logic-api",
    configureServer(server) {
      server.middlewares.use("/api", createApi(server.config));
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api", createApi(server.config));
    },
  };
}

type Env = Record<string, string>;

const runRequest = z.object({ program: z.string(), query: z.string() }) satisfies z.ZodType<RunRequest>;

// The API's request handler, reading programs from the project's programs folder and its settings
// from .env
function createApi(config: ResolvedConfig) {
  const env = loadEnv(config.mode, config.envDir || config.root, ["TYPESAFE_", "CLAUDE_", "SYSTEM_ONE_", "SYSTEM_TWO_"]);
  const programsDir = path.join(config.root, "programs");
  const runs = createRunStore(jevUnifier(env), questionTranslator(env));

  async function programFile(name: string) {
    const file = await readProgram(programsDir, name);
    if (!file) throw new HttpError(404, `There's no program named "${name}".`);
    return file;
  }

  async function listing(): Promise<ProgramList> {
    const names = await listPrograms(programsDir);
    return { programs: names.map((name) => ({ name, run: runs.summary(name) })) };
  }

  async function details(name: string): Promise<ProgramDetails> {
    return { ...(await programFile(name)), run: runs.summary(name) };
  }

  async function start(name: string, req: IncomingMessage): Promise<RunResponse> {
    await programFile(name);
    const body = runRequest.safeParse(await readJson(req));
    if (!body.success) throw new HttpError(400, "Expected { program, query }.");
    runs.start(name, body.data.program, body.data.query);
    return { run: runs.summary(name) };
  }

  function stop(name: string): RunResponse {
    runs.stop(name);
    return { run: runs.summary(name) };
  }

  function stream(name: string, req: IncomingMessage, res: ServerResponse) {
    if (!runs.summary(name)) throw new HttpError(404, `"${name}" hasn't been run.`);
    res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-cache" });
    const unwatch = runs.watch(name, (event) => {
      res.write(`${JSON.stringify(event)}\n`);
      if (event.type === "end") res.end();
    });
    req.on("close", () => unwatch?.());
  }

  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const [resource, name, action, ...extra] = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      if (resource !== "programs" || extra.length > 0) throw new HttpError(404, "Not found.");
      const route = `${req.method} /programs${name ? "/:name" : ""}${action ? `/${action}` : ""}`;
      switch (route) {
        case "GET /programs":
          return send(res, 200, await listing());
        case "GET /programs/:name":
          return send(res, 200, await details(name));
        case "POST /programs/:name/run":
          return send(res, 202, await start(name, req));
        case "GET /programs/:name/run":
          return stream(name, req, res);
        case "POST /programs/:name/stop":
          return send(res, 200, stop(name));
        default:
          throw new HttpError(405, `${req.method} isn't supported here.`);
      }
    } catch (error) {
      if (!(error instanceof HttpError)) console.error("[api]", error);
      const status = error instanceof HttpError ? error.status : 500;
      send(res, status, { error: error instanceof Error ? error.message : String(error) });
    }
  };
}

// Unifies with Jev, or with a Jev-compatible server at SYSTEM_ONE_MODEL_ENDPOINT, which needs no
// TypeSafe API key. Fails every unification when neither is configured.
function jevUnifier(env: Env): Unifier {
  const endpoint = env.SYSTEM_ONE_MODEL_ENDPOINT || undefined;
  const apiKey = env.TYPESAFE_API_KEY || (endpoint && "local");
  if (!apiKey) {
    return async () => {
      throw new Error("TYPESAFE_API_KEY isn't set. Add it to .env at the project root and restart the server.");
    };
  }
  const client = new TypeSafeClient({
    apiKey,
    baseURL: endpoint,
    defaultModel: env.SYSTEM_ONE_MODEL || undefined,
    timeout: seconds(env, "SYSTEM_ONE_TIMEOUT_SECONDS"),
  });
  return createAIUnifier((request) => client.systemOne(request));
}

// Translates plain-English questions with the Ollama server at SYSTEM_TWO_MODEL_ENDPOINT, otherwise
// with Claude, or null when neither is configured
function questionTranslator(env: Env): Translator | null {
  if (env.SYSTEM_TWO_MODEL_ENDPOINT) {
    if (!env.SYSTEM_TWO_MODEL) {
      return async () => {
        throw new Error("SYSTEM_TWO_MODEL isn't set. Name the Ollama model to use in .env and restart the server.");
      };
    }
    return createTranslator(ollamaCompleter(env.SYSTEM_TWO_MODEL_ENDPOINT, env.SYSTEM_TWO_MODEL));
  }
  if (!env.CLAUDE_API_KEY) return null;
  return createTranslator(claudeCompleter(new Anthropic({ apiKey: env.CLAUDE_API_KEY }), env.SYSTEM_TWO_MODEL || DEFAULT_MODEL));
}

// A setting in seconds, as milliseconds, or undefined when it's unset
function seconds(env: Env, name: string): number | undefined {
  if (!env[name]) return undefined;
  const value = Number(env[name]);
  if (!(value > 0)) throw new Error(`${name} should be a number of seconds, not "${env[name]}".`);
  return value * 1000;
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "The request body isn't JSON.");
  }
}

function send(res: ServerResponse, status: number, body: ProgramList | ProgramDetails | RunResponse | ErrorResponse) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
