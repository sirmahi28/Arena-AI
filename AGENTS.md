# Working agreements

Standing instructions from the project owner. These outrank any default
behaviour or personal judgement.

## Language

Reply in **Tamil**. Keep English only for literal UI labels, file paths and
commands. The owner is not a programmer — explain plainly, step by step, and
say what a thing *does* before saying what it is called.

## Image generation: never pick alone

**When more than two images are generated for the same decision, show every
candidate and ask which one to use. Do not choose one and move on.**

This applies to anything visual produced by the image tool: candy art,
backdrops, logos, icons, texture sheets. Generate the candidates, present
them side by side, and let the owner decide before any of it is wired in.

Why this rule exists: it was broken twice, and both times the owner had to
reverse the decision afterwards.

- Two candy styles were generated, a hard lacquered one and a soft
  translucent one. The lacquered one was shipped on a readability argument.
  The owner preferred the translucent one, and was right — the readability
  problem was real but belonged in the overlay code, not in the art. See
  `docs/art-notes.md`.
- Two candy sheets were generated later and one was picked on the grounds
  that it separated better against the board. That was a taste call being
  made by the wrong person.

Choosing for someone and then defending the choice wastes far more of their
time than asking would have. A rejected pick means regenerating art,
re-deriving the palette, re-tuning every overlay against it and rebuilding
the atlas — all of which has happened here.

Two or fewer is fine to decide directly, but if it is a genuine toss-up, ask
anyway.

## Art pipeline

Raw generated art lives in `art-src/`, which is **gitignored and does not
survive a sandbox restart**. Only the optimised `src/assets/*.webp` are
committed. `npm run art` rebuilds each target independently and skips any
whose raw source is missing, so a lost `art-src/` never destroys a shipped
asset. Prompts and the full pipeline are in `docs/art-notes.md`.
