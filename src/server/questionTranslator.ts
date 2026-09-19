// Translates a plain-English question into a query with Claude, or with a local model through Ollama.
// The model sees the program too, so it can word goals the way the program does, and goals worded like
// a fact or a rule's conclusion match without asking Jev. The model only translates: a goal may not
// name anyone the question doesn't, which stops it from answering the question itself.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { isVariable, words } from "../shared/engine/nl.ts";
import { looksLikeQuestion, parseQuery, queryVariables, stripSentence, type Query } from "../shared/engine/program.ts";
import { cachedCost, type Usage } from "../shared/engine/unify.ts";
import { promiseCache } from "./promiseCache.ts";

export const DEFAULT_MODEL = "claude-haiku-4-5";
const MAX_TOKENS = 1024;

const Output = z.object({
  kind: z.enum(["yes-no", "wh"]),
  alternatives: z.array(z.array(z.object({ sentence: z.string(), negated: z.boolean() }))),
});
export type Output = z.infer<typeof Output>;

export const SYSTEM = `You translate a question about a small logic program into goals for the interpreter that runs the program. You never answer the question; you only restate it as goals for the interpreter to prove.

The program is a list of facts and rules in plain English. The interpreter proves a goal by matching it against the facts and against the conclusions of rules, then proving the rule's conditions. A goal worded exactly like a fact or a rule's conclusion matches without any AI, so word each goal the way the program does whenever the meaning is the same. When the program has no such wording, a plain paraphrase is fine: the interpreter can tell that "Lisa's dad is Homer" and "Homer is the father of Lisa" state the same fact.

Rules for goals:
- A goal is one declarative sentence stating a single fact, with no pronouns. Never phrase a goal as a question.
- Whatever the question asks to identify becomes a variable: a single capital letter such as X, Y, or Z. A and I are ordinary words, not variables. Use the same letter for the same unknown in every goal and different letters for different unknowns.
- Introduce a variable for any participant a fact needs but the question leaves out. "Is Homer a father?" becomes "Homer is the father of X". "Does Abe have grandchildren?" becomes "Abe is a grandfather of X".
- Never name anyone or anything the question doesn't name, even when the program shows the answer. "Who is Bart's grandfather?" becomes "X is a grandfather of Bart", never "Abe is a grandfather of Bart".
- Conditions joined by "and" become several goals in one alternative, all of which must hold. "or" becomes several alternatives; the question holds if any alternative does.
- Mark a goal negated when the question asks for the absence of a fact, as in "but not" or "who isn't". Write the sentence positively; the interpreter proves a negated goal by failing to prove the sentence. But when the program itself states such facts in negative wording, like "Carol can't stand Bob", use that wording as an ordinary positive goal.
- kind is "yes-no" when the question expects yes or no, and "wh" when it asks who, what, or which. A yes-no question can still use variables for participants it leaves out.`;

export const prompt = (program: string, question: string) => `Program:\n${program.trim()}\n\nQuestion: ${question.trim()}`;

export type Completion = { output: unknown; usage: Usage; stopReason: string | null };
/** Asks a model for a translation; `system` is the instructions and `prompt` the program and question */
export type Complete = (system: string, prompt: string, signal?: AbortSignal) => Promise<Completion>;

export type Translator = (program: string, question: string, signal?: AbortSignal) => Promise<Query>;

/** Completes with Claude, which fills in the output schema itself */
export function claudeCompleter(client: Anthropic, model = DEFAULT_MODEL): Complete {
  return async (system, prompt, signal) => {
    const message = await client.messages.parse(
      {
        model,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: "user", content: prompt }],
        output_config: { format: zodOutputFormat(Output) },
      },
      { signal },
    );
    return {
      output: message.parsed_output,
      usage: { input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens },
      stopReason: message.stop_reason,
    };
  };
}

/**
 * Completes with a model served by Ollama. Its Anthropic-compatible API ignores output schemas, so this
 * uses Ollama's own chat API, which constrains the reply to the schema. Thinking is off because some
 * models ignore the schema while thinking.
 */
export function ollamaCompleter(baseURL: string, model: string): Complete {
  const url = new URL("api/chat", baseURL.endsWith("/") ? baseURL : `${baseURL}/`);
  return async (system, prompt, signal) => {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          think: false,
          format: z.toJSONSchema(Output),
          options: { num_predict: MAX_TOKENS },
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
        }),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error(`Couldn't reach Ollama at ${baseURL}. Is it running?`, { cause: error });
    }
    const body = (await res.json().catch(() => ({}))) as OllamaChat;
    if (!res.ok) throw new Error(`Ollama: ${body.error ?? `HTTP ${res.status}`}`);
    return {
      output: parseJson(body.message?.content),
      usage: { input_tokens: body.prompt_eval_count ?? 0, output_tokens: body.eval_count ?? 0 },
      stopReason: body.done_reason === "length" ? "max_tokens" : (body.done_reason ?? null),
    };
  };
}

type OllamaChat = {
  message?: { content?: string };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
};

function parseJson(text: string | undefined): unknown {
  try {
    return text === undefined ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** A translator over `complete` that remembers each program and question it has translated */
export function createTranslator(complete: Complete): Translator {
  const cache = promiseCache<Query>();
  return async (program, question, signal) => {
    const key = JSON.stringify([program.trim(), question.trim()]);
    const { value: query, cached } = await cache(key, () => translate(program, question, complete, signal));
    return cached ? { ...query, translation: cachedCost() } : query;
  };
}

async function translate(program: string, question: string, complete: Complete, signal?: AbortSignal): Promise<Query> {
  const completion = await complete(SYSTEM, prompt(program, question), signal);
  if (completion.stopReason === "refusal") throw new Error("The model declined to translate the question.");
  if (completion.stopReason === "max_tokens") throw new Error("The question's translation ran too long.");
  const parsed = Output.safeParse(completion.output);
  if (!parsed.success) throw new Error("The question's translation didn't have the expected shape.");
  return toQuery(question, parsed.data, completion.usage);
}

/** Checks a translation and turns it into a query */
export function toQuery(question: string, output: Output, usage: Usage): Query {
  const alternatives = output.alternatives
    .map((goals) => goals.map((g) => ({ sentence: stripSentence(g.sentence), negated: g.negated })).filter((g) => g.sentence))
    .filter((goals) => goals.length > 0);
  if (alternatives.length === 0) throw new Error("The model couldn't turn the question into goals.");

  const asked = new Set(words(question).map((t) => t.text.toLowerCase()));
  for (const goal of alternatives.flat()) {
    const leaked = names(goal.sentence).find((name) => !asked.has(name.toLowerCase()));
    if (leaked) {
      throw new Error(
        `The model read the question as "${goal.sentence}", which mentions ${leaked}, and the question doesn't. It should translate the question, not answer it.`,
      );
    }
  }

  return { question: question.trim(), alternatives, kind: output.kind, translation: { calls: 1, cached: false, usage } };
}

// Capitalized words that could be names: not variables, and not common sentence starters
const COMMON = new Set(
  "the a an it there this that these those someone somebody something everyone everybody everything anyone anybody anything no nobody nothing none every all some any each".split(
    " ",
  ),
);
const names = (sentence: string): string[] =>
  words(sentence)
    .map((t) => t.text)
    .filter((w) => /^\p{Lu}/u.test(w) && !isVariable(w) && !COMMON.has(w.toLowerCase()));

/**
 * Reads a query: as goals when it uses variables, otherwise by translating it. Without a translator,
 * a plain-English question is an error, and anything else is read as goals.
 */
export async function readQuery(program: string, question: string, translate: Translator | null, signal?: AbortSignal): Promise<Query> {
  if (!question.trim()) throw new Error("The query is empty.");
  const goals = parseQuery(question);
  if (queryVariables(goals).length > 0) return goals;
  if (translate) return translate(program, question, signal);
  if (looksLikeQuestion(question)) {
    throw new Error('Set CLAUDE_API_KEY or SYSTEM_TWO_MODEL_ENDPOINT in .env to ask questions in plain English, or write the query with variables, like "X is a grandfather of Y?".');
  }
  return goals;
}
