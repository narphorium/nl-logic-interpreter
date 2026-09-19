import { describe, expect, it } from "vitest";
import {
  isRule,
  looksLikeQuestion,
  parseLiteral,
  parseProgram,
  parseProgramFile,
  parseQuery,
  parseRule,
  showLiteral,
  splitDisjuncts,
} from "./program.ts";

const goal = (sentence: string, negated = false) => ({ sentence, negated });

describe("isRule", () => {
  it("treats lines containing if, then, or when as rules", () => {
    expect(isRule("If X is a bird then X can fly.")).toBe(true);
    expect(isRule("X is happy when X is fed.")).toBe(true);
    expect(isRule("X is wet, then.")).toBe(true);
    expect(isRule("Abe is the father of Homer.")).toBe(false);
  });

  it("matches whole words only", () => {
    expect(isRule("Whenever the iffy thing happens.")).toBe(false);
  });
});

describe("parseRule", () => {
  it.each([
    ["If X is a bird then X can fly.", "X can fly", ["X is a bird"]],
    ["If X is a bird, then X can fly.", "X can fly", ["X is a bird"]],
    ["If X is a bird, X can fly.", "X can fly", ["X is a bird"]],
    ["When X is hungry, X eats.", "X eats", ["X is hungry"]],
    ["X can fly if X is a bird.", "X can fly", ["X is a bird"]],
    ["X eats when X is hungry.", "X eats", ["X is hungry"]],
    ["X is a bird then X can fly.", "X can fly", ["X is a bird"]],
  ])("parses %s", (sentence, head, body) => {
    expect(parseRule(sentence)).toEqual({ head, bodies: [body.map((s) => goal(s))] });
  });

  it("splits conditions on and, commas, and semicolons", () => {
    expect(parseRule("X is a grandfather of Y if X is the father of Z and Z is a parent of Y.")).toEqual({
      head: "X is a grandfather of Y",
      bodies: [[goal("X is the father of Z"), goal("Z is a parent of Y")]],
    });
    expect(parseRule("If X is a bird, X is small, and X is loud, then X is a songbird.")).toEqual({
      head: "X is a songbird",
      bodies: [[goal("X is a bird"), goal("X is small"), goal("X is loud")]],
    });
  });

  it("splits alternatives on or, with and binding tighter", () => {
    expect(parseRule("X is a parent of Y if X is the father of Y or X is the mother of Y.")).toEqual({
      head: "X is a parent of Y",
      bodies: [[goal("X is the father of Y")], [goal("X is the mother of Y")]],
    });
    expect(parseRule("If X is a bird and X is small, or X is a bat, then X is tiny.")).toEqual({
      head: "X is tiny",
      bodies: [[goal("X is a bird"), goal("X is small")], [goal("X is a bat")]],
    });
  });

  it("takes a condition's leading not as negation", () => {
    expect(parseRule("X is a bachelor if X is a man and not X is married.")).toEqual({
      head: "X is a bachelor",
      bodies: [[goal("X is a man"), goal("X is married", true)]],
    });
  });

  it("reports rules it can't split, and conclusions with or or not", () => {
    expect(parseRule("If X is a bird")).toHaveProperty("error");
    expect(parseRule("X can fly if")).toHaveProperty("error");
    expect(parseRule("If X is a bird then Y if Z")).toHaveProperty("error");
    expect(parseRule("X is a bird or a bat if X flies")).toHaveProperty("error");
    expect(parseRule("Not X is a fish if X flies")).toHaveProperty("error");
  });
});

describe("parseProgram", () => {
  it("separates facts from rules and skips blank lines and comments", () => {
    const { clauses, issues } = parseProgram(
      ["# Family", "Abe is Homer's father.", "", "If X is the father of Y then X is a parent of Y.", "If X"].join("\n"),
    );
    expect(clauses.map((c) => [c.type, c.line, c.head])).toEqual([
      ["fact", 1, "Abe is Homer's father"],
      ["rule", 3, "X is a parent of Y"],
    ]);
    expect(issues).toEqual([{ line: 4, message: expect.any(String) }]);
  });

  it("makes one clause per alternative of a rule with or", () => {
    const { clauses } = parseProgram("X is a parent of Y if X is the father of Y or X is the mother of Y.");
    expect(clauses.map((c) => [c.line, c.head, c.body])).toEqual([
      [0, "X is a parent of Y", [goal("X is the father of Y")]],
      [0, "X is a parent of Y", [goal("X is the mother of Y")]],
    ]);
  });

  it("leaves negative wording inside a fact alone", () => {
    expect(parseProgram("Carol can't stand Bob.").clauses[0]).toMatchObject({ type: "fact", head: "Carol can't stand Bob" });
  });
});

describe("literals", () => {
  it("read a leading not and write it back", () => {
    expect(parseLiteral("It is not the case that X flies.")).toEqual(goal("X flies", true));
    expect(parseLiteral("X is not a fish")).toEqual(goal("X is not a fish"));
    expect(showLiteral(goal("X flies", true))).toBe("not X flies");
    expect(showLiteral(goal("X flies"))).toBe("X flies");
  });

  it("split alternatives on or", () => {
    expect(splitDisjuncts("Either X is a bird, or X is a bat?")).toEqual(["X is a bird", "X is a bat"]);
    expect(splitDisjuncts("X is a doctor")).toEqual(["X is a doctor"]);
  });
});

describe("parseQuery", () => {
  it("drops the question mark and splits conjunctions", () => {
    expect(parseQuery("X is a parent of Y and Y is a parent of Bart?")).toEqual({
      question: "X is a parent of Y and Y is a parent of Bart?",
      alternatives: [[goal("X is a parent of Y"), goal("Y is a parent of Bart")]],
      kind: "wh",
    });
  });

  it("reads or as alternatives and a leading not as negation", () => {
    expect(parseQuery("Homer is a parent of Lisa or not Homer is a parent of Bart")).toMatchObject({
      alternatives: [[goal("Homer is a parent of Lisa")], [goal("Homer is a parent of Bart", true)]],
      kind: "yes-no",
    });
  });

  it("has no alternatives when empty", () => {
    expect(parseQuery(" ").alternatives).toEqual([]);
  });
});

describe("looksLikeQuestion", () => {
  it("recognizes question words and inverted verbs", () => {
    expect(looksLikeQuestion("Who is Bart's grandfather?")).toBe(true);
    expect(looksLikeQuestion("Is Homer a parent of Lisa?")).toBe(true);
    expect(looksLikeQuestion("Homer is a parent of Lisa?")).toBe(false);
    expect(looksLikeQuestion("X is a grandfather of Y?")).toBe(false);
  });
});

describe("parseProgramFile", () => {
  it("takes the query from the first Try comment and keeps the whole file as the program", () => {
    const file = "# Family\r\nAbe is Homer's father.\n#Try:\n# Try: Who is Homer's father? \n// try: X is Y's father?\n\n";
    expect(parseProgramFile(file)).toEqual({
      program: "# Family\nAbe is Homer's father.\n#Try:\n# Try: Who is Homer's father? \n// try: X is Y's father?",
      query: "Who is Homer's father?",
    });
  });

  it("allows programs without a query", () => {
    expect(parseProgramFile("Abe is old.")).toEqual({ program: "Abe is old.", query: "" });
  });
});
