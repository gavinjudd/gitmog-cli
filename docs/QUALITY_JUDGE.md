# Quality Judge

Quality Judge is a separate, versioned static-analysis preview planned for v0.3.0. It evaluates
two noninterchangeable readings:

- **Maintained codebase:** engineering qualities in repositories a profile publicly owns or
  materially maintains.
- **Attributed code:** only sampled code with bounded public commit evidence linked to the
  profile. Missing attribution is not negative evidence.

It must use reviewed real parsers for activated languages. Unsupported or unsafe syntax lowers
coverage rather than score. Every visible finding requires a same-response safe receipt; no
receipt contains source excerpts. Target code is never executed and raw source is never
persisted.

The preview attaches only after the canonical battle is complete. It has `scoreInfluence: 0` and
cannot alter the score, basis, coverage, rounds, winner, margin, verdict, evidence, battle key,
existing JSON battle fields, or cache identity. Activation remains structurally disabled pending
the preregistered blinded multi-human gate.
