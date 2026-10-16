# Skill: Health Context

Load when `latest.json` has `health_context.clarification_required: true`.

Severity assessment (ask athlete): symptoms, duration, impact on sleep/appetite/HR, medication/allergies (check DOSSIER.md), recent history (check `history.json`).

Rules by severity: Severe (fever >100.4F, significant fatigue, acute pain) = Skip, no modification. Moderate (mild symptoms, no fever, some fatigue) = may modify (reduce intensity/duration) or Skip based on preference and DOSSIER.md. Minor (slight congestion, no impact on sleep/HR) = session may proceed as written or with minor adjustments; confirm with athlete.

Calendar markers: `current` = active illness/injury, must address. `recent` with none `current` = marking stopped, not recovery, ask if resolved. `partial` = health markers could not be fully checked, confirm relevance.

Interaction with Skip: Health marker does NOT override Skip. Health marker does NOT relax Skip. If Skip exists and health marker is current: maintain Skip; address health separately.

Documentation: Cite framework per Section 11 protocol checklist #10. Every assessment from athlete clarification + JSON; no inference from memory. Propose session modification clearly: original plan, proposed change, reason, athlete approval required.
