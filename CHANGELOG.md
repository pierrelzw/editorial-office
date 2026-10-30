# Changelog

Workflow versions are the `VERSION` constant in each workflow file; they appear in every output filename (`<VERSION>-<runTag>`).

## Unreleased

- Moved out of the `spikes` repository into this standalone repo.
- Output paths are now relative to the project root instead of a hard-coded absolute path. Writing agents resolve them against their working directory.
- Added an offline test harness (`npm test`) that runs the workflow with stubbed agents.
- Moved `agy-deep-research.js` and its past runs (`reports/`, `research_notes/agy-deep-research/`) over from `spikes`. Its output paths are now project-relative too.

## popular-science v4 · agy-deep-research v2

- Output file and directory names are English only: slugs are ASCII kebab-case (accents folded, capped at 60 characters). A non-Latin topic without `args.slug` gets an English slug from a small haiku agent (label `slug`); pass `args.slug` to keep repeated runs in one directory. A non-English `args.slug` or `args.runTag` is rejected before any agent runs. Over-long slugs are cut on a word boundary.
- agy-deep-research now versions its outputs like popular-science: `reports/<slug>/<VERSION>-<runTag>.md` and `research_notes/agy-deep-research/<slug>/<VERSION>-<runTag>/{raw/,ledger.json}`. It accepts `runTag`, and `outDir` now names the parent of the run directory (same as popular-science). Reports from before this change are filed as version 1.
- Both workflows return `slug`; agy-deep-research also returns `version`, `runTag` and `ledger`.

## Workflow v3 (as moved from spikes)

- Six phases: Plan, Investigate (a research → fact-check pipeline per angle), Draft, Review (accuracy ∥ lay reader), Polish, Verify.
- Claims record their evidence basis (study design, subjects, review status). Fact-checkers record where expert consensus stands.
- Outputs are keyed by `VERSION-runTag`, so runs can be compared side by side.
