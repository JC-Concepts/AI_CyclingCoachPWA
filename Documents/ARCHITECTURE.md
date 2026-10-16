# AI Cycling Coach PWA — Architecture

**Repository:** `AI_CyclingCoachPWA` (private)
**App type:** Vanilla-JS Progressive Web App, static hosting, no backend
**Primary reference:** [JC-Concepts/WorkoutGenerator](https://github.com/JC-Concepts/WorkoutGenerator) (theme, UI, Intervals.icu push)
**Coaching protocol:** [CrankAddict/section-11](https://github.com/CrankAddict/section-11) v11.71
**Companion document:** `Documents/AI_PROMPTS.md` (coach system prompt + build prompt)

This document is the single build specification. Feed it to a coding AI alongside
`Documents/AI_PROMPTS.md`. Every file, path, and API contract named here is normative.

---

## 1. Overview and Goals

An AI cycling coach delivered as a PWA. The main surface is an interactive chat with an
AI coach; workout browsing and settings are secondary tabs.

**Goals**

1. AI Coach Chat (tab 1): conversational coaching grounded in the athlete's Intervals.icu
   data, following the Section 11 protocol. Driven by OpenRouter free models.
2. Workouts (tab 2): the WorkoutGenerator app minus the "Surprise Me" button — filter the
   workout catalog, view the SVG intensity chart, push a workout to Intervals.icu.
3. Settings (tab 3): credentials + model selection.
4. One shared private GitHub repo hosts the app and all athlete data under
   `Users/<AthleteID>/`. Scalable to many athletes, one coach account.
5. All secrets live only on the athlete's device.

**Non-goals (v1)**

- No backend server, no user login system, no payments.
- No per-athlete Git history isolation (see §13 for the trust model and upgrade path).
- No offline coaching — offline is read-only cache of the last synced data.

---

## 2. Design Principles

1. **Privacy-first.** Intervals keys, OpenRouter keys, and the GitHub token never appear
   in the repo, in any GitHub Action log, in any LLM prompt, or in any URL (§6).
2. **Protocol-driven.** Coaching logic follows Section 11: source hierarchy, data
   discipline (no data read = no number), readiness gates, health-context gates.
3. **Reuse before rewrite.** WorkoutGenerator files are copied verbatim where possible;
   `sync.py` / `push.py` / `push_catalog_workout.py` are upstream Section 11 engines and
   are not to be edited (§14).
4. **Deterministic gating.** Missing settings, missing dossier, and stale data are
   enforced in application code, not by the model's goodwill.

---

## 3. Stack, Hosting, Deployment

| Layer | Choice |
|---|---|
| Frontend | Vanilla ES2018+ JavaScript, plain `<script>` tags (not ES modules) — matches WorkoutGenerator so its files port 1:1 |
| Styling | Single `css/style.css`, CSS custom properties (§7) |
| PWA | `sw.js` (app-shell cache), `pwa-manifest.json` |
| Static host | Cloudflare Pages / Netlify / Vercel (free tier), git-integrated, repo `AI_CyclingCoachPWA` |
| Data store | GitHub repo, Contents API, `Users/<AthleteID>/` |
| Actions | GitHub Actions (sync, catalog refresh, calendar ops) |
| LLM | OpenRouter `POST /api/v1/chat/completions` (free models) |
| Training API | Intervals.icu `https://intervals.icu/api/v1` |

**Deployment rule — deploy only app assets.** The build step must copy an allowlist to
the publish directory (`index.html`, `css/`, `js/`, `assets/`, `sw.js`,
`pwa-manifest.json`, `workout_catalog_summary.json`, `Skills/`) and never copy
`Users/` or `Documents/`. Alternatively a deploy workflow with a `paths:` filter on those
assets. Reasons: (a) `Users/` is private data, (b) data-sync commits happen every time an
athlete opens the app — without a path filter they would burn the free-tier deploy quota.

**Service worker scope:** register `sw.js` with a relative path (`./sw.js`) so the app
works on any host subpath. Never hardcode `/WorkoutGenerator/`-style absolute scopes.

**Static host must support HTTPS** (required for service worker + localStorage).

---

## 4. Repository Structure

```
AI_CyclingCoachPWA/                       (private)
├─ index.html                             app shell, 3 tabs + modals  (from WorkoutGenerator)
├─ sw.js                                  service worker               (from WorkoutGenerator)
├─ pwa-manifest.json                      PWA manifest                 (from WorkoutGenerator, renamed)
├─ css/
│  └─ style.css                           theme + chat styles          (WorkoutGenerator base + chat additions)
├─ js/
│  ├─ config.js                           constants, endpoints, cache keys
│  ├─ storage.js                          localStorage manager         (WorkoutGenerator + settings/memory/cache)
│  ├─ settings.js                         settings validation gate (pure)
│  ├─ blocks.js                           structured block parser + safe markdown (pure)
│  ├─ catalog.js                          catalog normalize/filter (pure)
│  ├─ context.js                          Context Builder for the AI (§8.3, pure)
│  ├─ memory.js                           memory + diff-guarded hash (§11, pure)
│  ├─ prompt.js                           coach system prompt §A, verbatim (pure)
│  ├─ api.js                              GitHub + Intervals + OpenRouter (WorkoutGenerator ApiManager extended)
│  ├─ ui.js                               rendering incl. SVG chart    (WorkoutGenerator UIManager + chat UI)
│  ├─ chat.js                             chat controller, block parser (§8.6)
│  └─ app.js                              main app, tab routing, init  (WorkoutGenerator WorkoutApp extended)
├─ tests/                                 node:test unit tests (no dependencies)
│  ├─ blocks.test.js  catalog.test.js  context.test.js  memory.test.js
│  └─ prompt.test.js  settings.test.js  storage.test.js
├─ package.json                           `npm test` -> node --test (no dependencies)
├─ assets/icons/                          PWA icons                    (copy from WorkoutGenerator)
├─ workouts.json                          NOT in this repo — generated summary lives at root, see below
├─ workout_catalog_summary.json           compact catalog (generated by workflow, public derivative)
├─ sync.py                                upstream Section 11 v3.139 — DO NOT EDIT
├─ push.py                                upstream Section 11 — DO NOT EDIT
├─ push_catalog_workout.py                catalog push engine (Action path) — DO NOT EDIT
├─ generate_workout_catalog_summary.py    summary generator — DO NOT EDIT
├─ Documents/
│  ├─ ARCHITECTURE.md                     this file
│  ├─ AI_PROMPTS.md                       coach system prompt + build prompt
│  ├─ SETUP.md                            human setup guide (rewrite of SETUP_NOTES.md)
│  └─ DOSSIER_TEMPLATE.md                 adapted from Section 11 v2.1.0
├─ Skills/
│  ├─ workout-catalog.md                  catalog selection protocol
│  ├─ workout-agent.md                    custom workout generation
│  ├─ phenotype-agent.md                  phenotype assessment
│  ├─ health-context.md                   illness/injury severity rules
│  └─ interval-analysis.md                interval analysis  (strip UTF-8 BOM — currently unreadable as binary)
├─ Users/
│  └─ <AthleteID>/                        e.g. Users/i123456/
│     ├─ <AthleteID>_latest.json          7-day snapshot (sync.py primary output)
│     ├─ <AthleteID>_history.json         longitudinal trends
│     ├─ <AthleteID>_intervals.json       recent interval detail
│     ├─ <AthleteID>_routes.json          planned route terrain
│     ├─ <AthleteID>_saved_workouts.json  athlete's saved workouts
│     ├─ <AthleteID>_ftp_history.json     FTP changes over time
│     ├─ <AthleteID>_dossier.md           stable private athlete context (Dossier)
│     ├─ <AthleteID>_memory.json          long-term chat memory (§11)
│     └─ .gitkeep
└─ .github/workflows/
   ├─ sync-intervals.yml                  pull data (modified for per-athlete)   §9
   ├─ refresh-workout-catalog.yml         rebuild summary (unchanged)
   └─ push-workout.yml                    calendar ops (per-athlete creds)      §10
```

**Root `.gitignore` (mandatory):**

```
Users/*/*_latest.json
Users/*/*_history.json
Users/*/*_intervals.json
Users/*/*_routes.json
Users/*/*_saved_workouts.json
Users/*/*_ftp_history.json
Users/*/*_dossier.md
Users/*/*_memory.json
.sync_config.json
*.log
```

(Only `.gitkeep` and future non-sensitive per-user metadata stay tracked. **Wait** — the
repo *is* the data store, so data files must be committed by the Action, not ignored.
Therefore `.gitignore` must NOT ignore the `Users/` data files; instead it ignores only
local-only artifacts: `.sync_config.json`, `*.log`. The files above are written and
committed by Actions and pushed by the app via the Contents API. The ignore rules above
apply only while working locally outside the sync flow.)

**Resolution (binding):** `.gitignore` contains exactly:

```
.sync_config.json
*.log
.DS_Store
```

`Users/**` data IS tracked — the private repo is the long-term store (§1.4).

---

## 5. Data Model and Naming

**Prefix rule:** every file inside `Users/<AthleteID>/` is named `<AthleteID>_<suffix>`.
Athlete ID format: `i` + digits (e.g. `i123456`), or bare digits for early accounts.

| File | Producer | Consumer |
|---|---|---|
| `<ID>_latest.json` | `sync-intervals.yml` (server-side) | Context Builder Tier 1 (§8.3) |
| `<ID>_history.json` | same | Tier 2, trend questions |
| `<ID>_intervals.json` | same | Tier 2, interval compliance |
| `<ID>_routes.json` | same | Tier 2, terrain questions |
| `<ID>_saved_workouts.json` | same | Tier 2, "what's already saved" |
| `<ID>_ftp_history.json` | same | Tier 2, threshold questions |
| `<ID>_dossier.md` | App (Dossier interview, §12) | Tier 1 (always), coach context |
| `<ID>_memory.json` | App (§11) | Tier 0, continuity across sessions |
| `workout_catalog_summary.json` | `refresh-workout-catalog.yml` | Workouts tab + `workout_search` tool |

**Naming change vs upstream:** `sync.py` writes `latest.json` etc. to cwd with fixed
names. The workflow does **not** modify `sync.py`; after the run it moves and renames:

```
for f in latest history intervals routes saved_workouts ftp_history; do
  [ -f "$f.json" ] && mkdir -p "Users/$ATHLETE_ID" && mv "$f.json" "Users/$ATHLETE_ID/${ATHLETE_ID}_$f.json"
done
```

**`latest.json` structure (v3.139):** `READ_THIS_FIRST` (instructions + `quick_stats`),
`metadata` (`last_updated`, `version`, `data_range_days`), `athlete_profile`,
`summary`, `weekly_summary`, `derived_metrics` (ACWR, capability, ACWR start-of-day),
`readiness_decision` (P0–P3 go/modify/skip with signals), `health_context`
(`clarification_required`, markers). These keys are the Context Builder vocabulary.

---

## 6. Security Model

### 6.1 Secret inventory

| Secret | Where it lives | Where it is used | Never |
|---|---|---|---|
| Intervals.icu Athlete ID | `localStorage` (Settings) | Intervals API paths, Action dispatch inputs | Repo, prompts, logs |
| Intervals.icu API key | `localStorage` | Intervals API (browser), Action dispatch inputs (masked) | Repo, prompts, logs, URLs |
| OpenRouter API key | `localStorage` | OpenRouter `Authorization` header | Repo, prompts, logs, URLs |
| GitHub fine-grained PAT | `localStorage` | GitHub API reads/commits, Action dispatch | Repo, prompts, logs, URLs |
| Selected model id | `localStorage` | OpenRouter `model` field | — (not secret) |

**Storage:** one `localStorage` key `coach.settings.v1`, single JSON object, `type="password"`
inputs, never `console.log`-ed. Keys are same-origin readable by any script on the page —
mitigated by §6.3 XSS rules. (v2 upgrade path: WebCrypto + passphrase, not v1.)

**Prompts:** the prompt builder (§8.3) whitelists fields from JSON files. Credentials are
never assembled into a prompt. Add a runtime assertion: if any settings value appears in
the final messages payload, abort and log a redacted warning.

### 6.2 GitHub PAT (fine-grained)

- Owner: **coach's GitHub account only** (single-user repo access; athletes hold no
  GitHub accounts — decision log §16).
- Type: fine-grained personal access token.
- Repository access: only `AI_CyclingCoachPWA`.
- Permissions: `Contents: Read and write`, `Actions: Read and write`, `Metadata: Read`.
- Issued per athlete device, individually revocable (rotation runbook §13).
- Used for: read `Users/<ID>/*`, commit `<ID>_memory.json`, dispatch/poll workflows,
  create the user folder on first run.

**Known limitation (accepted):** GitHub has no path-level permissions — a PAT can read
the whole repo. Folder privacy is convention + trust, not enforcement. For untrusted
multi-athlete scenarios use the fork upgrade path (§13).

### 6.3 XSS / injection rules

1. Model output is rendered through an `escapeHtml()` helper first; markdown allowlist
   (headings, bold, italic, lists, links with `http(s)` only, tables, code blocks).
   No `innerHTML` with raw model text. No `<script>`, `on*=` attributes, `javascript:` URLs.
2. Workout names/descriptions from the catalog are escaped (they originate from an
   external repo).
3. JSON from GitHub is validated against expected shape before use; malformed → error
   toast, never `eval`.

### 6.4 What GitHub Actions see

`workflow_dispatch` inputs are stored with the run and visible to anyone with repo read
access — which is **only the coach** (§6.2). Still mandatory: first step of every
workflow is `::add-mask::` on both credentials, and no step ever echoes them.

---

## 7. UI Architecture

### 7.1 Shell

```
┌────────────────────────────────────────────┐
│ Header: logo "AI Cycling Coach" · sync     │
│ chip (idle/syncing/stale/error) · Donate ♥ │
│ (opens Donate modal) · gear (→Settings tab)│
├────────────────────────────────────────────┤
│ Tab bar: [ 🤖 Coach ] [ 🏋 Workouts ] [ ⚙ Settings ]   ← top navigation, sticky
├────────────────────────────────────────────┤
│                                            │
│              Tab content                   │
│                                            │
└────────────────────────────────────────────┘
```

Top tab bar (not modal navigation). Tabs are sections toggled by JS; the active tab is
reflected in `location.hash` (`#coach`, `#workouts`, `#settings`) for PWA deep links.

**Kept from WorkoutGenerator (unchanged behavior):** the header **Donate** button opens
the Donate modal (`.donate-btn-header` + `#donateModal`, PayPal form with
`hosted_button_id=RE2GQDK8CD2WW`), and the gear button routes to the Settings tab.
The Donate modal markup, its styles, and the settings donation section are copied
verbatim from WorkoutGenerator `index.html` / `css/style.css` — the modal lives outside
the tab containers so it can open over any tab, exactly as in the original.

### 7.2 Theme (copied exactly from WorkoutGenerator `css/style.css`)

```css
:root {
  --bg-primary: #0F172A;   --bg-secondary: #1E293B;  --bg-tertiary: #334155;
  --primary: #0EA5E9;      --primary-dark: #0284C7;
  --secondary: #22C55E;    --secondary-dark: #16A34A;
  --text-primary: #F8FAFC; --text-secondary: #CBD5E1;
  --border: #475569;       --error: #EF4444;
  --success: #22C55E;      --warning: #F59E0B;
}
```

Also reuse: `.header`, `.btn/.btn-primary/.btn-secondary`, `.workout-card`,
`.stat-box`, `.modal`, `.toast`, `.spinner`, `.select-input`, `.form-group`,
`@media (max-width: 768px)` rules, zone colors for the chart
(`#22c55e #3b82f6 #eab308 #f97316 #ef4444`), plus the donation + install styles
`.donate-btn-header`, `.donation-section`, `.donate-modal-content`,
`.pwa-install-content`, `.pwa-instruction`, `.install-btn-header`
(verbatim — keep the Donate and PWA-install modals working as in WorkoutGenerator).
`theme-color` meta = `#0F172A`.

### 7.3 Tab 1 — AI Coach Chat

- **Message list:** user bubbles (right, `--primary`), coach bubbles (left,
  `--bg-secondary`), streaming support (SSE).
- **Setup-gate banner:** if Settings incomplete (§8.4), a fixed banner above the composer
  lists missing fields with a "Open Settings" button; coach messages from previous
  sessions remain readable.
- **Action cards** rendered from structured blocks (§8.6):
  - *Candidate list:* up to 10 workout cards (name, author, min, zone, TSS, why-fit) →
    tap to open the standard WorkoutGenerator detail modal.
  - *Workout preview:* SVG intensity chart + [Push to Intervals.icu] (two-step:
    preview → confirm).
  - *Missing-info card:* what data is missing and the exact Settings field to fill.
  - *Dossier proposal:* proposed dossier edit with [Approve] / [Reject].
- **Composer:** text input, send on Enter, disabled during stream; shows token-ish
  "reading data…" state when Context Builder runs.

### 7.4 Tab 2 — Workouts (WorkoutGenerator clone)

Port from WorkoutGenerator, then delete the "Surprise Me" button and its handler:

- Filters: Duration (5 options), Workout Type/Zone (dropdown populated from data),
  TSS range (dual slider). Buttons: **Search**, **Reset** (no Surprise Me).
- Card grid → detail modal: name, description, author, category, duration, zone, TSS,
  avg power, **SVG bar-chart intensity visualization** (`UIManager.renderWorkoutIntensity`
  — reuse verbatim), actions:
  - **Download .ZWO** (Blob download) — keep.
  - **Upload to Intervals.icu** — WorkoutGenerator's exact browser method (§10.1).
- Data source: `workout_catalog_summary.json` (local file, ~433 KB, `fields` array +
  row arrays — same deserialization as WorkoutGenerator's catalog code, adapted to the
  compact schema).

### 7.5 Tab 3 — Settings

Sections (same visual structure as WorkoutGenerator's settings modal, inline in tab):

1. **Intervals.icu:** Athlete ID, API key (+ "Validate" button → `GET /athlete/{id}`).
2. **OpenRouter:** API key (+ test call), **Model dropdown** (§8.2).
3. **GitHub:** PAT (+ "Validate" → `GET /repos/{owner}/{repo}`), repo owner/name fields
   (defaults: coach's account / `AI_CyclingCoachPWA`, read-only display).
4. **Data:** [Sync now] (dispatch §9), [Clear cached data], [Refresh app].
5. **Install App:** [Install App] button (`.install-btn-header` green style, shown only
   when the deferred prompt is available / not yet installed) → opens the **PWA Install
   modal** (`#pwaInstallModal`) copied verbatim from WorkoutGenerator: three instruction
   cards — Android (Chrome): menu → "Add to Home Screen"; iOS (Safari): share →
   "Add to Home Screen"; Desktop (Chrome/Edge): install icon in address bar — closed by
   "Got it!" (`app.dismissPwaModal()`). Keep this instructional modal even when the
   native `beforeinstallprompt` flow is unavailable (iOS), so the text always helps.
6. **About:** version, protocol version (Section 11 v11.71).
7. **Support This Project (donation):** WorkoutGenerator's donation section copied
   verbatim (`.donation-section`: heading, "buy me a gel, coffee, or inner tube" text,
   PayPal donate form `hosted_button_id=RE2GQDK8CD2WW`). Last section in Settings.

Note: the note text under credentials must state: *stored on this device only; never
committed to GitHub; never sent to the AI model.*

---

## 8. AI Coach Subsystem

### 8.1 OpenRouter integration (`js/chat.js`)

```
POST https://openrouter.ai/api/v1/chat/completions
Authorization: Bearer <openrouter key>
Content-Type: application/json
HTTP-Referer: <app origin>          # OpenRouter etiquette
X-Title: AI Cycling Coach
Body: { "model": "<selected id>", "messages": [...], "stream": true, "temperature": 0.3 }
```

- Streaming SSE into the message list; abort button; on HTTP 402/429 → toast
  "free-model rate limit — try another model" and keep the user message in the input.
- Retry once with the same model, then fail gracefully. Never auto-switch model
  mid-conversation without telling the user.
- System prompt: `AI_PROMPTS.md` §A, rendered with placeholders (§8.3).

### 8.2 Free-model dropdown (Settings)

1. `GET https://openrouter.ai/api/v1/models` (no auth required, CORS-enabled).
2. Filter: `pricing.prompt === "0" && pricing.completion === "0"` **or**
   `id` ends with `:free`.
3. Sort by context length desc; label `name (ctx)`.
4. Cache in `localStorage` `coach.models.v1` for 24 h; on fetch failure show cached list;
   if empty show a static fallback list (refresh manually when it rots).
5. Never hardcode the model list as the only source — free-tier availability changes
   weekly. Keep last-known-good selection as default.

### 8.3 Context Builder (`js/context.js`)

The model never reads raw files. The app assembles context deterministically:

| Tier | Contents | Budget |
|---|---|---|
| **0 (always)** | date/time/timezone, athlete ID, settings status, memory summary (§11), current tab | — |
| **1 (always)** | `latest.json` slices: `metadata`, `READ_THIS_FIRST.quick_stats`, `readiness_decision`, `health_context` (full), `summary`, `weekly_summary`, key `derived_metrics` (ACWR start-of-day, TSB/CTL/ATL, capability trend), next planned events, `athlete_profile` (age/sex/height/FTP only), Dossier (full, if exists) | ≤ 6 000 tokens |
| **2 (on demand)** | `history`, `intervals`, `routes`, `saved_workouts`, `ftp_history` slices — loaded when intent matches (trend/interval/terrain/saved/threshold keywords or when Tier 1 `has_*` flags are true) | ≤ 8 000 tokens each |
| **3 (on demand)** | `Skills/*.md` (lazy, via GitHub Contents API, cached 24 h), `WORKOUT_REFERENCE.md` (fetched from section-11 raw URL before any prescription) | on demand |

Rules:

- Every Tier-1/2 injection carries `data_freshness: {file, last_updated}`. The prompt
  (Part A) forbids citing numbers whose file was not injected this turn.
- Truncation is explicit: inject `"truncated": true` sections rather than silently
  cutting.
- `workout_catalog_summary.json` is **never** injected whole. The model requests it via
  the `workout_search` block (§8.6) and receives ≤ 10 rows.
- `READ_THIS_FIRST` prose (2 000+ chars) is **not** injected — it is instructions for
  external chat AIs; this app encodes those rules in the system prompt.

### 8.4 Settings gate (deterministic, not model-driven)

Before every request, `validateSettings()` checks: Athlete ID, Intervals key,
OpenRouter key, model id, GitHub PAT.

- **Incomplete** → the app does not call the model for coaching intent. It renders the
  *Missing-info card* in chat:

  ```
  Setup incomplete — I can't coach yet. Missing in Settings:
  • OpenRouter API Key  → Settings ▸ OpenRouter
  • GitHub token        → Settings ▸ GitHub
  (entered: Athlete ID i123456, Intervals key)
  ```

  Data is still shown read-only if it exists locally.
- **Complete but dossier missing/empty** → model may answer general questions; the first
  coaching request triggers the Dossier interview (§8.5) instead of advice.
- **Complete + dossier present but `_latest.json` older than 48 h** → inject a staleness
  banner into context; the app auto-dispatches a sync (§9) and informs the coach.

### 8.5 Dossier intake (initial setup interview)

Trigger: first run after Settings validate, or first coaching request with no
`<ID>_dossier.md`.

- The app switches chat to **interview mode**: renders one question card at a time,
  derived from `Documents/DOSSIER_TEMPLATE.md` (Section 11 v2.1.0), reduced to the
  material subset:
  1. Name/alias, age/birth year, sex, height, home region
  2. Primary goal + target date + priority; what a successful season means
  3. Health: recurring issues/injuries, medication, allergies (optional, athlete may skip)
  4. Fueling: tested drink/food per session type (optional)
  5. Availability: typical days, session window, indoor/outdoor, preferred rest day
  6. Equipment that changes prescription (trainer, power meter) + terrain
  7. Coaching preferences: tone, answer shape, risk tolerance, role of RPE
- Answers are stored as structured JSON in the app, serialized to
  `Users/<ID>/<ID>_dossier.md` with the authority header (revision, last-reviewed date)
  and committed via Contents API.
- "Skip all remaining" always available → dossier saved with skipped sections marked
  `[not provided]`; coaching proceeds with a reduced-personalization caveat.
- Later changes: coach proposes via `dossier_update` block → Approve/Reject card
  (Section 11's propose-and-approve rule, enforced in app code).

### 8.6 Structured output contract (model → app)

Free models cannot be trusted with tool-calling APIs. The system prompt requires fenced
JSON blocks; the app parses them deterministically.

**Block types:**

````markdown
```workout_search
{"intent":"VO2 max intervals","zones":[5],"duration_min":45,"duration_max":75,
 "tss_min":60,"tss_max":140,"category_keywords":["VO2"],"limit":8}
```
```workout_push
{"workout_id":"workout_0546","date":"2026-10-18","reason":"matches prescription"}
```
```dossier_update
{"section":"goals","current":"...","proposed":"...","why":"..."}
```
````

**App-side parsing rules:**

1. Extract the last complete block per turn. Malformed JSON → one repair turn:
   `"<block> failed to parse: <error>. Re-emit the corrected block only."`
   then give up and render a natural-language answer (log `parse_failure`).
2. `workout_search` → app filters `workout_catalog_summary.json` locally, injects
   `candidates: [{id,name,author,minutes,zone,tss,description,file}]` (≤ 10) as a new
   user-role message labeled `TOOL_RESULT`, coach replies with recommendation text.
3. `workout_push` → app opens the preview card (fetch the `.zwo` from the upstream
   WorkoutGenerator raw URL, render SVG chart). **No push without explicit user tap on
   Confirm** (mirrors Section 11's preview→approve rule).
4. Blocks are never executed if the settings gate (§8.4) is failing.

### 8.7 Skills loading

`Skills/*.md` fetched on demand through the GitHub Contents API (PAT), base64-decoded,
cached in `Cache Storage` for 24 h. Load rules follow the skill headers:
`workout-catalog.md` when a `workout_search` is pending, `workout-agent.md` when the
catalog has no fit, `health-context.md` when `health_context.clarification_required`
is true, `phenotype-agent.md` on phenotype questions, `interval-analysis.md` when the
question concerns interval compliance / DFA a1.

`Skills/interval-analysis.md` must have its UTF-8 BOM stripped (currently starts with
`EF BB BF`, which makes tooling treat it as binary).

### 8.8 Recommended-workout flow (end to end)

1. Coach reads Tier 1 (+ Tier 2 as needed) and applies Section 11 readiness/health gates.
2. Coach emits `workout_search` with the prescription intent.
3. App filters the catalog summary, returns candidates.
4. Coach replies: prescription summary + ≤ 4 shortlisted candidates with id, name,
   minutes, zone, TSS, reason. It may fetch 1–2 `.zwo` files and verify steps against
   `WORKOUT_REFERENCE.md` (instructed by `workout-catalog.md`).
5. User taps a candidate → WorkoutGenerator detail modal (SVG chart).
6. **Push to Intervals.icu** → §10.1 (browser, direct) or §10.2 (Action, for calendar
   ops). Two-step confirm in both cases.

### 8.9 Data-discipline enforcement (code, not prompt)

- `assertFresh(fileKey)` — blocks numbers from files not loaded this turn.
- `metadata.last_updated` > 48 h → staleness banner + auto-sync dispatch.
- Offline: serve cached JSON but mark every answer with `data_freshness` age.

---

## 9. Data Sync (on launch + manual)

### 9.1 Sequence

```
App launch
 ├─ 1. read localStorage settings → gate (§8.4)
 ├─ 2. GET Users/<ID>/<ID>_latest.json via Contents API (If-None-Match etag)
 │      → render instantly, chip = "syncing…" if stale >30 min
 ├─ 3. GET Users/<ID>/<ID>_memory.json → hydrate memory (§11)
 ├─ 4. POST /repos/{owner}/{repo}/actions/workflows/sync-intervals.yml/dispatches
 │      { ref: "main", inputs: { athlete_id, intervals_key } }
 │      → chip = "syncing…"   (silent failure tolerated: cached data still valid)
 └─ 5. poll GET /repos/.../actions/runs?per_page=1  every 5 s, max 90 s
        → on completed: re-GET _latest.json (etag) → chip = "fresh"
        → on failure/skip: chip = "stale — tap to retry", toast with run URL
```

### 9.2 Dispatch payload

```json
{
  "ref": "main",
  "inputs": {
    "athlete_id": "i123456",
    "intervals_key": "<from device, masked in run>"
  }
}
```

### 9.3 Required modifications to `sync-intervals.yml`

| Change | Detail |
|---|---|
| Remove `schedule:` cron | Multi-athlete + no keys in repo ⇒ sync is **dispatch-only** (on launch / "Sync now"). Optionally keep a cron for the coach's own data behind repo secrets `ATHLETE_ID`/`INTERVALS_KEY` — documented, default off. |
| Add `workflow_dispatch.inputs` | `athlete_id` (string, required), `intervals_key` (string, required) |
| Mask first | `echo "::add-mask::${ATHLETE_ID}"` + same for key, before any other step |
| Per-athlete concurrency | `concurrency.group: sync-${{ inputs.athlete_id }}`, `cancel-in-progress: false`, `queue: max` |
| Run | `python sync.py --athlete-id "$ATHLETE_ID" --intervals-key "$INTERVALS_KEY" --days 7 --output latest.json` (cwd outputs unchanged) |
| Move + rename | move the six JSONs into `Users/<ID>/<ID>_<name>.json` (§5), `mkdir -p` first |
| Commit | `git add Users/<ID>` **only** (never `git add -A` — avoids stray files), message `sync <ID> [skip ci]` |
| Verify | fail if any of the six files is missing after the move |

`refresh-workout-catalog.yml`: unchanged (runs `generate_workout_catalog_summary.py`,
commits `workout_catalog_summary.json`).

`push-workout.yml`: add the same `athlete_id`/`intervals_key` inputs + mask; replace
`secrets.ATHLETE_ID`/`secrets.INTERVALS_KEY` usage with inputs. Used for calendar ops
(list/move/delete/set-threshold/annotate) initiated from the chat.

---

## 10. Workout Push to Intervals.icu

### 10.1 Primary path — browser, WorkoutGenerator's exact working method

Reuse `js/api.js` `ApiManager.uploadToIntervals()` verbatim (this is the method proven
working in WorkoutGenerator):

```
GET  https://raw.githubusercontent.com/JC-Concepts/WorkoutGenerator/main/workouts/<file>
     → .zwo/.xml text content
POST https://intervals.icu/api/v1/athlete/<athleteId>/events
     Authorization: Basic base64("API_KEY:" + apiKey)
     Content-Type: application/json
     {
       "start_date_local": "YYYY-MM-DDT00:00:00",
       "category": "WORKOUT",
       "type": "Ride",
       "name": "<file name without .zwo>",
       "description": "Uploaded from <file>",
       "indoor": true,
       "filename": "<file.zwo>",
       "file_contents_base64": base64UTF8(content),
       "tss": <optional, from summary>
     }
```

- `file_contents_base64` uses the UTF-8-safe encoding from WorkoutGenerator:
  `btoa(unescape(encodeURIComponent(content)))`.
- Validation call reuse: `GET /athlete/{id}` with header `Authorization: ApiKey <key>:`
  (WorkoutGenerator's `validateApiKey`).
- Two-step: detail modal → confirm dialog showing date + name → POST → toast success
  with the Intervals event link. Date defaults to today, editable.

### 10.2 Secondary path — GitHub Action (calendar ops / AI-initiated)

Dispatch `push-workout.yml` with `command=push-catalog-workout`,
`catalog_workout_id`, `catalog_version` (= summary `source_version`),
`date`, `confirm=false` → read run log preview → re-dispatch with `confirm=true`.
This preserves `push_catalog_workout.py`'s stale-catalog guard (`source_version` check)
and push.py's preview-first philosophy. Use it when the coach chat schedules a workout
for a future date; use §10.1 for immediate pushes from the Workouts tab.

---

## 11. Memory System

**File:** `Users/<ID>/<ID>_memory.json`

```json
{
  "version": 1,
  "athlete_id": "i123456",
  "updated_at": "2026-10-15T18:00:00Z",
  "session_count": 12,
  "summary": { "standing_topics": ["FTP test scheduled 10/26"], "coach_notes": "…" },
  "messages": [ { "role": "user|assistant", "ts": "…", "text": "…", "turn_id": "…" } ]
}
```

**Lifecycle:**

1. **Launch:** `GET` the file (etag) → hydrate `localStorage coach.memory.v1`; snapshot
   `last_pushed_hash` from the fetched content.
2. **Working set:** every turn appends to localStorage. A **15-minute timer** flushes to
   GitHub, and `pagehide`/`visibilitychange:hidden` triggers one last flush
   (`fetch(…, {keepalive:true})`).
3. **Diff guard (mandatory):** before any flush, compare a content hash of the working
   set (`SHA-256` over the serialized `messages` + `summary`, via `crypto.subtle`)
   against `last_pushed_hash`. **No diff → skip the API call entirely** (no commit, no
   empty `PUT`). Only when the hash differs is a push issued; on success store the new
   hash. This keeps idle sessions from writing no-op commits every 15 minutes.
4. **Commit:** Contents API `PUT /repos/{o}/{r}/contents/Users/<ID>/<ID>_memory.json`
   with `{message: "memory <ID> [skip ci]", content: b64, sha}`. The `[skip ci]` marker
   plus the deploy path filter (§3) keeps memory commits from triggering Actions or a
   static-host redeploy. On **409** → re-GET, merge (union by `turn_id`, keep newest
   `summary`), retry once; on second 409 → queue and retry next flush. Never
   `--force`/overwrite blindly.
5. **Offline:** queue flushes in localStorage `coach.memory.pending`; retry on next
   launch/online event. The diff guard still applies when the queue drains.
6. **Size policy:** keep last 40 turns verbatim + `summary`; older turns collapse into
   `summary` (app-side compaction, not model-side, to avoid drift). Cap 200 KB; on
   overflow drop oldest turns first, never `summary`.

**Boundary:** memory supplies continuity (topics, preferences, decisions) — it is *never*
a source of training numbers (data discipline rule, Part A §4).

---

## 12. Onboarding and First Run

```
First launch
 ├─ no settings → Settings tab opens with "Setup required" banner
 ├─ user fills: Athlete ID · Intervals key · OpenRouter key · PAT · model
 ├─ Validate all three APIs (parallel):
 │    Intervals  GET /athlete/{id}                     → 200
 │    OpenRouter POST /chat/completions (1-token ping) → 200
 │    GitHub     GET /repos/{owner}/{repo}             → 200
 ├─ ensure user folder: PUT Users/<ID>/.gitkeep (create if 404)
 ├─ dispatch first sync (§9) — chip "syncing"
 ├─ when _latest.json lands → Dossier interview (§8.5)
 └─ ready → chat shows greeting + data summary card
```

Returning users: cached settings → cached data render → background sync → chat ready.
"Clear cached data" wipes localStorage except settings (separate button for that).

---

## 13. Multi-user Scalability

- **Isolation:** folder-per-athlete; every operation is keyed by the device's stored
  Athlete ID. App never lists `Users/` (no discovery).
- **Actions load:** one ~1 min sync run per launch per athlete. 20 athletes × 3
  launches/day ≈ 60 min/day ≈ 1 800 min/month — over the 2 000 free private-repo
  allowance. Mitigations: dispatch only when data is stale (skip if `< 30 min`), coalesce
  concurrent dispatches (in-app), keep the app open ≠ repeated launches.
- **PAT issuance runbook (coach):** GitHub → Settings → Developer settings → Fine-grained
  tokens → new token, repo `AI_CyclingCoachPWA`, Contents R/W + Actions R/W, 90-day
  expiry → hand to athlete (password manager / in person) → athlete pastes into Settings.
- **Revocation:** delete token on GitHub; athlete's app degrades to read-cached-only
  until a new token is entered. Runbook documented in `Documents/SETUP.md`.
- **Trust model:** athletes can technically read others' folders with a valid PAT
  (accepted; see §6.2). **Upgrade path:** template-repo fork per athlete — the only
  structural change is `REPO_NAME`/`REPO_OWNER` becoming per-device settings (the app
  already stores them), so the fork model is a config change, not a rewrite.

---

## 14. Reuse Map

| Source | Target | Action |
|---|---|---|
| WorkoutGenerator `css/style.css` | `css/style.css` | copy + add chat/tab styles; keep tokens identical |
| WorkoutGenerator `js/api.js` | `js/api.js` | copy + extend (`GitHubApi`, `OpenRouterApi`); keep `uploadToIntervals` verbatim |
| WorkoutGenerator `js/storage.js` | `js/storage.js` | copy + add settings/memory/model keys |
| WorkoutGenerator `js/ui.js` | `js/ui.js` | copy incl. `renderWorkoutIntensity` SVG; add chat renderers |
| WorkoutGenerator `js/app.js` | `js/app.js` | copy; remove `surpriseMe()`; add tab routing + launch flow |
| WorkoutGenerator `index.html` | `index.html` | copy; replace search/results with 3 tabs; **keep verbatim**: workout detail modal, Donate modal (`#donateModal`), PWA-install modal (`#pwaInstallModal`), header Donate button, settings donation section, `#toast` |
| WorkoutGenerator `sw.js`, `pwa-manifest.json`, `assets/icons/` | same | copy; fix name, `start_url`/`scope` to relative/own host |
| Workspace `sync.py`, `push.py`, `push_catalog_workout.py`, `generate_workout_catalog_summary.py` | repo root | keep unmodified (upstream engines) |
| Workspace `Skills/*.md` | `Skills/` | keep; strip BOM from `interval-analysis.md` |
| Workspace `.github/workflows/*` | same | apply §9 modifications |
| Section 11 `DOSSIER_TEMPLATE.md` v2.1.0 | `Documents/DOSSIER_TEMPLATE.md` | adapt: drop external-path sections, keep authority block + profile/goals/health/fuel/availability/prefs tables |
| `MISTRAL_INSTRUCTIONS_SHORT.md` | `Documents/AI_PROMPTS.md` §A | salvage: source hierarchy, data discipline, health gate, workout push rules — then delete file |
| `SETUP_NOTES.md` | `Documents/SETUP.md` | rewrite for PWA + PAT + per-athlete layout |

---

## 15. Build Roadmap

Each phase ends with its verification gate. Do not start a phase before the gate passes.

**Phase 0 — Feasibility probes (no app code)**
- Verify from a browser console on a throwaway page: Intervals.icu CORS (GET
  `/athlete/{id}` + POST `/events`), `api.github.com` CORS, `openrouter.ai` CORS,
  `raw.githubusercontent.com` CORS. WorkoutGenerator proves Intervals+raw; GitHub and
  OpenRouter must be confirmed.
- Create repo `AI_CyclingCoachPWA` (private), `git init`, `.gitignore` (§4).
- Gate: all four probes green; repo exists.

**Phase 1 — Shell + Workouts tab**
- Port WorkoutGenerator (§14), strip Surprise Me, add 3-tab shell + hash routing + theme.
- Keep the header Donate button + Donate modal and the Settings "Install App" button +
  PWA-install instructions modal (`#pwaInstallModal`) working as in WorkoutGenerator.
- Gate: Workouts tab identical in look/behavior to WorkoutGenerator; download + upload
  to Intervals work from the new host; Donate modal opens from the header and Settings
  donation section renders; PWA-install instructions modal opens from Settings; PWA
  installs on Android + iOS.

**Phase 2 — Settings + secrets**
- Five fields, validation calls, `coach.settings.v1`, gate banner component.
- Gate: incomplete settings render the missing-info card in chat tab; all three API
  validations succeed; secrets absent from `git status` and any log.

**Phase 3 — Sync**
- Modify `sync-intervals.yml` per §9.3; implement launch sequence + chip state machine.
- Gate: cold launch → dispatched run → six renamed files land in `Users/<ID>/` → chip
  "fresh"; second launch skips dispatch if `< 30 min` old.

**Phase 4 — Chat + Context Builder + Dossier**
- `context.js`, `chat.js` (SSE), system prompt from `AI_PROMPTS.md` §A, settings gate,
  interview mode, memory hydration.
- Gate: "What's my readiness today?" returns a P0–P3 answer citing injected values only;
  missing-settings test blocks coaching; dossier interview produces
  `Users/<ID>/<ID>_dossier.md`.

**Phase 5 — Recommendation + push + memory flush**
- `workout_search`/`workout_push` parsing, candidate cards, preview push (§10.1),
  Action path (§10.2), memory commit (§11).
- Gate: end-to-end — chat recommends → card → SVG chart → confirm → event appears in
  Intervals.icu calendar; memory file appears in the repo after a 15-minute flush and
  **no commit is created when nothing changed** (verify two idle intervals = one commit).

**Phase 6 — Hardening + docs**
- XSS audit (§6.3), offline test, `Documents/SETUP.md` finalized, stale-model fallback,
  quota monitoring notes.
- Gate: no credential in repo history (`git log -p` grep for the three keys), Lighthouse
  PWA ≥ 90, README quick-start works on a clean device.

---

## 16. Risks and Decision Log

| # | Decision / Risk | Resolution |
|---|---|---|
| D1 | Repo model | One shared private repo, `Users/<AthleteID>/` folders |
| D2 | GitHub access | Coach-only account; fine-grained PAT provisioned per device (§6.2) |
| D3 | Hosting | External static host; deploy app assets only (§3) — GitHub Pages on a private repo is invisible to non-repo readers, so it cannot serve athletes |
| D4 | Repo name | `AI_CyclingCoachPWA` (old `AI_CyclingCoach` retired — purge stale references) |
| D5 | Docs | `ARCHITECTURE.md` + `AI_PROMPTS.md` (this pair) |
| R1 | Sync dispatch inputs visible in run payload | Only coach has repo read access; still `::add-mask::` + never echo (§6.4) |
| R2 | PAT = repo-wide read | Accepted; fork path exists (§13) |
| R3 | Dispatch→commit latency 30–60 s | Cached-first render + chip state machine (§9) |
| R4 | Free model list rots | Live fetch + 24 h cache + fallback (§8.2) |
| R5 | Free models: weak tool-calling | Fenced-JSON block contract + one repair turn (§8.6) |
| R6 | Actions quota (2 000 min/mo) | Stale-only dispatch, per-athlete coalescing (§13) |
| R7 | intervals.icu CORS assumed (proven by WorkoutGenerator) | Phase 0 probe before build |
| R8 | `sync.py`/`push.py` edits would be overwritten by upstream `--update` | Never edit; workflow moves/renames outputs instead (§5, §9.3) |
| R9 | Catalog summary 433 KB too large for prompts | Never injected; `workout_search` tool (§8.6) |
| R10 | `interval-analysis.md` UTF-8 BOM | Strip in Phase 1 (§8.7) |
