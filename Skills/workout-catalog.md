# Workout Catalog Integration — JC-Concepts/WorkoutGenerator

## Catalog and generated summary

- Original catalog: `https://raw.githubusercontent.com/JC-Concepts/WorkoutGenerator/refs/heads/main/workouts.json`
- This catalog is about 4 MB and should not be loaded directly in ChatGPT Mobile/Web.
- GitHub Actions refreshes `workout_catalog_summary.json` twice daily and on manual dispatch. It contains only compact selection metadata; workout files stay in the source repository.
- This repository is private. Download the latest `workout_catalog_summary.json` from the repository and attach it in ChatGPT/Mistral. Do not assume a raw URL to this private repository is accessible to a free-tier chat.

The generated summary preserves the upstream catalog version and update time. Each row in `workouts` is an array, with the meaning and order of values defined once in the top-level `fields` array. It includes each selectable workout's ID, name, short description, author, category, duration, TSS, primary zone, average power, and source file path. Rest entries and entries without a usable workout file or duration are omitted. The source `.zwo`/`.xml` file is fetched only after an athlete chooses a candidate.

Use the top-level `source_version` when submitting a catalog push. The action compares it with the current upstream catalog and refuses to push if the index is stale.

## How to select a workout

1. Read current athlete data and prescribed workout intent before evaluating candidates; apply all readiness, health, calendar, and training-load checks required by Section 11.
2. Filter the attached summary against the prescribed workout intent/target zone and the athlete's available duration. Consider TSS and category as additional suitability checks, not substitutes for the prescription.
3. For a few shortlist candidates, fetch the `.zwo`/`.xml` file from `https://raw.githubusercontent.com/JC-Concepts/WorkoutGenerator/refs/heads/main/workouts/{file}` and inspect its actual steps against `WORKOUT_REFERENCE.md`. Identify the applicable template before recommending; if the file or template cannot be loaded, say so rather than improvising.
4. Present a small set of verified options with `id`, `name`, `author`, `duration`, `TSS`, `primary_zone`, and a short reason for fit. Do not claim that the compact summary includes the full workout steps.
5. After the athlete chooses an option and approves scheduling it, dispatch `.github/workflows/push-workout.yml` with `command=push-catalog-workout`, `catalog_workout_id=<selected id>`, `catalog_version=<source_version>`, `date=YYYY-MM-DD`, and `confirm=false` for preview. Show the preview and obtain explicit approval before dispatching again with `confirm=true`.

The action resolves the selected ID against the current upstream catalog, downloads its corresponding workout file, and submits the structured file to Intervals.icu using the supported `filename` and `file_contents_base64` event fields. It uses the athlete's `ATHLETE_ID` and `INTERVALS_KEY` repository secrets; do not ask the athlete to put credentials in chat.

## Catalog schema and source file

The upstream catalog has `version`, `lastUpdated`, and a `workouts` array. Each workout normally includes:

- `id`, `name`, `description`, `author`
- `category`, `subcategory`
- `duration_seconds`, `duration_category`
- `tss`, `avg_power`, `primary_zone`
- `file` (path under `workouts/`) and `segments`

The compact summary excludes the large `segments` arrays; use the `file` path and upstream repository to inspect the full workout structure if needed. The push action always resolves the ID against the latest upstream catalog so renamed or changed catalog entries are not stale copies.

## Integration and safety

- `.github/workflows/refresh-workout-catalog.yml` rebuilds and commits the compact summary from the original catalog. It can also be run manually.
- The refresh workflow needs GitHub Actions to be permitted to write repository contents so it can commit updated summaries.
- `.github/workflows/push-workout.yml` supports both existing calendar-event pushes and structured catalog-file uploads.
- `push.py` validates the request and defaults to preview; writes require `--confirm`.
- `saved_workouts.json` remains the preferred read path for workouts already saved by the athlete. The public catalog is an additional source, not a replacement.
- Never fabricate or edit a catalog workout's steps. If the upstream file cannot be loaded or the required workout-reference template is unavailable, explain that and do not push.
