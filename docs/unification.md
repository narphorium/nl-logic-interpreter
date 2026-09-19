# How unification works

For each goal, the engine renames the variables in every clause (`X` → `X₃`) and unifies the goal with
each clause's head, in up to three steps. The examples below, and the probabilities Jev answered with,
come from asking [family.nl](../programs/family.nl) `Who are all the grandfathers?`.

## 1. Same wording

If the sentences match word for word, with variables standing for phrases, they unify without any AI.

| Goal                         | Clause                        | Bindings                  |
| ---------------------------- | ----------------------------- | ------------------------- |
| `Homer is the father of Y₂₂` | `Homer is the father of Bart` | `Y₂₂` = Bart              |
| `Abe is a parent of Y₄`      | `X₁₁ is a parent of Y₁₂`      | `X₁₁` = Abe, `Y₄` = `Y₁₂` |

## 2. Align

One Jev call. A yes/no question asks whether the sentences could state the same fact, and a
multiple-choice question for each variable picks the phrase it stands for from the other sentence. The
choices are every run of words in that sentence, plus "none of these".

For the goal `Homer is the father of Y₂₂` and the clause `Lisa's dad is Homer`, Jev answered:

| Question                           | Answer                     |
| ---------------------------------- | -------------------------- |
| Could they state the same fact?    | yes, 0.91                  |
| Which phrase does `Y₂₂` stand for? | `Lisa` 0.97, `Lisa's` 0.03 |

This step only filters out sentences that clearly don't match: a clause is dropped when the first
answer is under 0.3. `X is a grandfather of Y` and `Orville is the father of Abe` scored 0.06, even
though Jev would have bound `X` to Orville (0.85) and `Y` to Abe (0.93). Most clauses go no further:
of the 75 pairs Jev was asked about in this run, 50 ended here.

## 3. Verify

One more Jev call, skipped if the sentences read the same once the bindings are filled in. Jev
classifies how the clause relates to the goal (same fact, more specific, more general, roles swapped,
or different) and answers whether both are about the same people and things. "Same fact" and "same
people and things" must both be at least 0.7, and the lower of the two is the unification's confidence.

| Goal, filled in               | Clause, filled in             | Align | Relation                      | Same people and things | Unifies   |
| ----------------------------- | ----------------------------- | ----- | ----------------------------- | ---------------------- | --------- |
| `Homer is the father of Lisa` | `Lisa's dad is Homer`         | 0.91  | same 0.99                     | 0.97                   | yes, 0.97 |
| `Homer is a parent of Lisa`   | `Lisa's dad is Homer`         | 0.88  | more specific 0.52, same 0.44 | 0.93                   | no        |
| `Homer is the father of Y₂₇`  | `Homer is a parent of Y₂₇`    | 0.62  | more general 0.97, same 0.03  | 0.89                   | no        |
| `Abe is the father of Bart`   | `Homer is the father of Bart` | 0.39  | different 0.93, same 0.04     | 0.05                   | no        |

Offering "more specific" as an answer is what keeps `Lisa's dad is Homer` from unifying with `Homer is
a parent of Y₄`. That's an implication for a rule to express, not a paraphrase, and family.nl has the
rule: `If X is the father of Y then X is a parent of Y`. The goal matches the rule's head by wording,
and the rule's condition, now `Homer is the father of Y₂₂`, is the first row of the table. The third
row is the same implication met from the other side: a father goal tried against the rule's head.

The last row is why alignment isn't trusted alone. It let `Abe is the father of Y₁₂` and `Homer is the
father of Bart` through with `Y₁₂` bound to Bart, and only with the names filled in does Jev see two
different fathers. Of the 25 pairs verified in this run, 6 unified, 11 were about different people,
and 8 were more specific or more general.
