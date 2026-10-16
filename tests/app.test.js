'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const context = {
    window: {
        CONFIG: {},
        CoachSettings: { validateSettings: () => ({ ok: true }) }
    },
    document: { addEventListener: () => {} },
    console
};
vm.runInNewContext(appSource, context);

test('loading Gemini models preserves and saves the model currently selected in Settings', async () => {
    const savedSettings = {
        geminiKey: 'test-key',
        geminiModel: 'gemini-2.5-flash'
    };
    const selector = { value: 'gemini-3.8-flash' };
    let displayedModel;
    const app = Object.create(context.window.App.prototype);
    app.storage = {
        getSettings: () => Object.assign({}, savedSettings),
        patchSettings: patch => Object.assign(savedSettings, patch)
    };
    app.api = {
        listGeminiModels: async () => [
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
            { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' }
        ]
    };
    app.ui = {
        $: id => id === 'setGeminiKey' ? { value: 'test-key' } : selector,
        fillGeminiModelSelect: (models, current) => {
            displayedModel = current;
            if (models.some(model => model.id === current)) selector.value = current;
        }
    };

    await app.loadGeminiModels(false);

    assert.equal(displayedModel, 'gemini-3.8-flash');
    assert.equal(selector.value, 'gemini-3.8-flash');
    assert.equal(savedSettings.geminiModel, 'gemini-3.8-flash');
});

test('Coach workout preview opens the catalog workout detail modal with its planned push', () => {
    const workout = { id: 'workout_123', name: 'Threshold set', file: 'TrainerDay/threshold.zwo' };
    const push = { workout_id: 'workout_123', date: '2030-01-02', reason: 'Threshold work' };
    let preview;
    const app = Object.create(context.window.App.prototype);
    app.catalog = [workout];
    app.ui = {
        showWorkoutDetail: (selected, scheduledPush) => { preview = { selected, scheduledPush }; },
        appendSystemNote: message => assert.fail(message)
    };

    app.previewCoachWorkout(push);

    assert.equal(preview.selected, workout);
    assert.equal(preview.scheduledPush.workout_id, push.workout_id);
    assert.equal(preview.scheduledPush.date, push.date);
    assert.equal(preview.scheduledPush.reason, push.reason);
    assert.equal(app._pendingCoachPush.workout_id, push.workout_id);
    assert.equal(app._pendingCoachPush.date, push.date);
    assert.equal(app._pendingCoachPush.reason, push.reason);
});

test('Coach upload action preserves its scheduled date and reason', () => {
    const workout = { id: 'workout_123' };
    const push = { workout_id: 'workout_123', date: '2030-01-02', reason: 'Threshold work' };
    let confirmed;
    const app = Object.create(context.window.App.prototype);
    app._pendingCoachPush = push;
    app.ui = { closeModal: id => assert.equal(id, 'workoutModal') };
    app.confirmPush = async request => { confirmed = request; };
    const previousSelection = context.window.selectedWorkout;
    context.window.selectedWorkout = workout;

    try {
        app.pushSelectedWorkout();
    } finally {
        context.window.selectedWorkout = previousSelection;
    }

    assert.equal(confirmed, push);
    assert.equal(app._pendingCoachPush, null);
});

test('confirmPush downloads the catalog path and uploads the workout file', async () => {
    const workout = {
        id: 'workout_123',
        file: 'TrainerDay/threshold.zwo'
    };
    let fetchedFile;
    let upload;
    const app = Object.create(context.window.App.prototype);
    app.catalog = [workout];
    app.storage = {
        getSettings: () => ({ athleteId: 'i123', intervalsKey: 'interval-key' })
    };
    app.api = {
        fetchCatalogWorkout: async file => {
            fetchedFile = file;
            return '<workout_file />';
        },
        intervalsUpload: async (...args) => { upload = args; }
    };
    app.ui = {
        showLoading: () => {},
        hideLoading: () => {},
        showToast: () => {}
    };

    await app.confirmPush({
        workout_id: 'workout_123',
        date: '2030-01-02',
        reason: 'Threshold work'
    });

    assert.equal(fetchedFile, 'TrainerDay/threshold.zwo');
    assert.equal(upload[0], '<workout_file />');
    assert.equal(upload[1], 'threshold.zwo');
    assert.equal(upload[2], '2030-01-02T00:00:00');
    assert.equal(upload[3], 'i123');
    assert.equal(upload[4], 'interval-key');
});
