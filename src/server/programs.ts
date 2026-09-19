// Reads the example programs in programs/*.nl. A program file holds facts and rules, plus questions to
// try in comments starting with "Try:". The first one is loaded into the query box.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseProgramFile, PROGRAM_EXTENSION } from "../shared/engine/program.ts";
import type { ProgramFile } from "../shared/protocol.ts";

const NAME = /^[\w-]+$/;

/** Program names (file names without the extension), sorted */
export async function listPrograms(dir: string): Promise<string[]> {
  const files = await readdir(dir).catch(() => []);
  return files
    .filter((file) => file.endsWith(PROGRAM_EXTENSION))
    .map((file) => file.slice(0, -PROGRAM_EXTENSION.length))
    .filter((name) => NAME.test(name))
    .sort();
}

/** The named program, or null if there's no such file */
export async function readProgram(dir: string, name: string): Promise<ProgramFile | null> {
  if (!NAME.test(name)) return null;
  const text = await readFile(path.join(dir, `${name}${PROGRAM_EXTENSION}`), "utf8").catch(() => null);
  return text === null ? null : { name, ...parseProgramFile(text) };
}
