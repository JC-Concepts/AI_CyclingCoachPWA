'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const SkillsLoader = require('../js/skills.js');
const { StorageManager, MemoryBackend } = require('../js/storage.js');

function response(ok, value, text) {
    return {
        ok: ok,
        status: ok ? 200 : 503,
        json: async function () { return value; },
        text: async function () { return text || ''; }
    };
}

function createStorage() {
    return new StorageManager(new MemoryBackend());
}

test('loads every discovered Markdown file without a filename allowlist', async () => {
    const storage = createStorage();
    const fetched = [];
    const loader = new SkillsLoader(storage, {
        apiUrl: 'https://api.github.com/repos/example/coach/contents/Skills?ref=main',
        now: function () { return 1000; },
        fetch: async function (url) {
            fetched.push(url);
            if (url.indexOf('api.github.com') >= 0) {
                return response(true, [
                    { type: 'dir', name: 'nested', download_url: null },
                    { type: 'file', name: 'new-skill.md', download_url: 'https://raw.githubusercontent.com/example/coach/new-skill.md' },
                    { type: 'file', name: 'notes.txt', download_url: 'https://raw.githubusercontent.com/example/coach/notes.txt' },
                    { type: 'file', name: 'existing.md', download_url: 'https://raw.githubusercontent.com/example/coach/existing.md' }
                ]);
            }
            return response(true, null, 'content for ' + url.split('/').pop());
        }
    });

    const result = await loader.load();
    assert.deepEqual(result.skills.map(function (skill) { return skill.name; }),
        ['existing.md', 'new-skill.md']);
    assert.equal(fetched.length, 3);
    assert.match(SkillsLoader.formatForPrompt(result.skills), /Skills\/new-skill\.md/);
});

test('reuses a fresh cache without making requests', async () => {
    const storage = createStorage();
    storage.setJSON('coach.skills.v1', {
        fetchedAt: 900,
        skills: [{ name: 'cached.md', content: 'cached skill' }]
    });
    const loader = new SkillsLoader(storage, {
        apiUrl: 'https://api.github.com/skills',
        now: function () { return 1000; },
        cacheTtlMs: 500,
        fetch: async function () { throw new Error('unexpected request'); }
    });

    const result = await loader.load();
    assert.equal(result.fromCache, true);
    assert.deepEqual(result.skills[0], { name: 'cached.md', content: 'cached skill' });
});

test('discovers newly added skills on launch and reuses unchanged content', async () => {
    const storage = createStorage();
    storage.setJSON('coach.skills.v1', {
        fetchedAt: 900,
        skills: [{ name: 'existing.md', sha: 'same-sha', content: 'cached existing skill' }]
    });
    const fetched = [];
    const loader = new SkillsLoader(storage, {
        apiUrl: 'https://api.github.com/repos/example/coach/contents/Skills?ref=main',
        now: function () { return 1000; },
        fetch: async function (url) {
            fetched.push(url);
            if (url.indexOf('api.github.com') >= 0) {
                return response(true, [
                    { type: 'file', name: 'existing.md', sha: 'same-sha', download_url: 'https://raw.githubusercontent.com/example/coach/existing.md' },
                    { type: 'file', name: 'new-skill.md', sha: 'new-sha', download_url: 'https://raw.githubusercontent.com/example/coach/new-skill.md' }
                ]);
            }
            return response(true, null, 'new skill content');
        }
    });

    const result = await loader.load(true);
    assert.deepEqual(result.skills.map(function (skill) { return skill.name; }),
        ['existing.md', 'new-skill.md']);
    assert.equal(result.skills[0].content, 'cached existing skill');
    assert.equal(result.skills[1].content, 'new skill content');
    assert.equal(fetched.length, 2);
});

test('falls back to stale skills with an explicit warning when refresh fails', async () => {
    const storage = createStorage();
    storage.setJSON('coach.skills.v1', {
        fetchedAt: 100,
        skills: [{ name: 'cached.md', content: 'cached skill' }]
    });
    const loader = new SkillsLoader(storage, {
        apiUrl: 'https://api.github.com/skills',
        now: function () { return 1000; },
        cacheTtlMs: 500,
        fetch: async function () { return response(false); }
    });

    const result = await loader.load();
    assert.equal(result.stale, true);
    assert.match(result.warning, /503/);
    assert.equal(result.skills[0].name, 'cached.md');
});

test('reports a discovery failure when no cached skills are available', async () => {
    const loader = new SkillsLoader(createStorage(), {
        apiUrl: 'https://api.github.com/skills',
        fetch: async function () { return response(false); }
    });
    await assert.rejects(loader.load(), /Could not list public skills/);
});
