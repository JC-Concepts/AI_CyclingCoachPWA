'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ChatSessions = require('../js/chat-sessions.js');

test('sessions assign distinct IDs and derive a compact title from the first prompt', () => {
    const first = ChatSessions.create('', '2026-10-16T12:00:00.000Z');
    const second = ChatSessions.create('', '2026-10-16T12:00:01.000Z');
    assert.notEqual(first.id, second.id);

    const withPrompt = ChatSessions.addMessage(first, 'user', '  Review my   training week  ',
        '2026-10-16T12:01:00.000Z', 'message-1');
    assert.equal(withPrompt.title, 'Review my training week');
    assert.equal(withPrompt.messages.length, 1);
});

test('session merge retains unique turns and resolves duplicate turns by timestamp', () => {
    const local = {
        id: 'session-1',
        title: 'Local title',
        created_at: '2026-10-16T12:00:00.000Z',
        updated_at: '2026-10-16T12:02:00.000Z',
        messages: [{ id: 'turn-1', role: 'user', text: 'newer', ts: '2026-10-16T12:02:00.000Z' }]
    };
    const remote = {
        id: 'session-1',
        title: 'Remote title',
        created_at: '2026-10-16T12:00:00.000Z',
        updated_at: '2026-10-16T12:01:00.000Z',
        messages: [
            { id: 'turn-1', role: 'user', text: 'older', ts: '2026-10-16T12:01:00.000Z' },
            { id: 'turn-2', role: 'assistant', text: 'answer', ts: '2026-10-16T12:01:30.000Z' }
        ]
    };
    const merged = ChatSessions.merge(local, remote);
    assert.equal(merged.title, 'Local title');
    assert.deepEqual(merged.messages.map(message => message.id), ['turn-2', 'turn-1']);
    assert.equal(merged.messages[1].text, 'newer');
});

test('legacy memory can be converted into a visible previous chat', () => {
    const session = ChatSessions.fromLegacy({
        messages: [
            { turn_id: '1', role: 'user', text: 'Help me plan a ride', ts: '2026-10-16T12:00:00.000Z' },
            { turn_id: '2', role: 'assistant', text: 'What is your target?', ts: '2026-10-16T12:01:00.000Z' }
        ]
    });
    assert.equal(session.id, 'legacy');
    assert.equal(session.title, 'Help me plan a ride');
    assert.equal(session.messages.length, 2);
    assert.equal(ChatSessions.fromLegacy({ messages: [] }), null);
});

test('Drive serialization omits local sync metadata', () => {
    const session = Object.assign(ChatSessions.create('Ride plan', '2026-10-16T12:00:00.000Z', 's1'), {
        _synced_at: '2026-10-16T12:00:00.000Z'
    });

    test('merge preserves Drive-saved status only when no newer turn exists', () => {
        const synced = ChatSessions.create('Ride plan', '2026-10-16T12:00:00.000Z', 's1');
        synced.updated_at = '2026-10-16T12:01:00.000Z';
        synced._synced_at = synced.updated_at;
        assert.equal(ChatSessions.merge(synced, null)._synced_at, synced.updated_at);

        const changed = ChatSessions.addMessage(synced, 'user', 'New question',
            '2026-10-16T12:02:00.000Z', 'turn-2');
        assert.equal(ChatSessions.merge(changed, null)._synced_at, undefined);
    });
    assert.deepEqual(ChatSessions.forDrive(session), {
        id: 's1',
        title: 'Ride plan',
        created_at: '2026-10-16T12:00:00.000Z',
        updated_at: '2026-10-16T12:00:00.000Z',
        messages: []
    });
});
