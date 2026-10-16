'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/prompt.js');
const Context = require('../js/context.js');

test('SYSTEM_PROMPT contains the protocol anchors and placeholders', () => {
    assert.ok(P.SYSTEM_PROMPT.includes('Section 11'));
    assert.ok(P.SYSTEM_PROMPT.includes('v11.71'));
    for (const ph of ['{{DATETIME}}', '{{TZ}}', '{{ATHLETE_ID}}', '{{MEMORY_SUMMARY}}', '{{DOSSIER_STATE}}']) {
        assert.ok(P.SYSTEM_PROMPT.includes(ph), 'missing ' + ph);
    }
});

test('SYSTEM_PROMPT is within the sanity budget (conservative len/4 estimate)', () => {
    // estimateTokens uses ceil(len/4), which over-counts vs real BPE tokenizers;
    // the bound is set to catch ballooning of the verbatim §A prompt, not to be exact.
    assert.ok(Context.estimateTokens(P.SYSTEM_PROMPT) <= 1800);
});

test('fillSystemPrompt replaces all placeholders and leaves none behind', () => {
    const filled = P.fillSystemPrompt({
        DATETIME: '2030-01-01T00:00:00Z',
        TZ: 'Europe/London',
        ATHLETE_ID: 'i999',
        MEMORY_SUMMARY: 'ftp rising',
        DOSSIER_STATE: 'missing'
    });
    assert.ok(!/\{\{\w+\}\}/.test(filled));
    assert.ok(filled.includes('Europe/London'));
    assert.ok(filled.includes('i999'));
    assert.ok(filled.includes('missing'));
});

test('buildContext systemVars satisfy the prompt placeholder contract', () => {
    const ctx = Context.buildContext({
        settings: { athleteId: 'i1' },
        memory: { summary: { standing_topics: ['a'], coach_notes: 'b' } },
        dossier: '',
        now: Date.parse('2030-01-01T00:00:00Z'),
        timezone: 'UTC'
    });
    const filled = P.fillSystemPrompt(ctx.systemVars);
    assert.ok(!/\{\{\w+\}\}/.test(filled));
});
