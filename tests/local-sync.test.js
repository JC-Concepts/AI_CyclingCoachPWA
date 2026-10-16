'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadLocalSync(workerResponse) {
    class FakeWorker {
        constructor() {}
        postMessage() {
            Promise.resolve().then(() => this.onmessage({ data: workerResponse }));
        }
        terminate() {}
    }
    const context = {
        window: { CONFIG: { pyodideVersion: '0.27.7' } },
        document: { currentScript: { src: 'http://localhost/js/local-sync.js' } },
        Worker: FakeWorker,
        URL: URL,
        location: { href: 'http://localhost/' }
    };
    vm.runInNewContext(fs.readFileSync('js/local-sync.js', 'utf8'), context);
    return context.window.LocalIntervalsSync;
}

function connectedDrive() {
    const writes = [];
    return {
        writes,
        isConnected: () => true,
        getFile: async () => null,
        putFile: async (path, text, version) => {
            writes.push({ path, text, version });
        }
    };
}

test('first local sync does not require an existing latest.json on Drive', async () => {
    const drive = connectedDrive();
    const LocalIntervalsSync = loadLocalSync({
        type: 'result',
        files: { 'latest.json': '{"recent_activities":[]}' }
    });
    const sync = new LocalIntervalsSync(drive);
    const result = await sync.run({
        athleteId: 'i1',
        intervalsKey: 'test-key',
        pathForFile: name => 'Users/i1/i1_' + name
    });

    assert.deepEqual(Array.from(result.saved), ['latest.json']);
    assert.equal(drive.writes[0].path, 'Users/i1/i1_latest.json');
    assert.equal(drive.writes[0].version, null);
});

test('missing worker snapshot produces an explicit first-sync diagnostic', async () => {
    const LocalIntervalsSync = loadLocalSync({ type: 'result', files: {} });
    const sync = new LocalIntervalsSync(connectedDrive());
    await assert.rejects(sync.run({
        athleteId: 'i1',
        intervalsKey: 'test-key',
        pathForFile: name => 'Users/i1/i1_' + name
    }), /newly generated latest\.json snapshot.*previous latest\.json file is not required/i);
});

test('sync worker posts result files at the top level for local-sync.js', async () => {
    const messages = [];
    let runCount = 0;
    const workerSelf = {
        location: { href: 'http://localhost/js/sync-worker.js' },
        postMessage: message => messages.push(message),
        close: () => {}
    };
    const pyodide = {
        FS: {
            mkdirTree: () => {},
            chdir: () => {},
            writeFile: () => {}
        },
        globals: {
            set: () => {},
            get: () => ({
                toString: () => JSON.stringify({
                    files: { 'latest.json': '{"recent_activities":[]}' }
                })
            })
        },
        loadPackage: async () => {},
        runPythonAsync: async () => {
            runCount++;
        }
    };
    const context = {
        self: workerSelf,
        URL,
        encodeURIComponent,
        importScripts: () => {},
        loadPyodide: async () => pyodide,
        fetch: async () => ({ ok: true, text: async () => 'sync source' })
    };
    vm.runInNewContext(fs.readFileSync('js/sync-worker.js', 'utf8'), context);

    await workerSelf.onmessage({
        data: { pyodideVersion: '0.27.7', athleteId: 'i1', intervalsKey: 'test-key' }
    });

    const result = messages.find(message => message.type === 'result');
    assert.ok(result);
    assert.equal(result.files['latest.json'], '{"recent_activities":[]}');
    assert.equal(result.message, undefined);
    assert.equal(runCount, 2);
});
