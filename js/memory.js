/**
 * memory.js - conversation memory for the coach (Section 11).
 * 15-minute/diff-guarded flush: a push happens only when SHA-256 over
 * (messages + summary) differs from the last pushed hash.
 * Dual-export; pure functions with an injectable hash for tests.
 */
'use strict';

(function () {
    var DEFAULT_MAX_TURNS = 40;
    var DEFAULT_MAX_BYTES = 200 * 1024;

    function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

    function utf8Len(s) {
        if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
        if (typeof Buffer !== 'undefined') return Buffer.byteLength(s, 'utf8');
        var n = 0; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); n += c < 128 ? 1 : (c < 2048 ? 2 : 3); }
        return n;
    }

    function byteSize(mem) { return utf8Len(JSON.stringify(mem)); }

    function createEmpty(athleteId, nowIso) {
        return {
            version: 1,
            athlete_id: athleteId || '',
            messages: [],
            summary: { standing_topics: [], coach_notes: '', compacted_turns: 0 },
            updated_at: nowIso || new Date().toISOString()
        };
    }

    function appendTurn(mem, turn) {
        var copy = mem ? deepClone(mem) : createEmpty();
        copy.messages = copy.messages || [];
        copy.messages.push({
            turn_id: turn.turn_id || String(copy.messages.length + 1),
            role: turn.role || 'user',
            text: String(turn.text || ''),
            ts: turn.ts || new Date().toISOString()
        });
        copy.updated_at = new Date().toISOString();
        return copy;
    }

    async function sha256Hex(str) {
        if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
            var enc = new TextEncoder().encode(str);
            var buf = await crypto.subtle.digest('SHA-256', enc);
            return Array.prototype.map.call(new Uint8Array(buf), function (b) {
                return ('0' + b.toString(16)).slice(-2);
            }).join('');
        }
        if (typeof require === 'function') {
            var nodeCrypto = require('crypto');
            return nodeCrypto.createHash('sha256').update(str, 'utf8').digest('hex');
        }
        throw new Error('No SHA-256 implementation available');
    }

    function canonical(mem) {
        return JSON.stringify({
            messages: (mem && mem.messages) || [],
            summary: (mem && mem.summary) || {}
        });
    }

    async function contentHash(mem, hashFn) {
        var fn = hashFn || sha256Hex;
        return fn(canonical(mem));
    }

    async function needsPush(mem, lastHash, hashFn) {
        var h = await contentHash(mem || { messages: [], summary: {} }, hashFn);
        return h !== (lastHash || '');
    }

    function compact(mem, maxTurns, maxBytes) {
        maxTurns = maxTurns || DEFAULT_MAX_TURNS;
        maxBytes = maxBytes || DEFAULT_MAX_BYTES;
        var copy = deepClone(mem || createEmpty());
        copy.messages = copy.messages || [];
        copy.summary = copy.summary || { standing_topics: [], coach_notes: '', compacted_turns: 0 };

        var dropped = 0;
        if (copy.messages.length > maxTurns) {
            dropped = copy.messages.length - maxTurns;
            copy.messages = copy.messages.slice(-maxTurns);
        }
        if (dropped) copy.summary.compacted_turns = (copy.summary.compacted_turns || 0) + dropped;

        while (byteSize(copy) > maxBytes && copy.messages.length > 1) {
            copy.messages.shift();
            copy.summary.compacted_turns = (copy.summary.compacted_turns || 0) + 1;
        }
        copy.updated_at = new Date().toISOString();
        return copy;
    }

    /**
     * Reconcile a local and remote memory (409 recovery / cross-device).
     * Union turns by turn_id; newest summary wins; keep last maxTurns.
     */
    function mergeMemory(local, remote, maxTurns) {
        if (!local) return deepClone(remote || createEmpty());
        if (!remote) return deepClone(local);

        var byId = {};
        function add(m) {
            (m && m.messages ? m.messages : []).forEach(function (t) {
                var id = t.turn_id;
                if (!id) id = 'anon_' + (t.ts || '') + '_' + JSON.stringify(t.text || '').slice(0, 24);
                if (!byId[id] || (t.ts || '') >= (byId[id].ts || '')) byId[id] = t;
            });
        }
        add(remote);
        add(local);

        var messages = Object.keys(byId).map(function (k) { return byId[k]; });
        messages.sort(function (a, b) { return (a.ts || '') < (b.ts || '') ? -1 : ((a.ts || '') > (b.ts || '') ? 1 : 0); });

        var localUpd = Date.parse((local && local.updated_at) || 0) || 0;
        var remoteUpd = Date.parse((remote && remote.updated_at) || 0) || 0;
        var summary = localUpd >= remoteUpd ? local.summary : remote.summary;

        var merged = {
            version: 1,
            athlete_id: (local && local.athlete_id) || (remote && remote.athlete_id) || '',
            messages: messages,
            summary: summary || { standing_topics: [], coach_notes: '', compacted_turns: 0 },
            updated_at: new Date(Math.max(localUpd, remoteUpd) || Date.now()).toISOString()
        };
        return compact(merged, maxTurns);
    }

    var api = {
        DEFAULT_MAX_TURNS: DEFAULT_MAX_TURNS,
        DEFAULT_MAX_BYTES: DEFAULT_MAX_BYTES,
        createEmpty: createEmpty,
        appendTurn: appendTurn,
        byteSize: byteSize,
        canonical: canonical,
        sha256Hex: sha256Hex,
        contentHash: contentHash,
        needsPush: needsPush,
        compact: compact,
        mergeMemory: mergeMemory
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.CoachMemory = api;
})();
