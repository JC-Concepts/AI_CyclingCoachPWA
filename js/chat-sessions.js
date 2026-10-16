/**
 * chat-sessions.js - compact transcript helpers for local and Drive history.
 * Dual-export; pure functions.
 */
'use strict';

(function (root, factory) {
    var ChatSessions = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = ChatSessions;
    if (root) root.ChatSessions = ChatSessions;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    function makeId() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
        return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    }

    function titleFrom(text) {
        var title = String(text || '').replace(/\s+/g, ' ').trim();
        if (!title) return 'New chat';
        return title.length > 56 ? title.slice(0, 53).trimEnd() + '...' : title;
    }

    function create(title, now, id) {
        now = now || new Date().toISOString();
        return {
            id: id || makeId(),
            title: titleFrom(title),
            created_at: now,
            updated_at: now,
            messages: []
        };
    }

    function addMessage(session, role, text, now, id) {
        if (role !== 'user' && role !== 'assistant') {
            throw new Error('Chat session messages must be user or assistant turns.');
        }
        var copy = JSON.parse(JSON.stringify(session));
        copy.messages = Array.isArray(copy.messages) ? copy.messages : [];
        var message = {
            id: id || makeId(),
            role: role,
            text: String(text || ''),
            ts: now || new Date().toISOString()
        };
        copy.messages.push(message);
        copy.updated_at = message.ts;
        delete copy._synced_at;
        if (role === 'user' && (copy.title === 'New chat' || !copy.title)) {
            copy.title = titleFrom(message.text);
        }
        return copy;
    }

    function merge(local, remote) {
        if (!local) return JSON.parse(JSON.stringify(remote));
        if (!remote) return JSON.parse(JSON.stringify(local));

        var byId = Object.create(null);
        [remote, local].forEach(function (session) {
            (session.messages || []).forEach(function (message) {
                if (!message || !message.id) return;
                var previous = byId[message.id];
                if (!previous || String(message.ts || '') >= String(previous.ts || '')) {
                    byId[message.id] = message;
                }
            });
        });
        var messages = Object.keys(byId).map(function (id) { return byId[id]; });
        messages.sort(function (a, b) {
            if (a.ts !== b.ts) return String(a.ts || '').localeCompare(String(b.ts || ''));
            return String(a.id).localeCompare(String(b.id));
        });
        var localIsNewer = String(local.updated_at || '') >= String(remote.updated_at || '');
        var merged = {
            id: local.id || remote.id,
            title: (localIsNewer ? local.title : remote.title) || 'New chat',
            created_at: [local.created_at, remote.created_at].filter(Boolean).sort()[0] || '',
            updated_at: [local.updated_at, remote.updated_at].filter(Boolean).sort().pop() || '',
            messages: messages
        };
        if (local._synced_at && local._synced_at >= merged.updated_at) {
            merged._synced_at = local._synced_at;
        } else if (remote._synced_at && remote._synced_at >= merged.updated_at) {
            merged._synced_at = remote._synced_at;
        }
        return merged;
    }

    function fromLegacy(memory) {
        var messages = (memory && Array.isArray(memory.messages)) ? memory.messages : [];
        if (!messages.length) return null;
        var legacy = create('Previous conversation', messages[0].ts, 'legacy');
        messages.forEach(function (message, index) {
            if (!message || (message.role !== 'user' && message.role !== 'assistant')) return;
            legacy = addMessage(legacy, message.role, message.text, message.ts,
                'legacy-' + String(message.turn_id || index + 1));
        });
        if (legacy.messages.length) {
            var firstUser = legacy.messages.find(function (message) { return message.role === 'user'; });
            if (firstUser) legacy.title = titleFrom(firstUser.text);
            legacy.created_at = legacy.messages[0].ts || legacy.created_at;
            return legacy;
        }
        return null;
    }

    function forDrive(session) {
        return {
            id: session.id,
            title: session.title,
            created_at: session.created_at,
            updated_at: session.updated_at,
            messages: session.messages || []
        };
    }

    return {
        create: create,
        addMessage: addMessage,
        merge: merge,
        fromLegacy: fromLegacy,
        forDrive: forDrive,
        titleFrom: titleFrom
    };
});
