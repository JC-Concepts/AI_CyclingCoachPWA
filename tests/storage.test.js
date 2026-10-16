'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { StorageManager, MemoryBackend } = require('../js/storage.js');

function makeStorage() { return new StorageManager(new MemoryBackend()); }

test('settings roundtrip and patch', () => {
    const s = makeStorage();
    assert.deepEqual(s.getSettings(), {});
    s.saveSettings({ athleteId: 'i1' });
    assert.equal(s.getSettings().athleteId, 'i1');
    const patched = s.patchSettings({ model: 'free/model' });
    assert.equal(patched.athleteId, 'i1');
    assert.equal(patched.model, 'free/model');
    assert.equal(s.getSettings().model, 'free/model');
});

test('getSettings tolerates corrupt JSON', () => {
    const backend = new MemoryBackend();
    backend.setItem('coach.settings.v1', '{broken');
    const s = new StorageManager(backend);
    assert.deepEqual(s.getSettings(), {});
});

test('memory get/set and last push hash', () => {
    const s = makeStorage();
    assert.equal(s.getMemory(), null);
    s.setMemory({ messages: [1] });
    assert.deepEqual(s.getMemory(), { messages: [1] });
    assert.equal(s.getLastPushHash(), '');
    s.setLastPushHash('abc');
    assert.equal(s.getLastPushHash(), 'abc');
});

test('memory, pending state, and hashes are isolated by athlete', () => {
    const s = makeStorage();
    s.setMemory({ athlete_id: 'athlete-a', messages: [] }, 'athlete-a');
    s.setPendingFlush(true, 'athlete-a');
    s.setLastPushHash('hash-a', 'athlete-a');
    assert.equal(s.getMemory('athlete-a').athlete_id, 'athlete-a');
    assert.equal(s.getMemory('athlete-b'), null);
    assert.equal(s.getPendingFlush('athlete-a'), true);
    assert.equal(s.getPendingFlush('athlete-b'), false);
    assert.equal(s.getLastPushHash('athlete-a'), 'hash-a');
    assert.equal(s.getLastPushHash('athlete-b'), '');
});

test('legacy memory and sync metadata migrate to its matching athlete only', () => {
    const backend = new MemoryBackend({
        'coach.memory.v1': JSON.stringify({ athlete_id: 'athlete-a', messages: [] }),
        'coach.memory.pending': 'true'
    });
    const s = new StorageManager(backend);
    const legacy = s.getMemory('athlete-a');
    assert.equal(legacy.athlete_id, 'athlete-a');
    s.setMemory(legacy, 'athlete-a');
    assert.equal(s.getMemory('athlete-b'), null);
    assert.equal(s.getPendingFlush('athlete-a'), true);
    assert.equal(backend.getItem('coach.memory.v1'), null);
});

test('chat session archive persists the active session and deletion queue', () => {
    const s = makeStorage();
    assert.deepEqual(s.getChatSessions('i1'), { activeId: '', sessions: [], deletedIds: [] });
    const archive = {
        activeId: 'session-1',
        sessions: [{ id: 'session-1', messages: [] }],
        deletedIds: ['session-2']
    };
    assert.equal(s.setChatSessions('i1', archive), true);
    assert.deepEqual(s.getChatSessions('i1'), archive);
    assert.deepEqual(s.getChatSessions('i2'), { activeId: '', sessions: [], deletedIds: [] });
});

test('data cache stores and retrieves named files independently', () => {
    const s = makeStorage();
    assert.equal(s.getCachedData('latest.json'), null);
    s.setCachedData('latest.json', { a: 1 });
    s.setCachedData('ftp_history.json', { b: 2 });
    assert.deepEqual(s.getCachedData('latest.json'), { a: 1 });
    assert.deepEqual(s.getCachedData('ftp_history.json'), { b: 2 });
});

test('first-launch flag lifecycle', () => {
    const s = makeStorage();
    assert.equal(s.isFirstLaunch(), true);
    s.setLaunched();
    assert.equal(s.isFirstLaunch(), false);
});

test('pending flush flag', () => {
    const s = makeStorage();
    assert.equal(s.getPendingFlush(), false);
    s.setPendingFlush(true);
    assert.equal(s.getPendingFlush(), true);
});
