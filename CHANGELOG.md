# Changelog

Workflow versions are the `VERSION` constant in `.claude/workflows/popular-science.js`; they appear in every output filename (`<VERSION>-<runTag>`).

## Unreleased

- Moved out of the `spikes` repository into this standalone repo.
- Output paths are now relative to the project root instead of a hard-coded absolute path. Writing agents resolve them against their working directory.
- Added an offline test harness (`npm test`) that runs the workflow with stubbed agents.

## Workflow v3 (as moved from spikes)

- Six phases: Plan, Investigate (a research → fact-check pipeline per angle), Draft, Review (accuracy ∥ lay reader), Polish, Verify.
- Claims record their evidence basis (study design, subjects, review status). Fact-checkers record where expert consensus stands.
- Outputs are keyed by `VERSION-runTag`, so runs can be compared side by side.
