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
