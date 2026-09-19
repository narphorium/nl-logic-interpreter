import { describe, expect, it } from "vitest";
import {
  candidatePhrases,
  extend,
  freshen,
  isVariable,
  matchWording,
  normalize,
  substitute,
  variablesIn,
  words,
} from "./nl.ts";

describe("variables", () => {
  it("are single capital letters, optionally numbered", () => {
    expect(["X", "Y", "Z1", "X₂"].every(isVariable)).toBe(true);
    expect(["A", "I", "Abe", "x", "XY"].some(isVariable)).toBe(false);
  });

  it("are found in order, including before a possessive", () => {
    expect(variablesIn("A Y is X's parent, and X₂ likes Y")).toEqual(["Y", "X", "X₂"]);
  });

  it("are substituted through chains of bindings", () => {
    expect(substitute("X is the father of Y", { X: "Z", Z: "Abe", Y: "Homer" })).toBe("Abe is the father of Homer");
    expect(substitute("X's dad", { X: "Lisa" })).toBe("Lisa's dad");
  });

  it("are freshened consistently across a clause", () => {
    let n = 0;
    const renames = new Map<string, string>();
    const next = () => ++n;
    expect(freshen("X is the father of Y", renames, next)).toBe("X₁ is the father of Y₂");
    expect(freshen("Y likes X", renames, next)).toBe("Y₂ likes X₁");
  });
});

describe("words and normalize", () => {
  it("split possessives off their word and drop punctuation", () => {
    expect(words("Homer's father, Abe.").map((t) => t.text)).toEqual(["Homer", "'s", "father", "Abe"]);
    expect(normalize("Abe is  HOMER's father.")).toBe(normalize("abe is Homer’s father"));
  });
});

describe("matchWording", () => {
  it("binds variables word for word when both sides have them", () => {
    expect(matchWording("X is a grandfather of Bart", "X₁ is a grandfather of Y₁")).toEqual({
      unified: true,
      bindings: { X: "X₁", "Y₁": "Bart" },
    });
  });

  it("lets a variable span several words when the other side is ground", () => {
    expect(matchWording("X is the father of Y", "Abe Simpson is the father of Homer Jay Simpson")).toEqual({
      unified: true,
      bindings: { X: "Abe Simpson", Y: "Homer Jay Simpson" },
    });
  });

  it("fails when the same wording needs conflicting bindings", () => {
    expect(matchWording("X is the father of X", "Abe is the father of Homer")).toEqual({ unified: false, bindings: {} });
  });

  it("leaves different wording to Jev", () => {
    expect(matchWording("X is the father of Y", "Abe is Homer's father")).toBeNull();
    expect(matchWording("Abe is the father of Bart", "Homer is the father of Bart")).toBeNull();
    expect(matchWording("X is Bart's grandfather", "Y is a grandfather of Z")).toBeNull();
  });
});

describe("extend", () => {
  it("merges bindings and rejects conflicts", () => {
    expect(extend({ X: "Abe" }, { Y: "Homer" })).toEqual({ X: "Abe", Y: "Homer" });
    expect(extend({ X: "Abe" }, { X: "abe" })).toEqual({ X: "Abe" });
    expect(extend({ X: "Abe" }, { X: "Homer" })).toBeNull();
    expect(extend({}, { X: "Y", Y: "X" })).toEqual({ X: "Y" });
  });
});

describe("candidatePhrases", () => {
  it("offers every run of words", () => {
    expect(candidatePhrases("Tweety can fly")).toEqual(["Tweety", "Tweety can", "Tweety can fly", "can", "can fly", "fly"]);
  });

  it("offers names and clauses whatever words they're made of", () => {
    expect(candidatePhrases("Will Smith's mom is May")).toEqual(expect.arrayContaining(["Will Smith", "May"]));
    expect(candidatePhrases("James Bond's nemesis is Dr. No")).toContain("Dr. No");
    expect(candidatePhrases("Marge thinks Homer is happy")).toContain("Homer is happy");
    expect(candidatePhrases("The Old Man and the Sea was written by Ernest Hemingway")).toContain("The Old Man and the Sea");
  });

  it("offers a variable only on its own", () => {
    expect(candidatePhrases("X₁ is a grandfather of Y₁")).toEqual([
      "X₁",
      "is",
      "is a",
      "is a grandfather",
      "is a grandfather of",
      "a",
      "a grandfather",
      "a grandfather of",
      "grandfather",
      "grandfather of",
      "of",
      "Y₁",
    ]);
  });
});
