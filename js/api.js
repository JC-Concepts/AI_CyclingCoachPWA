/**
 * api.js - Network layer: GitHub (Contents + Actions), Intervals.icu, OpenRouter.
 * Secrets are read from StorageManager settings and never logged.
 *
 * The Intervals upload path reuses the proven WorkoutGenerator recipe
 * (Basic API_KEY auth + file_contents_base64) verbatim.
 * Browser-only module.
 */
'use strict';

(function () {
    var CONFIG = window.CONFIG;

    function b64encodeUnicode(str) {
        return btoa(unescape(encodeURIComponent(str)));
    }
    function b64decodeUnicode(b64) {
        return decodeURIComponent(escape(atob(String(b64).replace(/\n/g, ''))));
    }

    function ApiManager(storage) {
        this.storage = storage || new window.StorageManager();
    }

    ApiManager.prototype._settings = function () {
        return this.storage.getSettings();
    };
    ApiManager.prototype._repo = function () {
        var s = this._settings();
        return {
            owner: s.repoOwner || CONFIG.repoOwner,
            name: s.repoName || CONFIG.repoName,
            branch: s.branch || CONFIG.defaultBranch
        };
    };

    // ------------------------------------------------------------------ GitHub
    ApiManager.prototype._ghHeaders = function () {
        var s = this._settings();
        return {
            'Authorization': 'Bearer ' + (s.githubToken || ''),
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
        };
    };

    ApiManager.prototype.ghValidateRepo = async function () {
        var r = this._repo();
        var res = await fetch(CONFIG.githubApiBase + '/repos/' + r.owner + '/' + r.name, {
            headers: this._ghHeaders()
        });
        if (!res.ok) throw new Error('GitHub repo check failed: ' + res.status);
        return res.json();
    };

    ApiManager.prototype.ghGetFile = async function (path) {
        var r = this._repo();
        var url = CONFIG.githubApiBase + '/repos/' + r.owner + '/' + r.name +
            '/contents/' + encodeURI(path) + '?ref=' + r.branch;
        var res = await fetch(url, { headers: this._ghHeaders() });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error('GitHub read failed: ' + res.status);
        var data = await res.json();
        var text = data.content ? b64decodeUnicode(data.content) : '';
        return { path: path, sha: data.sha, text: text };
    };

    ApiManager.prototype.ghGetJSON = async function (path) {
        var f = await this.ghGetFile(path);
        if (!f || !f.text) return null;
        try { return JSON.parse(f.text); } catch (e) { return null; }
    };

    ApiManager.prototype.ghPutFile = async function (path, text, message, sha) {
        var r = this._repo();
        var url = CONFIG.githubApiBase + '/repos/' + r.owner + '/' + r.name + '/contents/' + encodeURI(path);
        var body = {
            message: message,
            content: b64encodeUnicode(text),
            branch: r.branch
        };
        if (sha) body.sha = sha;
        var res = await fetch(url, {
            method: 'PUT',
            headers: this._ghHeaders(),
            body: JSON.stringify(body)
        });
        if (res.status === 409 || res.status === 422) {
            var err = new Error('GitHub write conflict');
            err.code = 409;
            throw err;
        }
        if (!res.ok) throw new Error('GitHub write failed: ' + res.status + ' ' + (await res.text()));
        return res.json();
    };

    /**
     * Create-or-update a file (fetch current sha first).
     */
    ApiManager.prototype.ghWriteFile = async function (path, text, message) {
        var existing = await this.ghGetFile(path);
        return this.ghPutFile(path, text, message, existing ? existing.sha : undefined);
    };

    ApiManager.prototype.ghDispatchWorkflow = async function (workflowFile, inputs) {
        var r = this._repo();
        var url = CONFIG.githubApiBase + '/repos/' + r.owner + '/' + r.name +
            '/actions/workflows/' + workflowFile + '/dispatches';
        var res = await fetch(url, {
            method: 'POST',
            headers: this._ghHeaders(),
            body: JSON.stringify({ ref: r.branch, inputs: inputs || {} })
        });
        if (res.status !== 204 && !res.ok) {
            throw new Error('Workflow dispatch failed: ' + res.status + ' ' + (await res.text()));
        }
        return true;
    };

    ApiManager.prototype.ghLatestRun = async function (workflowFile) {
        var r = this._repo();
        var url = CONFIG.githubApiBase + '/repos/' + r.owner + '/' + r.name +
            '/actions/workflows/' + workflowFile + '/runs?per_page=1';
        var res = await fetch(url, { headers: this._ghHeaders() });
        if (!res.ok) throw new Error('Run lookup failed: ' + res.status);
        var data = await res.json();
        return (data.workflow_runs && data.workflow_runs[0]) || null;
    };

    /**
     * Poll the newest run of a workflow until it leaves "in_progress"/"queued".
     */
    ApiManager.prototype.ghWaitForRun = async function (workflowFile, opts) {
        opts = opts || {};
        var timeout = opts.timeoutMs || CONFIG.syncPollTimeoutMs;
        var interval = opts.intervalMs || CONFIG.syncPollIntervalMs;
        var started = Date.now();
        while (Date.now() - started < timeout) {
            var run = await this.ghLatestRun(workflowFile);
            if (run && run.status === 'completed') return run;
            await new Promise(function (res) { setTimeout(res, interval); });
        }
        return null;
    };

    // -------------------------------------------------------------- Intervals
    ApiManager.prototype.intervalsValidate = async function (athleteId, key) {
        var res = await fetch(CONFIG.intervalsBase + '/athlete/' + athleteId, {
            headers: { 'Authorization': 'ApiKey ' + key + ':' }
        });
        return res.ok;
    };

    /**
     * Proven upload recipe (WorkoutGenerator ApiManager.uploadToIntervals).
     * @param {string} content  raw .zwo text
     * @param {string} fileName e.g. "workout_abc.zwo"
     * @param {string} dateIso  "YYYY-MM-DDT00:00:00"
     */
    ApiManager.prototype.intervalsUpload = async function (content, fileName, dateIso, athleteId, key, opts) {
        if (!athleteId || !key) throw new Error('Intervals.icu Athlete ID and API key are required');
        opts = opts || {};
        var eventData = {
            start_date_local: dateIso,
            category: 'WORKOUT',
            type: 'Ride',
            name: opts.name || fileName.replace('.zwo', ''),
            description: opts.description || ('Uploaded from ' + fileName),
            indoor: true,
            filename: fileName,
            file_contents_base64: b64encodeUnicode(content)
        };
        var res = await fetch(CONFIG.intervalsBase + '/athlete/' + athleteId + '/events', {
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + btoa('API_KEY:' + key),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(eventData)
        });
        if (!res.ok) throw new Error('Intervals upload failed: ' + res.status + ' ' + (await res.text()));
        var text = await res.text();
        return text ? JSON.parse(text) : { success: true };
    };

    ApiManager.prototype.fetchCatalogWorkout = async function (file) {
        var clean = String(file || '').split('/').pop().replace(/^workouts\//, '');
        var res = await fetch(CONFIG.catalogWorkoutsBase + '/' + clean);
        if (!res.ok) throw new Error('Workout file fetch failed: ' + res.status);
        return res.text();
    };

    /**
     * Fetch from the WG catalog then upload to Intervals.
     */
    ApiManager.prototype.pushCatalogWorkout = async function (file, dateIso, opts) {
        var s = this._settings();
        var content = await this.fetchCatalogWorkout(file);
        return this.intervalsUpload(content, file.split('/').pop(), dateIso, s.athleteId, s.intervalsKey, opts);
    };

    // -------------------------------------------------------------- OpenRouter
    ApiManager.prototype.listModels = async function () {
        var res = await fetch(CONFIG.openRouterBase + '/models');
        if (!res.ok) throw new Error('Model list failed: ' + res.status);
        var data = await res.json();
        return (data.data || []).filter(function (m) {
            var p = m.pricing || {};
            return (p.prompt === '0' && p.completion === '0') || /:free$/.test(m.id);
        }).map(function (m) {
            return { id: m.id, name: m.name || m.id, context: m.context_length || 0 };
        }).sort(function (a, b) { return a.id.localeCompare(b.id); });
    };

    /**
     * Streaming chat completion.
     * @param {Array} messages
     * @param {function} onToken  called with each text delta
     * @returns {Promise<string>} full text
     */
    ApiManager.prototype.chat = async function (messages, opts) {
        opts = opts || {};
        var s = this._settings();
        var model = opts.model || s.model;
        if (!s.openrouterKey) throw new Error('OpenRouter API key is required');
        if (!model) throw new Error('No model selected');

        var res = await fetch(CONFIG.openRouterBase + '/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + s.openrouterKey,
                'Content-Type': 'application/json',
                'HTTP-Referer': location.origin,
                'X-Title': 'AI Cycling Coach'
            },
            body: JSON.stringify({
                model: model,
                messages: messages,
                temperature: opts.temperature != null ? opts.temperature : 0.4,
                stream: true
            }),
            signal: opts.signal
        });
        if (!res.ok) throw new Error('OpenRouter error: ' + res.status + ' ' + (await res.text()));
        if (!res.body || !res.body.getReader) {
            var j = await res.json();
            return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
        }

        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';
        var full = '';
        while (true) {
            var chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });
            var lines = buffer.split('\n');
            buffer = lines.pop();
            for (var i = 0; i < lines.length; i++) {
                var line = lines[i].trim();
                if (!line || line.indexOf('data:') !== 0) continue;
                var payload = line.slice(5).trim();
                if (payload === '[DONE]') continue;
                try {
                    var json = JSON.parse(payload);
                    var delta = json.choices && json.choices[0] && json.choices[0].delta;
                    var piece = delta && delta.content;
                    if (piece) { full += piece; if (opts.onToken) opts.onToken(piece); }
                } catch (e) { /* ignore keep-alive/partial */ }
            }
        }
        return full;
    };

    window.ApiManager = ApiManager;
    window.b64encodeUnicode = b64encodeUnicode;
    window.b64decodeUnicode = b64decodeUnicode;
})();
