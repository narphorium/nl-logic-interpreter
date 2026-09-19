import { afterEach, describe, expect, it, vi } from "vitest";
import { createTranslator, ollamaCompleter, readQuery, toQuery, type Complete, type Output } from "./questionTranslator.ts";

const usage = { input_tokens: 100, output_tokens: 20 };
const output = (partial: Partial<Output>): Output => ({ kind: "wh", alternatives: [], ...partial });
const goal = (sentence: string, negated = false) => ({ sentence, negated });

// A completer that answers with each output in turn
function completer(...outputs: unknown[]) {
  let calls = 0;
  return vi.fn<Complete>(async () => ({ output: outputs[calls++], stopReason: "end_turn", usage }));
}

describe("toQuery", () => {
  it("turns Claude's output into a query, with what translating it cost", () => {
    const translated = output({ alternatives: [[goal("X is a grandfather of Bart.")]] });
    expect(toQuery("Who is Bart's grandfather?", translated, usage)).toEqual({
      question: "Who is Bart's grandfather?",
      alternatives: [[goal("X is a grandfather of Bart")]],
      kind: "wh",
      translation: { calls: 1, cached: false, usage },
    });
  });

  it("keeps alternatives and negation", () => {
    const translated = output({
      kind: "yes-no",
      alternatives: [[goal("Homer is the father of X")], [goal("Homer is a grandfather of X", true)]],
    });
    expect(toQuery("Is Homer a father or not a grandfather?", translated, usage)).toMatchObject({
      kind: "yes-no",
      alternatives: [[goal("Homer is the father of X")], [goal("Homer is a grandfather of X", true)]],
    });
  });

  it("rejects a translation that names someone the question doesn't", () => {
    const answered = output({ alternatives: [[goal("Abe is a grandfather of Bart")]] });
    expect(() => toQuery("Who is Bart's grandfather?", answered, usage)).toThrow(/mentions Abe/);
  });

  it("allows the question's names in any case, and common sentence starters", () => {
    const translated = output({ alternatives: [[goal("The grandfather of Bart is X")]] });
    expect(() => toQuery("who is bart's grandfather?", translated, usage)).not.toThrow();
  });

  it("rejects empty translations", () => {
    expect(() => toQuery("Why?", output({ alternatives: [[goal(" ")]] }), usage)).toThrow(/goals/);
    expect(() => toQuery("Why?", output({ alternatives: [] }), usage)).toThrow(/goals/);
  });
});

describe("createTranslator", () => {
  it("asks once per program and question, then answers from memory", async () => {
    const complete = completer(output({ alternatives: [[goal("X is a grandfather of Bart")]] }));
    const translate = createTranslator(complete);
    const first = await translate("Abe is Homer's father.", "Who is Bart's grandfather?");
    const second = await translate("Abe is Homer's father.\n", " Who is Bart's grandfather? ");
    expect(first.translation).toEqual({ calls: 1, cached: false, usage });
    expect(second.translation).toEqual({ calls: 0, cached: true, usage: { input_tokens: 0, output_tokens: 0 } });
    expect(second.alternatives).toEqual(first.alternatives);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][1]).toBe("Program:\nAbe is Homer's father.\n\nQuestion: Who is Bart's grandfather?");
  });

  it("forgets failed translations so they can be retried", async () => {
    const complete = completer(null, output({ kind: "yes-no", alternatives: [[goal("Homer is old")]] }));
    const translate = createTranslator(complete);
    await expect(translate("p", "Is Homer old?")).rejects.toThrow(/shape/);
    await expect(translate("p", "Is Homer old?")).resolves.toMatchObject({ kind: "yes-no" });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("reports refusals", async () => {
    const complete: Complete = async () => ({ output: null, stopReason: "refusal", usage });
    await expect(createTranslator(complete)("p", "Is Homer old?")).rejects.toThrow(/declined/);
  });
});

describe("ollamaCompleter", () => {
  afterEach(() => vi.unstubAllGlobals());

  // Stubs fetch with one response from Ollama's chat API
  function ollama(status: number, body: unknown) {
    const fetch = vi.fn(async (_url: URL, _init: RequestInit) => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  it("asks Ollama's chat API for output in the translation's schema, without thinking", async () => {
    const translation = output({ alternatives: [[goal("X is a grandfather of Bart")]] });
    const fetch = ollama(200, {
      message: { role: "assistant", content: JSON.stringify(translation) },
      done_reason: "stop",
      prompt_eval_count: 100,
      eval_count: 20,
    });
    const completion = await ollamaCompleter("http://gpu-box:11434", "gemma")("system", "prompt");
    expect(completion).toEqual({ output: translation, usage, stopReason: "stop" });

    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe("http://gpu-box:11434/api/chat");
    const request = JSON.parse(String(init.body));
    expect(request).toMatchObject({
      model: "gemma",
      stream: false,
      think: false,
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "prompt" },
      ],
    });
    expect(request.format.properties).toHaveProperty("alternatives");
  });

  it("reports a reply cut short as running too long", async () => {
    ollama(200, { message: { content: '{"kind": "wh", "alter' }, done_reason: "length" });
    const translate = createTranslator(ollamaCompleter("http://localhost:11434", "gemma"));
    await expect(translate("p", "Who is old?")).rejects.toThrow(/too long/);
  });

  it("passes on Ollama's errors, and says when it can't be reached", async () => {
    ollama(404, { error: "model 'gemma' not found" });
    const complete = ollamaCompleter("http://localhost:11434/", "gemma");
    await expect(complete("s", "p")).rejects.toThrow("Ollama: model 'gemma' not found");

    vi.stubGlobal("fetch", async () => Promise.reject(new TypeError("fetch failed")));
    await expect(complete("s", "p")).rejects.toThrow("Couldn't reach Ollama at http://localhost:11434/. Is it running?");
  });
});

describe("readQuery", () => {
  const translated = { alternatives: [[goal("Homer is the father of X")]], kind: "yes-no" as const };

  it("reads goals with variables itself, and asks the translator about everything else", async () => {
    const translate = vi.fn(async (_program: string, question: string) => ({ question, ...translated }));
    expect(await readQuery("p", "X is a grandfather of Y?", translate)).toMatchObject({
      kind: "wh",
      alternatives: [[goal("X is a grandfather of Y")]],
    });
    expect(translate).not.toHaveBeenCalled();
    expect(await readQuery("p", "Is Homer a father?", translate)).toMatchObject({ kind: "yes-no" });
    expect(await readQuery("p", "Homer is a parent of Lisa?", translate)).toMatchObject(translated);
    expect(translate).toHaveBeenCalledTimes(2);
  });

  it("without a translator, reads statements as goals and refuses questions", async () => {
    expect(await readQuery("p", "Homer is a parent of Lisa?", null)).toMatchObject({
      alternatives: [[goal("Homer is a parent of Lisa")]],
    });
    await expect(readQuery("p", "Is Homer a parent of Lisa?", null)).rejects.toThrow(/CLAUDE_API_KEY/);
    await expect(readQuery("p", " ", null)).rejects.toThrow("The query is empty.");
  });
});
