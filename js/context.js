/**
 * context.js - Context Builder. Selects and trims athlete data (Tier 1) so the
 * model receives a bounded payload. The raw 433 KB catalog and unbounded history
 * are NEVER passed through here whole.
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

    var TIER2_FILES = [
        { key: 'history.json', option: 'history', intent: /phenotype|trend|history|power[\s-]?duration|power curve|fitness progression/i },
        { key: 'intervals.json', option: 'intervals', intent: /phenotype|interval|dfa|power[\s-]?duration|ride analysis/i },
        { key: 'routes.json', option: 'routes', intent: /phenotype|route|terrain|event course/i },
        { key: 'saved_workouts.json', option: 'savedWorkouts', intent: /saved workouts?|already saved/i },
        { key: 'ftp_history.json', option: 'ftpHistory', intent: /phenotype|ftp|threshold|power curve/i }
    ];

    function sliceLatest(latest, includePhenotypeData) {
        if (!latest || typeof latest !== 'object') return null;
        var keys = includePhenotypeData
            ? LATEST_KEYS.concat(['current_status', 'recent_activities', 'history', 'workout_summary_stats'])
            : LATEST_KEYS;
        var sliced = pick(latest, keys);
        var quick = (latest.READ_THIS_FIRST && latest.READ_THIS_FIRST.quick_stats) || latest.quick_stats;
        if (quick) sliced.quick_stats = quick;
        return sliced;
    }

    function trimJSON(obj, maxChars) {
        if (obj == null) return '';
        var s = JSON.stringify(obj, null, 1);
        if (s.length <= maxChars) return s;

        var copy = JSON.parse(JSON.stringify(obj));
        var omitted = 0;
        function largestArray(node, result) {
            if (!node || typeof node !== 'object') return;
            if (Array.isArray(node)) {
                if (node.length > result.length) result.array = node, result.length = node.length;
                node.forEach(function (item) { largestArray(item, result); });
            } else {
                Object.keys(node).forEach(function (key) { largestArray(node[key], result); });
            }
        }

        var dataText = JSON.stringify(copy, null, 1);
        while (dataText.length > maxChars - 100) {
            var result = { array: null, length: 0 };
            largestArray(copy, result);
            if (!result.array || !result.array.length) break;
            var removeCount = Math.max(1, Math.ceil(result.array.length / 10));
            result.array.splice(0, removeCount);
            omitted += removeCount;
            dataText = JSON.stringify(copy, null, 1);
        }
        if (dataText.length > maxChars - 100) {
            var preview = dataText.slice(0, Math.max(0, maxChars - 500));
            var previewText = '';
            do {
                previewText = JSON.stringify({
                    truncated: true,
                    omitted_items: omitted,
                    preview: preview
                }, null, 1);
                if (previewText.length <= maxChars) break;
                preview = preview.slice(0, Math.max(0, preview.length - 100));
            } while (preview.length);
            return previewText;
        }
        return JSON.stringify({ truncated: true, omitted_items: omitted, data: JSON.parse(dataText) }, null, 1);
    }

    function selectHistory(messages, maxTokens) {
        var budget = Math.max(0, Number(maxTokens) || CONFIG.contextTier2Tokens || 8000);
        var selected = [];
        var used = 0;
        var list = Array.isArray(messages) ? messages : [];
        for (var i = list.length - 1; i >= 0; i--) {
            var message = list[i] || {};
            var text = String(message.text || '');
            var cost = estimateTokens(text);
            if (cost <= budget - used) {
                selected.unshift({ role: message.role, text: text });
                used += cost;
                continue;
            }
            if (!selected.length && budget > 0) {
                var maxChars = budget * 4;
                selected.unshift({
                    role: message.role,
                    text: text.slice(-maxChars)
                });
            }
            break;
        }
        return selected;
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
            'latest.json': opts.latest || null,
            'history.json': opts.history || null,
            'intervals.json': opts.intervals || null,
            'routes.json': opts.routes || null,
            'saved_workouts.json': opts.savedWorkouts || null,
            'ftp_history.json': opts.ftpHistory || null
        };

        var warnings = [];
        var freshness = buildFreshness(files, nowMs);
        var intent = String(opts.intent || '');
        var phenotypeRequest = /\bphenotyp(e|ic)\b/i.test(intent);
        var available = [];
        var injectedFiles = [];

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

        Object.keys(files).forEach(function (name) {
            available.push(name + ': ' + (files[name] ? 'cached' : 'not cached'));
        });
        parts.push('\n-- Available athlete files --');
        available.forEach(function (entry) { parts.push(entry); });

        var sliced = sliceLatest(files['latest.json'], phenotypeRequest);
        if (sliced) {
            injectedFiles.push('latest.json');
            parts.push(phenotypeRequest
                ? '\n-- Latest data (Tier 1; phenotype sources) --'
                : '\n-- Latest data (Tier 1) --');
            parts.push(trimJSON(sliced, phenotypeRequest ? CONFIG.contextTier2Tokens * 4 : 6000));
        } else {
            parts.push('\n-- Latest data --\n(none cached; prompting sync)');
        }

        TIER2_FILES.forEach(function (file) {
            if (!(phenotypeRequest || file.intent.test(intent)) || !files[file.key]) return;
            injectedFiles.push(file.key);
            parts.push('\n-- ' + file.key + ' (Tier 2) --');
            parts.push(trimJSON(files[file.key], CONFIG.contextTier2Tokens * 4));
        });

        var injectedFreshness = freshness.filter(function (file) {
            return injectedFiles.indexOf(file.name) >= 0;
        });
        injectedFreshness.forEach(function (file) {
            if (file.stale) warnings.push(file.name + ' data is stale (' + file.age_hours + 'h old)');
        });
        if (injectedFreshness.length) {
            parts.push('\n-- Data freshness --');
            injectedFreshness.forEach(function (file) {
                parts.push(file.name + ': ' + file.last_updated + (file.stale ? '  [STALE]' : ''));
            });
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
        selectHistory: selectHistory,
        LATEST_KEYS: LATEST_KEYS,
        TIER2_FILES: TIER2_FILES
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.CoachContext = api;
})();
