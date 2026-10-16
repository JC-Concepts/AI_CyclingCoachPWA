'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../js/blocks.js');

test('escapeHtml neutralizes markup', () => {
    assert.equal(B.escapeHtml('<img src=x onerror=alert(1)>'),
        '&lt;img src=x onerror=alert(1)&gt;');
    assert.equal(B.escapeHtml(`"'&`), '&quot;&#39;&amp;');
    assert.equal(B.escapeHtml(null), '');
});

test('parseBlocks extracts each block type and cleans prose', () => {
    const text = [
        'Here is my plan.',
        '```workout_search',
        '{"intent":"endurance","zones":[2],"duration_min":90,"duration_max":120}',
        '```',
        'Pick one below.',
        '```workout_push',
        '{"workout_id":"workout_abc123","date":"2030-01-02","reason":"base"}',
        '```'
    ].join('\n');
    const r = B.parseBlocks(text);
    assert.equal(r.search.intent, 'endurance');
    assert.deepEqual(r.search.zones, [2]);
    assert.equal(r.push.workout_id, 'workout_abc123');
    assert.equal(r.errors.length, 0);
    assert.ok(!r.cleaned.includes('workout_search'));
    assert.ok(r.cleaned.includes('Here is my plan.'));
    assert.ok(r.cleaned.includes('Pick one below.'));
});

test('parseBlocks records malformed JSON as an error and keeps last valid', () => {
    const text = [
        '```workout_push', '{ bad json', '```',
        '```workout_push', '{"workout_id":"workout_ok","date":"2030-01-02"}', '```'
    ].join('\n');
    const r = B.parseBlocks(text);
    assert.equal(r.errors.length, 1);
    assert.equal(r.errors[0].type, 'workout_push');
    assert.equal(r.push.workout_id, 'workout_ok');
});

test('parseBlocks returns nulls when nothing present', () => {
    const r = B.parseBlocks('just prose');
    assert.equal(r.search, null);
    assert.equal(r.push, null);
    assert.equal(r.dossier, null);
    assert.equal(r.cleaned, 'just prose');
});

test('validatePushBlock enforces id format and future date', () => {
    assert.equal(B.validatePushBlock({ workout_id: 'workout_x', date: '2030-01-01' }, '2030-01-01').ok, true);
    assert.equal(B.validatePushBlock({ workout_id: 'bad', date: '2030-01-01' }, '2030-01-01').ok, false);
    assert.equal(B.validatePushBlock({ workout_id: 'workout_x', date: '2020-01-01' }, '2030-01-01').ok, false);
    assert.equal(B.validatePushBlock({ workout_id: 'workout_x', date: '2030-13-40' }, '2030-01-01').ok, false);
    assert.equal(B.validatePushBlock(null, '2030-01-01').ok, false);
});

test('normalizeSearchBlock coerces and filters types', () => {
    const q = B.normalizeSearchBlock({
        intent: 'threshold', zones: ['2', 3, 'x'], duration_min: '60',
        tss_min: '80', category_keywords: ['over', 5], limit: '5'
    });
    assert.equal(q.intent, 'threshold');
    assert.deepEqual(q.zones, [2, 3]);
    assert.equal(q.duration_min, 60);
    assert.deepEqual(q.category_keywords, ['over']);
    assert.equal(q.limit, 5);
});

test('markdownToSafeHtml escapes script and renders markdown', () => {
    const html = B.markdownToSafeHtml('# Title\n\n**bold** and *it* and `code`\n\n- a\n- b');
    assert.ok(html.includes('<h1>Title</h1>'));
    assert.ok(html.includes('<strong>bold</strong>'));
    assert.ok(html.includes('<em>it</em>'));
    assert.ok(html.includes('<code>code</code>'));
    assert.ok(html.includes('<ul>') && html.includes('<li>a</li>'));
    assert.ok(!html.includes('<script>'));
});

test('markdownToSafeHtml escapes injected HTML and filters unsafe links', () => {
    const html = B.markdownToSafeHtml('<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))');
    assert.ok(!html.includes('<img'));
    assert.ok(html.includes('&lt;img'));
    assert.ok(!/<a\s/i.test(html));
    assert.ok(!html.includes('href="javascript'));
});

test('markdownToSafeHtml renders fenced code and tables', () => {
    const html = B.markdownToSafeHtml('```js\nconst a = 1 < 2;\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |');
    assert.ok(html.includes('<pre class="md-pre"><code>'));
    assert.ok(html.includes('1 &lt; 2'));
    assert.ok(html.includes('<table class="md-table">'));
    assert.ok(html.includes('<th>a</th>'));
    assert.ok(html.includes('<td>2</td>'));
});
