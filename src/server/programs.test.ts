import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listPrograms, readProgram } from "./programs.ts";

describe("listPrograms and readProgram", () => {
  it("list .nl files by name and read them", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "programs-"));
    await writeFile(path.join(dir, "b-two.nl"), "B is here.\n# Try: X is here?");
    await writeFile(path.join(dir, "a_one.nl"), "A fact.");
    await writeFile(path.join(dir, "notes.txt"), "not a program");
    await writeFile(path.join(dir, "has space.nl"), "skipped");

    expect(await listPrograms(dir)).toEqual(["a_one", "b-two"]);
    expect(await readProgram(dir, "b-two")).toEqual({ name: "b-two", program: "B is here.\n# Try: X is here?", query: "X is here?" });
    expect(await readProgram(dir, "missing")).toBeNull();
    expect(await readProgram(dir, "../b-two")).toBeNull();
  });

  it("treat a missing folder as empty", async () => {
    expect(await listPrograms(path.join(tmpdir(), "no-such-folder-for-programs"))).toEqual([]);
  });
});

describe("the programs folder", () => {
  it("has programs that parse cleanly and have queries", async () => {
    const dir = path.join(import.meta.dirname, "..", "..", "programs");
    const names = await listPrograms(dir);
    expect(names.length).toBeGreaterThan(0);
    const { parseProgram } = await import("../shared/engine/program.ts");
    for (const name of names) {
      const file = (await readProgram(dir, name))!;
      expect(file.query, name).not.toBe("");
      expect(parseProgram(file.program).issues, name).toEqual([]);
    }
  });
});
