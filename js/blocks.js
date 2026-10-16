/**
 * blocks.js - structured-output parsing and safe markdown rendering.
 *
 * The model emits fenced JSON blocks (workout_search / workout_push /
 * dossier_update). This module extracts them deterministically and renders the
 * remaining prose through an allowlisted markdown renderer. All content is
 * HTML-escaped first; no untrusted HTML is ever emitted.
 *
 * Dual-export; pure functions.
 */
'use strict';

(function () {
    var BLOCK_TYPES = ['workout_search', 'workout_push', 'dossier_update'];

    function escapeHtml(s) {
        if (s === undefined || s === null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function inline(s) {
        var t = escapeHtml(s);
        t = t.replace(/`([^`]+)`/g, function (m, c) { return '<code>' + c + '</code>'; });
        t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, function (m, label, url) {
            return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
        });
        t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        t = t.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
        return t;
    }

    function renderTable(rows) {
        function cells(line) {
            return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); });
        }
        var parsed = rows.map(cells);
        var head = parsed[0] || [];
        var body = parsed.slice(1).filter(function (r) {
            return !(r.length && r.every(function (c) { return c === '' || /^:?-{2,}:?$/.test(c); }));
        });
        return '<table class="md-table"><thead><tr>' +
            head.map(function (c) { return '<th>' + inline(c) + '</th>'; }).join('') +
            '</tr></thead><tbody>' +
            body.map(function (r) {
                return '<tr>' + r.map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>';
            }).join('') +
            '</tbody></table>';
    }

    /**
     * Render markdown to safe HTML. Supports headings, bold, italic, inline
     * code, fenced code, links (http/https only), lists, blockquotes, hr, tables.
     */
    function markdownToSafeHtml(md) {
        if (!md) return '';
        var text = String(md).replace(/\r\n/g, '\n');
        var codeBlocks = [];
        text = text.replace(/```([^\n]*)\n([\s\S]*?)```/g, function (m, lang, code) {
            codeBlocks.push('<pre class="md-pre"><code>' + escapeHtml(code.replace(/\n$/, '')) + '</code></pre>');
            return '\u0000CODE' + (codeBlocks.length - 1) + '\u0000';
        });

        var lines = text.split('\n');
        var out = [];
        var inUl = false, inOl = false, inTable = false, tableRows = [];

        function closeLists() {
            if (inUl) { out.push('</ul>'); inUl = false; }
            if (inOl) { out.push('</ol>'); inOl = false; }
        }
        function closeTable() {
            if (inTable) { out.push(renderTable(tableRows)); tableRows = []; inTable = false; }
        }

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (/^\u0000CODE\d+\u0000$/.test(line.trim())) { closeLists(); closeTable(); out.push(line.trim()); continue; }

            if (/^\s*\|.*\|\s*$/.test(line)) { closeLists(); inTable = true; tableRows.push(line); continue; }
            closeTable();

            var h = /^(#{1,6})\s+(.*)$/.exec(line);
            if (h) { closeLists(); var lvl = h[1].length; out.push('<h' + lvl + '>' + inline(h[2]) + '</h' + lvl + '>'); continue; }

            if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { closeLists(); out.push('<hr/>'); continue; }

            var bq = /^\s*>\s?(.*)$/.exec(line);
            if (bq) { closeLists(); out.push('<blockquote>' + inline(bq[1]) + '</blockquote>'); continue; }

            var ul = /^\s*[-*+]\s+(.*)$/.exec(line);
            if (ul) { if (inOl) { out.push('</ol>'); inOl = false; } if (!inUl) { out.push('<ul>'); inUl = true; } out.push('<li>' + inline(ul[1]) + '</li>'); continue; }

            var ol = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
            if (ol) { if (inUl) { out.push('</ul>'); inUl = false; } if (!inOl) { out.push('<ol>'); inOl = true; } out.push('<li>' + inline(ol[2]) + '</li>'); continue; }

            closeLists();
            if (line.trim() === '') { out.push(''); continue; }
            out.push('<p>' + inline(line) + '</p>');
        }
        closeLists();
        closeTable();

        var html = out.join('\n');
        html = html.replace(/\u0000CODE(\d+)\u0000/g, function (m, idx) { return codeBlocks[parseInt(idx, 10)] || ''; });
        return html;
    }

    /**
     * Extract the LAST complete fenced JSON block of each type.
     * @returns {{search, push, dossier, errors:Array, cleaned:string}}
     */
    function parseBlocks(text) {
        var result = { search: null, push: null, dossier: null, errors: [], cleaned: '' };
        var src = String(text || '');
        var re = /```(workout_search|workout_push|dossier_update)[ \t]*\n([\s\S]*?)```/g;
        var m;
        var ranges = [];
        while ((m = re.exec(src)) !== null) {
            var type = m[1];
            var body = m[2];
            ranges.push([m.index, re.lastIndex]);
            var parsed = null;
            try { parsed = JSON.parse(body.trim()); } catch (e) {
                result.errors.push({ type: type, error: e.message, raw: body.trim() });
                continue;
            }
            if (type === 'workout_search') result.search = parsed;
            else if (type === 'workout_push') result.push = parsed;
            else if (type === 'dossier_update') result.dossier = parsed;
        }
        var cleaned = src;
        for (var i = ranges.length - 1; i >= 0; i--) {
            cleaned = cleaned.slice(0, ranges[i][0]) + cleaned.slice(ranges[i][1]);
        }
        result.cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
        return result;
    }

    function isIsoDate(s) {
        if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
        var d = new Date(s + 'T00:00:00Z');
        return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
    }

    /**
     * Validate a workout_push block against today's date.
     */
    function validatePushBlock(push, todayIso) {
        if (!push || typeof push !== 'object') return { ok: false, error: 'no push block' };
        if (typeof push.workout_id !== 'string' || !/^workout_[A-Za-z0-9_-]+$/.test(push.workout_id)) {
            return { ok: false, error: 'invalid workout_id' };
        }
        if (!isIsoDate(push.date)) return { ok: false, error: 'date must be YYYY-MM-DD' };
        if (todayIso && push.date < todayIso) return { ok: false, error: 'date must be today or later' };
        return { ok: true, date: push.date, workout_id: push.workout_id, reason: push.reason || '' };
    }

    /**
     * Normalize a workout_search block into a safe query object.
     */
    function normalizeSearchBlock(search) {
        var q = search && typeof search === 'object' ? search : {};
        function num(v) { var n = Number(v); return isFinite(n) ? n : undefined; }
        function strArr(v) { return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string'; }) : []; }
        function intArr(v) {
            return Array.isArray(v) ? v.map(Number).filter(function (x) { return isFinite(x); }) : [];
        }
        return {
            intent: typeof q.intent === 'string' ? q.intent : '',
            zones: intArr(q.zones),
            duration_min: num(q.duration_min),
            duration_max: num(q.duration_max),
            tss_min: num(q.tss_min),
            tss_max: num(q.tss_max),
            category_keywords: strArr(q.category_keywords),
            limit: num(q.limit)
        };
    }

    var api = {
        BLOCK_TYPES: BLOCK_TYPES,
        escapeHtml: escapeHtml,
        markdownToSafeHtml: markdownToSafeHtml,
        parseBlocks: parseBlocks,
        isIsoDate: isIsoDate,
        validatePushBlock: validatePushBlock,
        normalizeSearchBlock: normalizeSearchBlock
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') {
        window.CoachBlocks = api;
        window.escapeHtml = escapeHtml;
    }
})();
