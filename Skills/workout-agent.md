# Skill: Workout Agent (Ported from AI_Coach)

Purpose: Generate structured workout descriptions and `.zwo`-compatible structures based on athlete load, phase, and available time.

When to load: Athlete asks for new/recommended workout; `workout-catalog.md` doesn't have a suitable match; or athlete wants custom structure.

Inputs (from `latest.json` / `history.json`):
- Current zones (FTP, indoor FTP, LTHR, max HR)
- Weekly load (CTL, ATL, TSB, ACWR)
- Phase (build, peak, recovery, base)
- Recent ride quality / compliance
- Planned event terrain (`routes.json` if `has_terrain: true`)
- Athlete profile / constraints (`DOSSIER.md`)

Generation rules (from `workout_agent.py`):
- Adaptive based on load/feedback: if ACWR > 1.3 or TSB very negative, reduce intensity or duration
- Never exceed safe thresholds: respect health/medication context from DOSSIER.md
- Verify against `WORKOUT_REFERENCE.md` template before prescribing; identify template ID
- If no template match: say so — do not improvise structure
- Format segments: duration (seconds/minutes), power (% FTP or zone), zone, type (Warmup, SteadyState, Interval, Cooldown)
- Include total duration, estimated TSS, target zone, and a description suitable for the app's browser-to-Intervals.icu upload flow
- Use cached Intervals.icu data (from `latest.json`) to avoid redundant calculations

Output format (ready for the PWA workout preview):
- name, date, type (Ride/Run), description (structured with segments), duration_minutes, tss, target (POWER/HR)

Reference: `workout_agent.py` (AI_Coach/skills/) — adaptive based on load/feedback; uses cached Intervals.icu data.
