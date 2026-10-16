'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const apiSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'api.js'), 'utf8');

function createApiManager(clock) {
    let fetchCalls = 0;
    const context = {
        window: { CONFIG: { openRouterBase: 'https://openrouter.ai/api/v1' } },
        location: { origin: 'https://coach.example' },
        Date: { now: () => clock.now },
        TextDecoder,
        fetch: async () => {
            fetchCalls++;
            return {
                ok: true,
                body: {
                    getReader: () => ({ read: async () => ({ done: true }) })
                }
            };
        }
    };
    vm.runInNewContext(apiSource, context);
    const storage = {
        getSettings: () => ({
            openrouterKey: 'test-key',
            model: 'test/free-model'
        })
    };
    return {
        api: new context.window.ApiManager(storage),
        getFetchCalls: () => fetchCalls
    };
}

test('free model requests are capped at 20 per rolling minute per tab', async () => {
    const clock = { now: 1000 };
    const manager = createApiManager(clock);

    for (let i = 0; i < 20; i++) {
        await manager.api.chat([]);
    }

    await assert.rejects(
        manager.api.chat([]),
        /free-model limit of 20 requests per rolling minute.*60 seconds/
    );
    assert.equal(manager.getFetchCalls(), 20);
});

test('free model request capacity returns as the rolling minute expires', async () => {
    const clock = { now: 1000 };
    const manager = createApiManager(clock);

    for (let i = 0; i < 20; i++) {
        await manager.api.chat([]);
    }
    clock.now = 61000;

    await manager.api.chat([]);
    assert.equal(manager.getFetchCalls(), 21);
});

test('each open tab has its own free model request counter', async () => {
    const clock = { now: 1000 };
    const firstTab = createApiManager(clock);
    const secondTab = createApiManager(clock);

    for (let i = 0; i < 20; i++) {
        await firstTab.api.chat([]);
    }
    await assert.rejects(firstTab.api.chat([]), /free-model limit/);

    await secondTab.api.chat([]);
    assert.equal(secondTab.getFetchCalls(), 1);
});
