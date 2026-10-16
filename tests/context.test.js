'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/context.js');

const NOW = Date.parse('2030-01-10T12:00:00Z');

function latestFresh() {
    return {
        metadata: { last_updated: '2030-01-10T06:00:00Z' },
        READ_THIS_FIRST: { quick_stats: { ctl: 55, atl: 60, tsb: -5 } },
        readiness_decision: { status: 'green' },
        summary: 'all good'
    };
}

test('estimateTokens is length/4 rounded up', () => {
    assert.equal(C.estimateTokens('abcd'), 1);
    assert.equal(C.estimateTokens('abcde'), 2);
    assert.equal(C.estimateTokens(''), 0);
});

test('sliceLatest keeps whitelisted keys plus quick_stats', () => {
    const s = C.sliceLatest(latestFresh());
    assert.ok(s.metadata);
    assert.ok(s.readiness_decision);
    assert.deepEqual(s.quick_stats, { ctl: 55, atl: 60, tsb: -5 });
    assert.equal(s.evil_extra, undefined);
});

test('buildFreshness flags stale data', () => {
    const fresh = C.buildFreshness({ latest: latestFresh() }, NOW);
    assert.equal(fresh.length, 1);
    assert.equal(fresh[0].stale, false);

    const old = { metadata: { last_updated: '2029-12-01T00:00:00Z' } };
    const stale = C.buildFreshness({ latest: old }, NOW);
    assert.equal(stale[0].stale, true);
});

test('buildContext assembles system vars and warns on stale data', () => {
    const ctx = C.buildContext({
        settings: { athleteId: 'i999' },
        latest: { metadata: { last_updated: '2029-12-01T00:00:00Z' }, readiness_decision: { status: 'red' } },
        memory: { summary: { standing_topics: ['ftp rising'], coach_notes: 'watch fatigue' } },
        dossier: '# Dossier\nFTP 250',
        now: NOW,
        timezone: 'Europe/London'
    });
    assert.equal(ctx.systemVars.ATHLETE_ID, 'i999');
    assert.equal(ctx.systemVars.TZ, 'Europe/London');
    assert.ok(ctx.systemVars.MEMORY_SUMMARY.includes('ftp rising'));
    assert.ok(ctx.systemVars.MEMORY_SUMMARY.includes('watch fatigue'));
    assert.ok(ctx.systemVars.DOSSIER_STATE.includes('FTP 250'));
    assert.ok(ctx.warnings.some(w => w.includes('stale')));
    assert.ok(ctx.dataMessage.includes('i999'));
});

test('buildContext handles an empty dataset without throwing', () => {
    const ctx = C.buildContext({ settings: {}, now: NOW });
    assert.ok(ctx.dataMessage.includes('none cached'));
    assert.equal(ctx.freshness.length, 0);
    assert.equal(ctx.meta.tier1Tokens > 0, true);
});
