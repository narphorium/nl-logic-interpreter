# Writing programs

One sentence per line. Blank lines and lines starting with `#`, `%`, or `//` are ignored.

- **Rules** are lines containing _if_, _then_, or _when_. These forms all work:
  `If B then H`, `If B, H`, `When B, H`, `B then H`, `H if B`, `H when B`.
  Conditions are split on _and_, commas, and semicolons. _or_ between conditions gives alternatives
  (_and_ binds tighter), and makes one clause per alternative. A condition starting with _not_ is
  negated (see [Asking questions](asking-questions.md)). A rule can't conclude _or_ or _not_.
- **Facts** are every other line, taken as written: "Carol can't stand Bob" is a fact about not
  standing, not a negation.
- **Variables** are single capital letters, optionally numbered: `X`, `Y`, `Z1`. `A` and `I` are
  ordinary words. Note that this also makes a middle initial ("Homer J Simpson") a variable.
- **Queries** are plain-English questions, or goals written like conditions. See [Asking questions](asking-questions.md).
