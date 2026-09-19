# Natural Language Logic Interpreter

https://github.com/user-attachments/assets/6222cadf-0734-4efe-9bb1-4fa3c4d01256

A step-through logic interpreter for facts and rules written in plain English. It proves goals by SLD
resolution, as Prolog does, but unification is done by [Jev](https://docs.typesafe.ai), TypeSafe's
System One model, so sentences unify when they state the same fact, however they're worded: the goal
`X is the father of Y` unifies with the fact "Lisa's dad is Homer", binding X to Homer and Y to Lisa.

## Running it

```sh
pnpm install
cp .env.example .env   # then set TYPESAFE_API_KEY and CLAUDE_API_KEY, or see Settings
pnpm dev               # http://localhost:3000
```

### Settings

The server reads its settings from `.env` at startup, so restart it after changing them. Two models do
the work: System One unifies sentences, and System Two translates plain-English questions into goals.
Either one can run locally.

| Setting                      | What it does                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `TYPESAFE_API_KEY`           | Key for Jev, TypeSafe's System One model                                                                                                    |
| `SYSTEM_ONE_MODEL_ENDPOINT`  | A Jev-compatible server, like [LocalJev](https://github.com/githubnext/localjev), to use instead of TypeSafe's API. It doesn't need a key.  |
| `SYSTEM_ONE_MODEL`           | `jev-latest` (the default) or `jev-preview`                                                                                                 |
| `SYSTEM_ONE_TIMEOUT_SECONDS` | How long to wait for each answer before retrying (default 10). A local model takes 10-15 seconds per answer, so set 120 or more             |
| `CLAUDE_API_KEY`             | Key for Claude, which reads questions unless `SYSTEM_TWO_MODEL_ENDPOINT` is set                                                             |
| `SYSTEM_TWO_MODEL_ENDPOINT`  | An [Ollama](https://ollama.com) server to read questions instead of Claude                                                                  |
| `SYSTEM_TWO_MODEL`           | The model that reads questions: a Claude model (default `claude-haiku-4-5`), or the Ollama model to use, which is required with an endpoint |

For example, to run both locally, with [LocalJev](https://github.com/githubnext/localjev) and Ollama:

```sh
SYSTEM_ONE_MODEL_ENDPOINT=http://127.0.0.1:8080
SYSTEM_ONE_TIMEOUT_SECONDS=180
SYSTEM_TWO_MODEL_ENDPOINT=http://localhost:11434
SYSTEM_TWO_MODEL=<an Ollama model you've pulled>
```

Each answer is retried twice before a run fails, so a server that is merely slow costs time rather than
the run. Two things about local unification are worth knowing before you start:

- **Start LocalJev with `LOCALJEV_OUTCOMES_PER_CALL=16`.** Unification asks which phrase a variable
  stands for, and that question can offer twenty or more phrases at once. Asked for a probability for
  every one of them in a single answer, a local model tends to return a list of the wrong length, which
  fails the run. Sixteen at a time is small enough to count reliably.
- **A local model reads paraphrases less confidently than Jev does**, so the example programs may prove
  fewer goals than their `# Try:` questions suggest. `socrates.nl` is the extreme case: its first
  question finds nothing with DiffusionGemma, which binds the rule's variable to "day" rather than to
  the person, while `Who is mortal?` proves both answers.

## Program files

The example programs live in `programs/*.nl`. Pick one from the menu at the top of the program pane. A file holds
facts and rules, plus questions to try in comments starting with `Try:`. The first one goes in the
query box:

```
# Which birds can fly?
Tweety is a canary.
If X is a canary then X is a bird.
X can fly if X is a bird.
# Try: Which birds are able to fly?
```

The server keeps each program's latest run in memory (its trace, solutions, and status), so switching
programs shows the last run of each one. A run keeps going in the background when you switch away.
STOP keeps the trace so far, and running again replaces it. Nothing is written to disk, and edits to a
program aren't saved to its file.

## Docs

- [Writing programs](docs/writing-programs.md): facts, rules, and variables
- [Asking questions](docs/asking-questions.md): plain-English questions, goals, and negation
- [How unification works](docs/unification.md): matching sentences with Jev
- [Run a query in a notebook](notebooks/nl-logic-run-query.ipynb): the engine on its own, without the UI.
  It runs on Deno, so it needs the Deno Jupyter kernel (`deno jupyter --install`), and reads its keys
  from the same `.env`.

## License

[MIT](LICENSE)
