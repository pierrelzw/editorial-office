# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

科普编辑部 (Editorial Office) is an open-source Claude Code **workflow** that produces fact-checked popular science articles. The product is `.claude/workflows/popular-science.js`. There is no app and no build step. The repo also holds an offline test harness and the generated articles.

A second workflow, `.claude/workflows/agy-deep-research.js`, does general deep research: angles are researched by agy (Gemini) through the cc-suite agy runner, then cross-checked, synthesized and red-teamed by Claude. It writes `reports/<slug>/<VERSION>-<runTag>.md` and `research_notes/agy-deep-research/<slug>/<VERSION>-<runTag>/`, the same slug and run-key rules as popular-science. Its smoke tests are in `test/agy-deep-research.test.mjs`. The rest of this file is about popular-science.

## Commands

```bash
npm test                                                   # all tests (Node ≥20, no dependencies)
node --test --test-name-pattern="usable claims" test/*.test.mjs   # a single test
```

To run the workflow for real, ask Claude Code in this directory to "use the popular-science workflow" with `args` such as `{topic, runTag}`. The full arg list is in the `whenToUse` field of `meta` and in the README. A real run spawns about `2 × angleCount + 6` agents and costs real tokens. Use `npm test` to check changes.

## Architecture

**Workflow pipeline.** Plan → Investigate → Draft → Review → Polish → Verify.
- Investigate uses `pipeline()`, not `parallel()`, so each angle's fact-check starts as soon as its research finishes. Keep it that way.
- Between Investigate and Draft, plain JS (no agent) builds the **claim ledger**. It merges each claim with its verdict, then splits it:
  - `usable`: confirmed / corrected / overstated / disputed.
  - `rejected`: false / unverifiable, plus `unchecked` when fact-checking failed.
- All later stages are grounded in that ledger. The writer may state as fact only what is in `<usable_claims>`. The reviewers and the final gate check against the ledger.
- The draft carries hidden `<!-- c:claim-id -->` tags for traceability. Polish strips them.

**Schemas are the contracts between stages.** `PLAN_SCHEMA`, `RESEARCH_SCHEMA`, `VERDICT_SCHEMA`, `REVIEW_SCHEMA` and `FINAL_SCHEMA` define what each agent returns. Claim ids (`<angleKey>-<n>`) join research to verdicts. Renaming a field means updating every prompt and ledger mapping that reads it.

**Outputs.** Only the Polish and Verify agents touch files. The script itself has no filesystem access. Paths are relative to the project root:
- `articles/<slug>/<VERSION>-<runTag>.md`
- `research_notes/popular-science/<slug>/<VERSION>-<runTag>/ledger.json`

File names are English only. `toSlug` keeps ASCII letters and digits only (accents folded, max 60 characters). The slug comes from `args.slug`, else from a Latin-script topic, else from a small haiku agent labelled `slug`. A generated slug can differ between runs, so pass `args.slug` when comparing runs.

**Test harness.** `test/harness.mjs` turns the workflow file into an `AsyncFunction` and stubs `agent`, `pipeline`, `parallel`, `phase`, `log` and `budget`:
- `pipeline` and `parallel` mirror the real runtime's null-on-failure behaviour.
- `Date.now()`, argless `new Date()` and `Math.random()` throw, just as they do in the real runtime, where they would break resume.

Tests dispatch fake agent results by `opts.label` (`slug`, `plan`, `research:<key>`, `fact-check:<key>`, `draft`, `review:*`, `polish`, `verify:final`). Changing a label breaks the tests on purpose. To check what the agents are given, tests read the prompt sections inside tags such as `<usable_claims>`.

## Workflow script constraints

- `export const meta` must be a pure literal. `meta.phases[].title` must match the `phase()` calls exactly, and a test enforces this.
- The script is plain JavaScript, not TypeScript, and has no Node or filesystem APIs. Pass dates in through `args.today`.
- `agent()` can return `null` when an agent fails or is skipped. Guard with `?.` and `.filter(Boolean)`, as the existing code does.

## Iterating

- Bump `VERSION` for any change to prompts or stages, and add an entry to `CHANGELOG.md`. The version is in every output filename, so you can run old and new versions on the same topic with different `runTag`s and compare the articles and ledgers.
- The accuracy rules are the core of the project. Do not loosen them for style. These include: weak evidence named in the sentence, causal verbs only for RCTs or meta-analyses, baselines for every relative number, no false balance, and hedges are content.
