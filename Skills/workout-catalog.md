# Workout Catalog Integration — JC-Concepts/WorkoutGenerator

## Catalog and generated summary

- Original catalog: `https://raw.githubusercontent.com/JC-Concepts/WorkoutGenerator/refs/heads/main/workouts.json`
- This catalog is about 4 MB and should not be loaded directly in ChatGPT Mobile/Web.
- GitHub Actions refreshes `workout_catalog_summary.json` twice daily and on manual dispatch. It contains only compact selection metadata; workout files stay in the source repository.
- The compact catalog is public workout metadata and may be refreshed from the public app repository. It contains no athlete records or credentials.

The generated summary preserves the upstream catalog version and update time. Each row in `workouts` is an array, with the meaning and order of values defined once in the top-level `fields` array. It includes each selectable workout's ID, name, short description, author, category, duration, TSS, primary zone, average power, and source file path. Rest entries and entries without a usable workout file or duration are omitted. The source `.zwo`/`.xml` file is fetched only after an athlete chooses a candidate.

The PWA uses the top-level `source_version` to identify the selected catalog snapshot. The browser fetches the chosen workout from the upstream catalog and uploads it directly to Intervals.icu using the athlete's locally stored API key.

## How to select a workout

1. Read current athlete data and prescribed workout intent before evaluating candidates; apply all readiness, health, calendar, and training-load checks required by Section 11.
2. Use the app's catalog search results. Exact search constraints are generated estimates; if the app says some filters were relaxed, evaluate the returned best-fit options against the athlete's actual request and explain any mismatch.
3. The TOOL_RESULT contains compact metadata, not `.zwo`/`.xml` steps. Do not claim to have fetched or inspected those files or a `WORKOUT_REFERENCE.md` template; this PWA does not provide those contents to the model.
4. Present a small set of catalog options with `id`, `name`, `author`, `duration`, `TSS`, `primary_zone`, and a short reason for fit. Do not claim that the compact summary includes the full workout steps.
5. If the app explicitly reports that the catalog is unavailable, say so. If broader search still returns no suitable options, explain the mismatch and ask which user constraint to relax; do not invent a catalog match or custom workout.
6. After the athlete chooses an option and explicitly confirms, use the PWA's browser-to-Intervals.icu upload flow. Never pass an athlete's API key or ID as a GitHub Actions input.

## Catalog schema and source file

The upstream catalog has `version`, `lastUpdated`, and a `workouts` array. Each workout normally includes:

- `id`, `name`, `description`, `author`
- `category`, `subcategory`
- `duration_seconds`, `duration_category`
- `tss`, `avg_power`, `primary_zone`
- `file` (path under `workouts/`) and `segments`

The compact summary excludes the large `segments` arrays. The PWA fetches the selected file from the upstream catalog after selection for preview/upload; the model cannot inspect the workout structure through the current catalog tool. The athlete reviews the selected workout before confirming an upload.

## Integration and safety

- `.github/workflows/refresh-workout-catalog.yml` rebuilds and commits the compact summary from the original catalog. It can also be run manually.
- The refresh workflow needs GitHub Actions to be permitted to write repository contents so it can commit updated summaries.
- Workout uploads are performed by the PWA directly from the browser after explicit confirmation; no personal-credential workflow is used.
- `saved_workouts.json` remains the preferred read path for workouts already saved by the athlete. The public catalog is an additional source, not a replacement.
- Never fabricate or edit a catalog workout's steps. If the upstream file cannot be loaded or the required workout-reference template is unavailable, explain that and do not push.
