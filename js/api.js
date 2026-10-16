/**
 * api.js - Network layer: Intervals.icu and OpenRouter.
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
    function ApiManager(storage) {
        this.storage = storage || new window.StorageManager();
    }

    ApiManager.prototype._settings = function () {
        return this.storage.getSettings();
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
})();
