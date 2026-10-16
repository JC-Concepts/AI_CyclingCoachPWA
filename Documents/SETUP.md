# AI Cycling Coach — Setup

Operational setup for the AI Cycling Coach PWA. The binding technical spec is
`Documents/ARCHITECTURE.md`; the runtime coach prompt and the build prompt are in
`Documents/AI_PROMPTS.md`.

## What this repo is

A static, no-build vanilla-JS PWA (hosted anywhere) plus a private GitHub repo used as the
per-athlete data store under `Users/<AthleteID>/`. One repo, one coach GitHub account, many
athletes. Athletes need **no** GitHub account; the coach issues a fine-grained PAT per device.

## 1. Create the repo

1. Create a **private** GitHub repo named `AI_CyclingCoachPWA` (coach account).
2. Push this workspace to it (branch `main`).
3. Settings → Actions → General → Workflow permissions → **Read and write**.

## 2. Issue a fine-grained PAT (one per device)

Settings → Developer settings → Personal access tokens → Fine-grained tokens:

- Repository access: **only** `AI_CyclingCoachPWA`.
- Permissions: `Contents: Read and write`, `Actions: Read and write`, `Metadata: Read`.

Revoke a token to cut off a single device (§13 rotation runbook in ARCHITECTURE.md).

## 3. Intervals.icu credentials

1. Account at https://intervals.icu; connect your device directly.
2. Settings → Developer → create an API key.
3. Note your Athlete ID from `intervals.icu/athlete/<ID>`.

## 4. Deploy the static app

Host only the app assets (not `Users/`, not `Documents/`): Cloudflare Pages, Netlify, Vercel,
or GitHub Pages. Relative URLs only — no hardcoded hostnames in `sw.js`/`pwa-manifest.json`.

## 5. Configure the device (Settings tab)

All five values are stored only in `localStorage` key `coach.settings.v1`:

| Field | Example | Notes |
|---|---|---|
| Athlete ID | `i12345` | Intervals.icu |
| Intervals API key | `…` | password field |
| OpenRouter API key | `sk-or-…` | password field |
| Model | free model id | use **Load free models** |
| GitHub PAT | `github_pat_…` | password field |

Then **Run data sync** to dispatch `sync-intervals.yml`. After it completes, the six JSON
files appear as `Users/<ID>/<ID>_*.json` and the Coach tab can answer.

## 6. Workflows

| Workflow | Trigger | Purpose |
|---|---|---|
| `sync-intervals.yml` | dispatch (PWA) | pull Intervals data → `Users/<ID>/<ID>_*.json` |
| `push-workout.yml` | dispatch (PWA) | calendar ops (list/move/delete/set-threshold/annotate) |
| `refresh-workout-catalog.yml` | cron / manual | rebuild `workout_catalog_summary.json` |

Credentials are passed as dispatch inputs and `::add-mask::`-ed in the first step. No secrets
are stored in the repo.

## 7. Testing

```
npm test        # node --test tests/*.test.js  (no dependencies)
```

## 8. Cost

- OpenRouter free models: `$0`.
- GitHub Actions: free for public repos; private repos use the account minute allowance.
