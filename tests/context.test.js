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

test('buildContext includes relevant cached files for phenotype requests', () => {
    const ctx = C.buildContext({
        latest: Object.assign(latestFresh(), {
            current_status: { thresholds: { eftp: 250 } },
            recent_activities: [{ date: '2030-01-09', average_watts: 300 }]
        }),
        history: { daily_90d: [{ date: '2030-01-01', power: 300 }] },
        intervals: { activities: [{ id: 'ride-1' }] },
        routes: { events: [{ name: 'Gran Fondo' }] },
        savedWorkouts: { workouts: [{ name: 'Tempo' }] },
        ftpHistory: { indoor: { '2030-01-01': 250 } },
        intent: 'Please run Skills/phenotype-agent.md to assess my cycling phenotype',
        now: NOW
    });
    [
        '-- history.json (Tier 2) --',
        '-- intervals.json (Tier 2) --',
        '-- routes.json (Tier 2) --',
        '-- saved_workouts.json (Tier 2) --',
        '-- ftp_history.json (Tier 2) --'
    ]
        .forEach(section => assert.ok(ctx.dataMessage.includes(section)));
    assert.ok(ctx.dataMessage.includes('-- Latest data (Tier 1; phenotype sources) --'));
    const latestSection = ctx.dataMessage.split('-- Latest data (Tier 1; phenotype sources) --\n')[1]
        .split('\n-- ')[0];
    assert.ok(latestSection.includes('current_status'));
    assert.ok(latestSection.includes('recent_activities'));
});

test('buildContext includes saved workouts when the athlete asks about them', () => {
    const ctx = C.buildContext({
        savedWorkouts: { workouts: [{ name: 'Tempo' }] },
        intent: 'Which saved workouts are already on my calendar?',
        now: NOW
    });
    assert.ok(ctx.dataMessage.includes('-- saved_workouts.json (Tier 2) --'));
});

test('buildContext explains file availability without injecting unrelated Tier 2 data', () => {
    const ctx = C.buildContext({
        latest: latestFresh(),
        history: { daily_90d: [] },
        intent: 'How ready am I today?',
        now: NOW
    });
    assert.ok(ctx.dataMessage.includes('history.json: cached'));
    assert.ok(ctx.dataMessage.includes('intervals.json: not cached'));
    assert.ok(!ctx.dataMessage.includes('-- history.json (Tier 2) --'));
});

test('trimmed JSON remains parseable and marks omitted content', () => {
    const ctx = C.buildContext({
        latest: latestFresh(),
        history: { daily_90d: Array.from({ length: 500 }, (_, index) => ({ date: String(index), value: 'x'.repeat(200) })) },
        intent: 'history trend',
        now: NOW
    });
    const section = ctx.dataMessage.split('-- history.json (Tier 2) --\n')[1].split('\n-- ')[0];
    const parsed = JSON.parse(section);
    assert.equal(parsed.truncated, true);
    assert.ok(parsed.omitted_items > 0);
});

test('selectHistory retains recent conversation turns within a token budget, not a fixed count', () => {
    const messages = Array.from({ length: 60 }, (_, index) => ({
        role: index % 2 ? 'assistant' : 'user',
        text: 'turn-' + index
    }));
    const selected = C.selectHistory(messages, 200);
    assert.equal(selected.length, 60);
    assert.equal(selected.at(-1).text, 'turn-59');

    const bounded = C.selectHistory(messages, 3);
    assert.ok(bounded.length < messages.length);
    assert.equal(bounded.at(-1).text, 'turn-59');
});
