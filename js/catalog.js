/**
 * catalog.js - normalizes and filters the WorkoutGenerator catalog summary.
 * The 433 KB catalog is NEVER injected whole; only these normalized candidate
 * rows (a handful) reach the model.
 * Dual-export; pure functions.
 */
'use strict';

(function () {
    var cfg = (typeof module !== 'undefined' && module.exports)
        ? require('./config.js').CONFIG
        : (typeof window !== 'undefined' ? window.CONFIG : null);
    var DEFAULT_LIMIT = (cfg && cfg.catalogCandidateLimit) || 10;

    var KNOWN_FIELDS = ['id', 'name', 'author', 'category', 'subcategory',
        'duration_seconds', 'duration_category', 'tss', 'primary_zone',
        'avg_power', 'file', 'description'];

    function num(v, d) {
        var n = Number(v);
        return isFinite(n) ? n : (d === undefined ? 0 : d);
    }

    function normalize(obj) {
        var o = obj || {};
        return {
            id: o.id != null ? o.id : '',
            name: o.name || '',
            author: o.author || '',
            category: o.category || '',
            subcategory: o.subcategory || '',
            duration_seconds: num(o.duration_seconds, 0),
            duration_category: o.duration_category || '',
            tss: num(o.tss, 0),
            primary_zone: num(o.primary_zone, 0),
            avg_power: num(o.avg_power, 0),
            file: o.file || '',
            description: o.description || ''
        };
    }

    /**
     * Accepts either the compact summary ({fields, workouts:[[...]]}) or a full
     * manifest ({workouts:[{...}]}) or a bare array. Returns normalized rows.
     */
    function parseCatalog(json) {
        if (!json) return [];
        var data = json;
        if (typeof json === 'string') {
            try { data = JSON.parse(json); } catch (e) { return []; }
        }
        if (!data) return [];
        if (Array.isArray(data.workouts) && data.workouts.length &&
            Array.isArray(data.workouts[0]) && Array.isArray(data.fields)) {
            var fields = data.fields;
            return data.workouts.map(function (row) {
                var o = {};
                for (var i = 0; i < fields.length; i++) o[fields[i]] = row[i];
                return normalize(o);
            });
        }
        if (Array.isArray(data.workouts)) return data.workouts.map(normalize);
        if (Array.isArray(data)) return data.map(normalize);
        return [];
    }

    function matches(w, q) {
        var zones = q.zones || [];
        var kws = q.category_keywords || [];
        if (zones.length && zones.indexOf(w.primary_zone) < 0) return false;

        if (q.duration_min != null && w.duration_seconds < q.duration_min * 60) return false;
        if (q.duration_max != null && w.duration_seconds > q.duration_max * 60) return false;
        if (q.tss_min != null && w.tss < q.tss_min) return false;
        if (q.tss_max != null && w.tss > q.tss_max) return false;

        if (kws.length) {
            var hay = [w.name, w.category, w.subcategory, w.description].join(' ').toLowerCase();
            var ok = false;
            for (var i = 0; i < kws.length; i++) {
                if (hay.indexOf(String(kws[i]).toLowerCase()) >= 0) { ok = true; break; }
            }
            if (!ok) return false;
        }
        return true;
    }

    /**
     * Filter and rank catalog rows against a normalized search query.
     * Ranking prefers durations near the requested midpoint, then TSS midpoint.
     */
    function filterCatalog(workouts, query) {
        var q = query || {};
        var target = null;
        if (q.duration_min != null && q.duration_max != null) {
            target = (q.duration_min + q.duration_max) / 2 * 60;
        } else if (q.duration_min != null) {
            target = q.duration_min * 60;
        } else if (q.duration_max != null) {
            target = q.duration_max * 60;
        }
        var tssTarget = null;
        if (q.tss_min != null && q.tss_max != null) tssTarget = (q.tss_min + q.tss_max) / 2;

        var result = (workouts || []).filter(function (w) { return matches(w, q); });

        result.sort(function (a, b) {
            if (target != null) {
                var da = Math.abs(a.duration_seconds - target);
                var db = Math.abs(b.duration_seconds - target);
                if (da !== db) return da - db;
            }
            if (tssTarget != null) {
                var ta = Math.abs(a.tss - tssTarget);
                var tb = Math.abs(b.tss - tssTarget);
                if (ta !== tb) return ta - tb;
            }
            return 0;
        });

        var limit = q.limit != null ? q.limit : DEFAULT_LIMIT;
        if (limit > 0) result = result.slice(0, limit);
        return result;
    }

    function findCandidates(workouts, query) {
        var list = Array.isArray(workouts) ? workouts : [];
        if (!list.length) return { rows: [], relaxed: [], catalogAvailable: false };

        var original = Object.assign({}, query || {});
        original.limit = original.limit > 0 ? Math.min(Math.floor(original.limit), DEFAULT_LIMIT) : DEFAULT_LIMIT;
        var attempts = [
            { query: original, relaxed: [] },
            {
                query: Object.assign({}, original, { tss_min: undefined, tss_max: undefined }),
                relaxed: ['TSS bounds']
            },
            {
                query: Object.assign({}, original, {
                    tss_min: undefined,
                    tss_max: undefined,
                    category_keywords: []
                }),
                relaxed: ['TSS bounds', 'category keywords']
            },
            {
                query: Object.assign({}, original, {
                    tss_min: undefined,
                    tss_max: undefined,
                    category_keywords: [],
                    zones: []
                }),
                relaxed: ['TSS bounds', 'category keywords', 'target zone']
            },
            {
                query: Object.assign({}, original, {
                    tss_min: undefined,
                    tss_max: undefined,
                    category_keywords: [],
                    zones: [],
                    duration_min: undefined,
                    duration_max: undefined
                }),
                relaxed: ['TSS bounds', 'category keywords', 'target zone', 'duration']
            }
        ];

        for (var i = 0; i < attempts.length; i++) {
            var rows = filterCatalog(list, attempts[i].query);
            if (rows.length) {
                return {
                    rows: rows,
                    relaxed: attempts[i].relaxed,
                    catalogAvailable: true
                };
            }
        }

        return {
            rows: [],
            relaxed: attempts[attempts.length - 1].relaxed,
            catalogAvailable: true
        };
    }

    function truncate(s, n) {
        s = String(s || '');
        return s.length > n ? s.slice(0, n - 1) + '\u2026' : s;
    }

    function toCandidate(w) {
        return {
            id: w.id,
            name: w.name,
            author: w.author,
            duration_min: Math.round(w.duration_seconds / 60),
            zone: w.primary_zone,
            tss: w.tss,
            category: w.category,
            subcategory: w.subcategory,
            description: truncate(w.description, 160),
            file: w.file
        };
    }

    function formatCandidates(rows) {
        if (!rows || !rows.length) return 'No catalog workouts matched those criteria.';
        var lines = ['Candidate workouts (from local catalog summary):'];
        rows.forEach(function (workout, index) {
            var r = toCandidate(workout);
            lines.push(
                (index + 1) + '. ' + r.name + ' (' + r.id + ')' +
                ' | author: ' + r.author +
                ' | duration: ' + r.duration_min + ' min' +
                ' | zone: ' + r.zone +
                ' | TSS: ' + r.tss +
                ' | category: ' + [r.category, r.subcategory].filter(Boolean).join(' / ') +
                ' | file: ' + r.file +
                ' | description: ' + r.description
            );
        });
        return lines.join('\n');
    }

    var api = {
        KNOWN_FIELDS: KNOWN_FIELDS,
        parseCatalog: parseCatalog,
        filterCatalog: filterCatalog,
        findCandidates: findCandidates,
        toCandidate: toCandidate,
        formatCandidates: formatCandidates,
        truncate: truncate
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.CoachCatalog = api;
})();
