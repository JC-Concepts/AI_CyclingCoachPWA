'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/settings.js');

test('validateSettings reports all missing fields on empty settings', () => {
    const r = S.validateSettings({});
    assert.equal(r.ok, false);
    assert.equal(r.missing.length, 5);
    assert.deepEqual(r.missing.map(f => f.key).sort(),
        ['athleteId', 'githubToken', 'intervalsKey', 'model', 'openrouterKey'].sort());
});

test('validateSettings passes when complete', () => {
    const r = S.validateSettings({
        athleteId: 'i1', intervalsKey: 'k', openrouterKey: 'o', model: 'm', githubToken: 't'
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.missing, []);
});

test('validateSettings treats whitespace as blank', () => {
    const r = S.validateSettings({
        athleteId: 'i1', intervalsKey: '  ', openrouterKey: 'o', model: 'm', githubToken: 't'
    });
    assert.equal(r.ok, false);
    assert.deepEqual(r.missing.map(f => f.key), ['intervalsKey']);
});

test('presentFields lists only provided fields', () => {
    const p = S.presentFields({ athleteId: 'i1', model: 'm' });
    assert.deepEqual(p.map(f => f.key).sort(), ['athleteId', 'model']);
});

test('formatMissingMessage names the missing fields and settings section', () => {
    const r = S.validateSettings({ athleteId: 'i1' });
    const msg = S.formatMissingMessage(r.missing, S.presentFields({ athleteId: 'i1' }));
    assert.ok(msg.includes('OpenRouter API Key'));
    assert.ok(msg.includes('Settings'));
    assert.ok(msg.includes('Intervals.icu Athlete ID'));
});
