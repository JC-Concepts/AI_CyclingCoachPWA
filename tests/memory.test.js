'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../js/memory.js');

test('createEmpty produces a valid skeleton', () => {
    const m = M.createEmpty('i12345', '2030-01-01T00:00:00Z');
    assert.equal(m.athlete_id, 'i12345');
    assert.deepEqual(m.messages, []);
    assert.equal(m.updated_at, '2030-01-01T00:00:00Z');
});

test('appendTurn does not mutate the input', () => {
    const m = M.createEmpty('i1');
    const m2 = M.appendTurn(m, { role: 'user', text: 'hi', turn_id: 't1' });
    assert.equal(m.messages.length, 0);
    assert.equal(m2.messages.length, 1);
    assert.equal(m2.messages[0].text, 'hi');
});

test('contentHash is stable and changes with content', async () => {
    const a = M.appendTurn(M.createEmpty('i1'), { role: 'user', text: 'hi', turn_id: 't1' });
    const b = M.appendTurn(M.createEmpty('i1'), { role: 'user', text: 'hi', turn_id: 't1' });
    const ha = await M.contentHash(a);
    const hb = await M.contentHash(b);
    assert.equal(ha, hb);
    assert.match(ha, /^[0-9a-f]{64}$/);

    const c = M.appendTurn(a, { role: 'user', text: 'more', turn_id: 't2' });
    assert.notEqual(await M.contentHash(c), ha);
});

test('needsPush is false when hash matches, true when changed', async () => {
    const m = M.appendTurn(M.createEmpty('i1'), { role: 'user', text: 'hi', turn_id: 't1' });
    const h = await M.contentHash(m);
    assert.equal(await M.needsPush(m, h), false);
    assert.equal(await M.needsPush(m, 'deadbeef'), true);
    assert.equal(await M.needsPush(m, ''), true);
});

test('needsPush accepts an injectable hash fn', async () => {
    const fake = (s) => 'H' + s.length;
    const m = M.createEmpty('i1');
    const h = await M.contentHash(m, fake);
    assert.equal(await M.needsPush(m, h, fake), false);
});

test('compact trims messages and counts dropped turns', () => {
    let m = M.createEmpty('i1');
    for (let i = 0; i < 50; i++) m = M.appendTurn(m, { role: 'user', text: 'msg' + i, turn_id: 't' + i });
    const c = M.compact(m, 40);
    assert.equal(c.messages.length, 40);
    assert.equal(c.summary.compacted_turns, 10);
    assert.equal(c.messages[0].text, 'msg10');
});

test('compact enforces byte cap', () => {
    let m = M.createEmpty('i1');
    const big = 'x'.repeat(5000);
    for (let i = 0; i < 100; i++) m = M.appendTurn(m, { role: 'user', text: big, turn_id: 't' + i });
    const c = M.compact(m, 40, 50 * 1024);
    assert.ok(M.byteSize(c) <= 50 * 1024);
    assert.ok(c.summary.compacted_turns > 10);
});

test('mergeMemory unions turns by id and picks newest summary', () => {
    const local = {
        athlete_id: 'i1', updated_at: '2030-01-01T00:00:00Z',
        summary: { standing_topics: ['ftp'], coach_notes: 'local', compacted_turns: 0 },
        messages: [
            { turn_id: 't1', role: 'user', text: 'a', ts: '2030-01-01T00:00:00Z' },
            { turn_id: 't2', role: 'user', text: 'local-b', ts: '2030-01-02T00:00:00Z' }
        ]
    };
    const remote = {
        athlete_id: 'i1', updated_at: '2030-01-02T00:00:00Z',
        summary: { standing_topics: ['sprint'], coach_notes: 'remote', compacted_turns: 0 },
        messages: [
            { turn_id: 't2', role: 'user', text: 'remote-b', ts: '2030-01-02T06:00:00Z' },
            { turn_id: 't3', role: 'user', text: 'c', ts: '2030-01-03T00:00:00Z' }
        ]
    };
    const merged = M.mergeMemory(local, remote);
    assert.deepEqual(merged.messages.map(m => m.turn_id), ['t1', 't2', 't3']);
    assert.equal(merged.messages.find(m => m.turn_id === 't2').text, 'remote-b');
    assert.equal(merged.summary.coach_notes, 'remote');
});

test('mergeMemory handles a missing side', () => {
    const local = M.appendTurn(M.createEmpty('i1'), { role: 'user', text: 'a', turn_id: 't1' });
    assert.equal(M.mergeMemory(local, null).messages.length, 1);
    assert.equal(M.mergeMemory(null, local).messages.length, 1);
});
