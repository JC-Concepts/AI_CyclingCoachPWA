'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const apiSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'api.js'), 'utf8');

function createApiManager(clock, settings, onFetch) {
    let fetchCalls = 0;
    const context = {
        window: { CONFIG: {
            openRouterBase: 'https://openrouter.ai/api/v1',
            catalogWorkoutsBase: 'https://raw.githubusercontent.com/JC-Concepts/WorkoutGenerator/refs/heads/main/workouts',
            geminiBase: 'https://generativelanguage.googleapis.com/v1beta',
            geminiOpenAiBase: 'https://generativelanguage.googleapis.com/v1beta/openai'
        } },
        location: { origin: 'https://coach.example' },
        Date: { now: () => clock.now },
        TextDecoder,
        fetch: async (...args) => {
            fetchCalls++;
            const customResponse = onFetch ? await onFetch(...args) : null;
            if (customResponse) return customResponse;
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
        getSettings: () => Object.assign({
            openrouterKey: 'test-key',
            model: 'test/free-model'
        }, settings || {})
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

test('Gemini requests use the selected Gemini model and API key without OpenRouter headers', async () => {
    const clock = { now: 1000 };
    let request;
    const manager = createApiManager(clock, {
        provider: 'gemini',
        geminiKey: 'gemini-test-key',
        geminiModel: 'gemini-2.5-flash'
    }, (url, options) => { request = { url, options }; });

    await manager.api.chat([{ role: 'user', content: 'Hello' }]);

    assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    assert.equal(request.options.headers.Authorization, 'Bearer gemini-test-key');
    assert.equal(request.options.headers['HTTP-Referer'], undefined);
    assert.deepEqual(JSON.parse(request.options.body).model, 'gemini-2.5-flash');
    assert.equal(manager.getFetchCalls(), 1);
});

test('Gemini model discovery paginates and returns only chat-capable Gemini models', async () => {
    const clock = { now: 1000 };
    const requests = [];
    const manager = createApiManager(clock, {}, async (url, options) => {
        requests.push({ url, options });
        const secondPage = url.includes('pageToken=next');
        return {
            ok: true,
            json: async () => secondPage ? {
                models: [{
                    name: 'models/gemini-3.8-flash',
                    displayName: 'Gemini 3.8 Flash',
                    inputTokenLimit: 100000,
                    supportedGenerationMethods: ['generateContent']
                }]
            } : {
                models: [
                    {
                        name: 'models/gemini-2.5-flash',
                        displayName: 'Gemini 2.5 Flash',
                        supportedGenerationMethods: ['generateContent']
                    },
                    {
                        name: 'models/gemini-embedding-001',
                        supportedGenerationMethods: ['embedContent']
                    },
                    {
                        name: 'models/other-model',
                        supportedGenerationMethods: ['generateContent']
                    }
                ],
                nextPageToken: 'next'
            }
        };
    });

    const models = await manager.api.listGeminiModels('gemini-test-key');

    assert.deepEqual(Array.from(models, model => model.id), ['gemini-2.5-flash', 'gemini-3.8-flash']);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].options.headers['x-goog-api-key'], 'gemini-test-key');
    assert.match(requests[1].url, /pageToken=next/);
});

test('Gemini model discovery requires a key and surfaces API errors', async () => {
    const manager = createApiManager({ now: 1000 }, {}, async () => ({
        ok: false,
        status: 403,
        text: async () => 'API key not authorized'
    }));
    await assert.rejects(manager.api.listGeminiModels(''), /API key is required/);
    await assert.rejects(manager.api.listGeminiModels('bad-key'), /403 API key not authorized/);
});

test('catalog workout fetch preserves nested folders for push and download', async () => {
    const manager = createApiManager({ now: 1000 }, {}, async (url) => {
        assert.equal(
            url,
            'https://raw.githubusercontent.com/JC-Concepts/WorkoutGenerator/refs/heads/main/workouts/zwift_workouts_all_collections_ordered_Nov20/Le_Col/Anaerobic_Blast_Cancellara.zwo'
        );
        return { ok: true, text: async () => '<workout_file />' };
    });

    const content = await manager.api.fetchCatalogWorkout(
        'zwift_workouts_all_collections_ordered_Nov20/Le_Col/Anaerobic_Blast_Cancellara.zwo'
    );
    assert.equal(content, '<workout_file />');
});

test('catalog workout fetch rejects unsafe paths and reports missing workout paths', async () => {
    const manager = createApiManager({ now: 1000 }, {}, async () => ({
        ok: false,
        status: 404,
        text: async () => ''
    }));
    await assert.rejects(manager.api.fetchCatalogWorkout('../secret.zwo'), /Invalid workout catalog file path/);
    await assert.rejects(
        manager.api.fetchCatalogWorkout('TrainerDay/missing.zwo'),
        /Workout file fetch failed: 404 \(TrainerDay\/missing\.zwo\)/
    );
});
