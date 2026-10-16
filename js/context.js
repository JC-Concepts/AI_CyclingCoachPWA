/**
 * context.js - Context Builder. Selects and trims athlete data (Tier 1) so the
 * model receives a bounded payload. The raw 433 KB catalog and full history are
 * NEVER passed through here whole.
 * Dual-export; pure functions.
 */
'use strict';

(function () {
    var cfg = (typeof module !== 'undefined' && module.exports)
        ? require('./config.js').CONFIG
        : (typeof window !== 'undefined' ? window.CONFIG : null);
    var CONFIG = cfg || { dataStaleMs: 48 * 3600 * 1000, contextTier1Tokens: 6000 };

    function estimateTokens(s) {
        return Math.ceil(String(s || '').length / 4);
    }

    function parseTime(v) {
        if (v == null) return null;
        if (typeof v === 'number') return v;
        var t = Date.parse(v);
        return isNaN(t) ? null : t;
    }

    function pick(obj, keys) {
        var out = {};
        if (!obj) return out;
        keys.forEach(function (k) { if (obj[k] !== undefined) out[k] = obj[k]; });
        return out;
    }

    // Tier 1 (always) top-level keys from latest.json and friends.
    var LATEST_KEYS = [
        'metadata', 'readiness_decision', 'health_context', 'summary',
        'weekly_summary', 'athlete_profile', 'planned_events', 'derived_metrics'
    ];

    function sliceLatest(latest) {
        if (!latest || typeof latest !== 'object') return null;
        var sliced = pick(latest, LATEST_KEYS);
        var quick = (latest.READ_THIS_FIRST && latest.READ_THIS_FIRST.quick_stats) || latest.quick_stats;
        if (quick) sliced.quick_stats = quick;
        return sliced;
    }

    function trimJSON(obj, maxChars) {
        if (obj == null) return '';
        var s = JSON.stringify(obj, null, 1);
        if (s.length > maxChars) s = s.slice(0, maxChars) + '\n\u2026 [truncated]';
        return s;
    }

    function buildFreshness(files, nowMs) {
        var now = nowMs || Date.now();
        var rows = [];
        Object.keys(files || {}).forEach(function (name) {
            var f = files[name];
            var ts = null;
            if (f && f.metadata) ts = parseTime(f.metadata.last_updated || f.metadata.last_sync);
            if (ts == null && f) ts = parseTime(f.last_updated);
            if (ts == null) return;
            var ageMs = now - ts;
            rows.push({
                name: name,
                last_updated: new Date(ts).toISOString(),
                age_hours: Math.round(ageMs / 3600000 * 10) / 10,
                stale: ageMs > CONFIG.dataStaleMs
            });
        });
        return rows;
    }

    /**
     * Build the model context.
     * @returns {{systemVars, dataMessage, freshness, warnings, meta}}
     */
    function buildContext(opts) {
        opts = opts || {};
        var settings = opts.settings || {};
        var nowMs = opts.now instanceof Date ? opts.now.getTime() : (opts.now || Date.now());
        var nowIso = new Date(nowMs).toISOString();

        var files = {
            latest: opts.latest || null,
            intervals: opts.intervals || null,
            routes: opts.routes || null,
            saved_workouts: opts.savedWorkouts || null,
            ftp_history: opts.ftpHistory || null
        };

        var warnings = [];
        var freshness = buildFreshness(files, nowMs);
        freshness.forEach(function (f) { if (f.stale) warnings.push(f.name + ' data is stale (' + f.age_hours + 'h old)'); });

        var memSummary = '';
        if (opts.memory && opts.memory.summary) {
            var s = opts.memory.summary;
            var topics = Array.isArray(s.standing_topics) ? s.standing_topics.join('; ') : (s.standing_topics || '');
            var notes = s.coach_notes || '';
            memSummary = [topics, notes].filter(Boolean).join(' | ');
        }

        var dossierState = 'No dossier yet.';
        if (opts.dossier) dossierState = String(opts.dossier).slice(0, 1500);

        var systemVars = {
            DATETIME: nowIso,
            TZ: opts.timezone || (Intl.DateTimeFormat && Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC',
            ATHLETE_ID: settings.athleteId || 'unknown',
            MEMORY_SUMMARY: memSummary || '(empty)',
            DOSSIER_STATE: dossierState
        };

        var parts = [];
        parts.push('=== ATHLETE: ' + systemVars.ATHLETE_ID + ' ===');
        parts.push('Now: ' + nowIso + ' (' + systemVars.TZ + ')');

        if (freshness.length) {
            parts.push('\n-- Data freshness --');
            freshness.forEach(function (f) {
                parts.push(f.name + ': ' + f.last_updated + (f.stale ? '  [STALE]' : ''));
            });
        }

        var sliced = sliceLatest(files.latest);
        if (sliced) {
            parts.push('\n-- Latest data (Tier 1) --');
            parts.push(trimJSON(sliced, 6000));
        } else {
            parts.push('\n-- Latest data --\n(none cached; prompting sync)');
        }

        if (opts.savedWorkouts && opts.savedWorkouts.workouts) {
            parts.push('\n-- Saved workouts (recent) --');
            var recent = opts.savedWorkouts.workouts.slice(-20);
            parts.push(trimJSON(recent, 2500));
        }

        if (files.ftp_history) {
            parts.push('\n-- FTP history (recent) --');
            var fh = Array.isArray(files.ftp_history) ? files.ftp_history.slice(-12) : files.ftp_history;
            parts.push(trimJSON(fh, 1500));
        }

        if (warnings.length) {
            parts.push('\n-- Warnings --');
            warnings.forEach(function (w) { parts.push('\u26a0 ' + w); });
        }

        var dataMessage = parts.join('\n');
        var tier1Tokens = estimateTokens(dataMessage);
        if (tier1Tokens > CONFIG.contextTier1Tokens) {
            warnings.push('Tier 1 context is large (' + tier1Tokens + ' tokens)');
        }

        return {
            systemVars: systemVars,
            dataMessage: dataMessage,
            freshness: freshness,
            warnings: warnings,
            meta: { tier1Tokens: tier1Tokens, now: nowIso }
        };
    }

    var api = {
        estimateTokens: estimateTokens,
        parseTime: parseTime,
        sliceLatest: sliceLatest,
        buildFreshness: buildFreshness,
        buildContext: buildContext,
        LATEST_KEYS: LATEST_KEYS
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.CoachContext = api;
})();
