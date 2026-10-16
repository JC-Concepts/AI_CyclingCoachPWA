/**
 * local-sync.js - runs the existing Section 11 Python sync engine in a Web Worker.
 * The API key is passed only to that worker and is never persisted or logged here.
 */
'use strict';

(function () {
    var scriptUrl = document.currentScript && document.currentScript.src;

    function LocalIntervalsSync(drive) {
        this.drive = drive;
    }

    LocalIntervalsSync.prototype.run = async function (options) {
        options = options || {};
        if (!this.drive || !this.drive.isConnected()) {
            throw new Error('Connect Google Drive before syncing athlete data.');
        }
        if (!options.athleteId || !options.intervalsKey) {
            throw new Error('Intervals.icu Athlete ID and API key are required.');
        }
        if (typeof Worker === 'undefined') throw new Error('This browser does not support background sync workers.');

        var fileNames = ['latest.json', 'history.json', 'intervals.json', 'routes.json',
            'saved_workouts.json', 'ftp_history.json'];
        var files = {};
        var versions = {};
        var paths = {};
        for (var i = 0; i < fileNames.length; i++) {
            var filename = fileNames[i];
            var path = options.pathForFile(filename);
            paths[filename] = path;
            var stored = await this.drive.getFile(path);
            if (stored) {
                files[filename] = stored.text;
                versions[filename] = stored.sha;
            } else {
                versions[filename] = null;
            }
        }

        var workerUrl = scriptUrl
            ? new URL('sync-worker.js', scriptUrl)
            : new URL('js/sync-worker.js', location.href);
        var worker = new Worker(workerUrl);
        var self = this;
        return new Promise(function (resolve, reject) {
            var settled = false;

            function finish(error, result) {
                if (settled) return;
                settled = true;
                worker.terminate();
                if (error) reject(error);
                else resolve(result);
            }

            worker.onmessage = async function (event) {
                var message = event.data || {};
                if (message.type === 'progress') {
                    if (options.onProgress) options.onProgress(message.message);
                    return;
                }
                if (message.type === 'error') {
                    finish(new Error(message.message || 'On-device sync failed.'));
                    return;
                }
                if (message.type !== 'result') return;

                try {
                    if (message.error) throw new Error(message.error);
                    var returned = message.files || {};
                    if (!Object.prototype.hasOwnProperty.call(returned, 'latest.json') ||
                            typeof returned['latest.json'] !== 'string') {
                        throw new Error('The sync worker completed without returning its newly generated latest.json snapshot. ' +
                            'A previous latest.json file is not required for the first sync.');
                    }
                    var saved = [];
                    for (var j = 0; j < fileNames.length; j++) {
                        var name = fileNames[j];
                        if (!Object.prototype.hasOwnProperty.call(returned, name)) continue;
                        try {
                            await self.drive.putFile(paths[name], returned[name], versions[name]);
                            saved.push(name);
                        } catch (error) {
                            error.message = 'Could not save ' + name +
                                (saved.length ? '; already saved: ' + saved.join(', ') : '') +
                                '. ' + error.message;
                            throw error;
                        }
                    }
                    finish(null, { files: returned, saved: saved });
                } catch (error) {
                    finish(error);
                }
            };
            worker.onerror = function (event) {
                finish(new Error(event.message || 'On-device sync worker failed.'));
            };
            worker.postMessage({
                athleteId: options.athleteId,
                intervalsKey: options.intervalsKey,
                days: options.days || 7,
                files: files,
                pyodideVersion: window.CONFIG.pyodideVersion
            });
        });
    };

    window.LocalIntervalsSync = LocalIntervalsSync;
})();
