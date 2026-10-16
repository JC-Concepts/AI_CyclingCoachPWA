'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const GoogleDriveStore = require('../js/google-drive.js');

function connectedStore(fetch, extraOptions) {
    const fakeWindow = {
        google: {
            accounts: {
                oauth2: {
                    initTokenClient: function (options) {
                        assert.equal(options.scope, GoogleDriveStore.DRIVE_SCOPE);
                        return {
                            requestAccessToken: function () {
                                options.callback({ access_token: 'test-token', expires_in: 3600 });
                            }
                        };
                    },
                    revoke: function () {}
                }
            }
        }
    };
    const store = new GoogleDriveStore(Object.assign({
        window: fakeWindow,
        fetch: fetch
    }, extraOptions || {}));
    return store.connect('public-client-id.example.apps.googleusercontent.com').then(function () {
        return store;
    });
}

function response(status, value, text) {
    return {
        status: status,
        ok: status >= 200 && status < 300,
        json: async function () { return value; },
        text: async function () { return text || ''; }
    };
}

test('connect requests only the Google Drive file scope', async () => {
    const store = await connectedStore(function () { throw new Error('unexpected request'); });
    assert.equal(store.isConnected(), true);
});

test('file reads use the visible AI Coach/<AthleteID> folder hierarchy', async () => {
    const calls = [];
    const responses = [
        { files: [{ id: 'coach-folder', name: 'AI Coach' }] },
        { files: [{ id: 'athlete-folder', name: 'i1' }] },
        { files: [{ id: 'file-1', name: 'i1_latest.json', headRevisionId: 'rev-1' }] }
    ];
    const store = await connectedStore(async function (url, options) {
        calls.push({ url: url, options: options });
        if (calls.length <= responses.length) return response(200, responses[calls.length - 1]);
        return response(200, null, '{"ok":true}');
    });

    const file = await store.getFile('Users/i1/i1_latest.json');
    assert.equal(file.text, '{"ok":true}');
    assert.equal(file.sha, 'rev-1');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
    assert.match(decodeURIComponent(calls[0].url), /name='AI Coach'/);
    assert.match(decodeURIComponent(calls[1].url), /'coach-folder' in parents/);
    assert.match(decodeURIComponent(calls[2].url), /'athlete-folder' in parents/);
});

test('new files are saved under AI Coach/<AthleteID>', async () => {
    class TestBlob {
        constructor(parts, options) {
            this.parts = parts;
            this.type = options.type;
        }
    }
    class TestFormData {
        constructor() { this.values = {}; }
        append(name, value) { this.values[name] = value; }
    }

    const calls = [];
    const store = await connectedStore(async function (url, options) {
        calls.push({ url: url, options: options });
        if (calls.length === 1 || calls.length === 3 || calls.length === 5) {
            return response(200, { files: [] });
        }
        if (calls.length === 2) return response(200, { id: 'coach-folder', name: 'AI Coach' });
        if (calls.length === 4) return response(200, { id: 'athlete-folder', name: 'i1' });
        return response(200, { id: 'new-file', name: 'i1_memory.json', headRevisionId: 'rev-1' });
    }, { FormData: TestFormData, Blob: TestBlob });

    const result = await store.putFile('Users/i1/i1_memory.json', '{}', null);
    assert.equal(result.id, 'new-file');
    const metadata = JSON.parse(calls[5].options.body.values.metadata.parts[0]);
    assert.deepEqual(metadata.parents, ['athlete-folder']);
    assert.equal(metadata.name, 'i1_memory.json');
});

test('ongoing chat transcript is stored under the sessions subfolder', async () => {
    class TestBlob {
        constructor(parts, options) { this.parts = parts; this.type = options.type; }
    }
    class TestFormData {
        constructor() { this.values = {}; }
        append(name, value) { this.values[name] = value; }
    }
    const calls = [];
    const store = await connectedStore(async function (url, options) {
        calls.push({ url: url, options: options });
        const query = decodeURIComponent(url);
        if (options && options.method === 'POST' && !url.includes('/upload/')) {
            const metadata = JSON.parse(options.body);
            return response(200, { id: metadata.name.toLowerCase().replace(/\s/g, '-') + '-folder' });
        }
        if (url.includes('/upload/')) {
            return response(200, { id: 'chat-file', name: 'ongoing.json', headRevisionId: 'rev-1' });
        }
        return response(200, { files: [] });
    }, { FormData: TestFormData, Blob: TestBlob });

    await store.putFile('Users/i1/sessions/ongoing.json', '{"messages":[]}', null);
    const folderMetadata = calls.filter(call => call.options.method === 'POST' &&
        !call.url.includes('/upload/')).map(call => JSON.parse(call.options.body));
    const upload = calls.find(call => call.url.includes('/upload/'));
    const fileMetadata = JSON.parse(upload.options.body.values.metadata.parts[0]);
    assert.deepEqual(folderMetadata.map(folder => folder.name), ['AI Coach', 'i1', 'sessions']);
    assert.deepEqual(fileMetadata.parents, ['sessions-folder']);
    assert.equal(fileMetadata.name, 'ongoing.json');
});

test('a changed Drive revision is reported as a conflict', async () => {
    const store = await connectedStore(async function (url) {
        if (url.indexOf('/files?') >= 0 && decodeURIComponent(url).indexOf('mimeType=') !== -1) {
            return response(200, { files: [{ id: 'folder-' + (url.indexOf('AI Coach') !== -1 ? 'root' : 'athlete') }] });
        }
        return response(200, { files: [{ id: 'file-1', headRevisionId: 'rev-2' }] });
    });
    await assert.rejects(store.putFile('Users/i1/i1_memory.json', '{}', 'rev-1'), function (error) {
        return error.code === 409;
    });
});

test('chat session files are listed from the athlete sessions folder with pagination', async () => {
    const calls = [];
    const store = await connectedStore(async function (url, options) {
        calls.push({ url: url, options: options });
        if (calls.length === 1) return response(200, { files: [{ id: 'coach-folder' }] });
        if (calls.length === 2) return response(200, { files: [{ id: 'athlete-folder' }] });
        if (calls.length === 3) return response(200, { files: [{ id: 'sessions-folder' }] });
        if (calls.length === 4) return response(200, {
            files: [{ id: 'session-file-1', name: 'session-1.json', mimeType: 'application/json' }],
            nextPageToken: 'page-2'
        });
        return response(200, {
            files: [{ id: 'session-file-2', name: 'session-2.json', mimeType: 'application/json' }]
        });
    });

    const files = await store.listFiles('Users/i1/sessions');
    assert.deepEqual(files.map(file => file.name), ['session-1.json', 'session-2.json']);
    assert.match(decodeURIComponent(calls[2].url), /name='sessions'/);
    assert.match(calls[4].url, /pageToken=page-2/);
});

test('chat session files can be deleted from Google Drive', async () => {
    const calls = [];
    const store = await connectedStore(async function (url, options) {
        calls.push({ url: url, options: options });
        if (options && options.method === 'DELETE') return response(204, null);
        const query = decodeURIComponent(url);
        if (query.indexOf("name='AI Coach'") >= 0) return response(200, { files: [{ id: 'coach-folder' }] });
        if (query.indexOf("name='i1'") >= 0) return response(200, { files: [{ id: 'athlete-folder' }] });
        if (query.indexOf("name='sessions'") >= 0) return response(200, { files: [{ id: 'sessions-folder' }] });
        return response(200, { files: [{ id: 'session-file' }] });
    });

    assert.equal(await store.deleteFile('Users/i1/sessions/session-1.json'), true);
    assert.equal(calls[calls.length - 1].options.method, 'DELETE');
    assert.match(calls[calls.length - 1].url, /session-file/);
});

test('invalid logical data paths are rejected', async () => {
    const store = await connectedStore(function () { throw new Error('unexpected request'); });
    await assert.rejects(store.getFile('Users/../secrets.json'), /Invalid athlete data path/);
    await assert.rejects(store.getFile('Users/i1/private/secrets.json'), /Invalid athlete data path/);
});

test('an expired or missing token requires a new user authorization', async () => {
    const store = new GoogleDriveStore({ fetch: async function () { throw new Error('must not fetch'); } });
    await assert.rejects(store.getFile('Users/i1/i1_latest.json'), function (error) {
        return error.code === 'AUTH_REQUIRED';
    });
});
