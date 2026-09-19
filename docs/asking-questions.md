# Asking questions

The query box takes a plain-English question: `Who is Bart's grandfather?`, `Is Homer a parent of
Lisa?`, `Who is a father but not a grandfather?`. System Two (Claude, or a model served by Ollama)
translates the question into goals, and the engine proves the goals as usual. The model sees the
program, so it words the goals the way the program does when the meaning is the same, and those goals
match without asking Jev. It's told to translate, not to answer: a translation that names anyone the
question doesn't is rejected. The goals it produced are the first frame of the stack, and translations
are cached per program and question.

A query that uses variables is read as goals directly, without System Two: `X is a grandfather of Y?`.
Goals can be joined by _and_, alternatives by _or_ (_and_ binds tighter), and a goal can start with
_not_. Without `CLAUDE_API_KEY` or `SYSTEM_TWO_MODEL_ENDPOINT`, only this form works.

- A question asking _who_, _what_, or _which_ lists each solution, restating the question's goals
  with the values found. A yes/no question answers **Yes** with the proofs it found, or **No** once
  the search has finished without one.
- _not_ is negation as failure: `not X is a grandfather of Z` holds when no proof of `X is a
  grandfather of Z` can be found. Negated goals are tried after the positive ones, so their variables
  are usually bound by then; if one isn't, the step says so. Negative wording inside a sentence, like
  "isn't" or "can't", is just wording: it matches facts stated the same way.
- Each alternative of _or_ is searched in turn, and the solutions of all of them are listed.
