'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/catalog.js');

const FIELDS = ['id', 'name', 'author', 'category', 'subcategory', 'duration_seconds',
    'duration_category', 'tss', 'primary_zone', 'avg_power', 'file', 'description'];

function compact() {
    return {
        source: 'wg', source_version: '1.0', count: 4,
        fields: FIELDS,
        workouts: [
            ['workout_a', 'Endurance 90', 'me', 'Endurance', 'Steady', 5400, '60_90', 70, 2, 200, 'a.zwo', 'steady aerobic'],
            ['workout_b', 'Sweet Spot 60', 'me', 'SweetSpot', 'Long', 3600, '45-60', 85, 3, 230, 'b.zwo', 'sweet spot'],
            ['workout_c', 'VO2 30', 'me', 'VO2Max', 'Short', 1800, 'less_30', 60, 5, 280, 'c.zwo', 'vo2 intervals'],
            ['workout_d', 'Endurance 120', 'me', 'Endurance', 'Long', 7200, 'greater_90', 110, 2, 205, 'd.zwo', 'long aerobic']
        ]
    };
}

test('parseCatalog handles compact schema', () => {
    const rows = C.parseCatalog(compact());
    assert.equal(rows.length, 4);
    assert.equal(rows[0].name, 'Endurance 90');
    assert.equal(rows[0].duration_seconds, 5400);
    assert.equal(rows[2].primary_zone, 5);
});

test('parseCatalog handles full manifest schema', () => {
    const rows = C.parseCatalog({ workouts: [{ id: 'workout_x', name: 'X', duration_seconds: '1200', tss: '50', primary_zone: 4 }] });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].duration_seconds, 1200);
    assert.equal(rows[0].tss, 50);
});

test('parseCatalog tolerates junk', () => {
    assert.deepEqual(C.parseCatalog(null), []);
    assert.deepEqual(C.parseCatalog('not json'), []);
    assert.deepEqual(C.parseCatalog({}), []);
});

test('filterCatalog filters by zone and duration window', () => {
    const rows = C.parseCatalog(compact());
    const out = C.filterCatalog(rows, { zones: [2] });
    assert.equal(out.length, 2);
    const out2 = C.filterCatalog(rows, { duration_min: 60, duration_max: 120 });
    assert.deepEqual(out2.map(r => r.id).sort(), ['workout_a', 'workout_b', 'workout_d'].sort());
});

test('filterCatalog filters by tss and keywords', () => {
    const rows = C.parseCatalog(compact());
    const out = C.filterCatalog(rows, { tss_min: 80, tss_max: 100 });
    assert.deepEqual(out.map(r => r.id), ['workout_b']);
    const kw = C.filterCatalog(rows, { category_keywords: ['vo2'] });
    assert.deepEqual(kw.map(r => r.id), ['workout_c']);
});

test('filterCatalog ranks by proximity to duration midpoint', () => {
    const rows = C.parseCatalog(compact());
    const out = C.filterCatalog(rows, { zones: [2], duration_min: 90, duration_max: 90 });
    assert.equal(out[0].id, 'workout_a');
});

test('filterCatalog respects limit', () => {
    const rows = C.parseCatalog(compact());
    assert.equal(C.filterCatalog(rows, { limit: 2 }).length, 2);
});

test('toCandidate and formatCandidates produce bounded rows', () => {
    const rows = C.parseCatalog(compact());
    const cand = C.toCandidate(rows[0]);
    assert.equal(cand.duration_min, 90);
    assert.equal(cand.zone, 2);
    const text = C.formatCandidates(rows);
    assert.ok(text.includes('workout_a'));
    assert.ok(text.split('\n').length <= 6);
    assert.ok(C.formatCandidates([]).includes('No catalog'));
});
