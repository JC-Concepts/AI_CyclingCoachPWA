/**
 * google-drive.js - Google Identity Services token flow and Drive app-data storage.
 * Access tokens remain in memory and are never written to browser storage.
 */
'use strict';

(function (root, factory) {
    var GoogleDriveStore = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = GoogleDriveStore;
    if (root) root.GoogleDriveStore = GoogleDriveStore;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    var DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
    var DRIVE_API = 'https://www.googleapis.com/drive/v3';
    var DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
    var GIS_URL = 'https://accounts.google.com/gsi/client';

    function makeError(message, code, status) {
        var error = new Error(message);
        error.code = code;
        error.status = status;
        return error;
    }

    function GoogleDriveStore(options) {
        options = options || {};
        this.window = options.window || (typeof window !== 'undefined' ? window : null);
        this.document = options.document || (typeof document !== 'undefined' ? document : null);
        this.fetch = options.fetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
        this.FormData = options.FormData || (typeof FormData !== 'undefined' ? FormData : null);
        this.Blob = options.Blob || (typeof Blob !== 'undefined' ? Blob : null);
        this._token = '';
        this._expiresAt = 0;
                this._clientId = '';
                this._scriptPromise = null;
                this._resetFolderCache();
    }

    GoogleDriveStore.prototype._resetFolderCache = function () {
        this._rootFolderId = '';
        this._athleteFolderIds = Object.create(null);
    };

    GoogleDriveStore.prototype.isConnected = function () {
        return !!this._token && Date.now() < this._expiresAt;
    };

    GoogleDriveStore.prototype._loadIdentityLibrary = function () {
        var self = this;
        if (this.window && this.window.google && this.window.google.accounts &&
                this.window.google.accounts.oauth2) return Promise.resolve();
        if (this._scriptPromise) return this._scriptPromise;
        if (!this.document || !this.document.head) {
            return Promise.reject(new Error('Google sign-in is unavailable in this environment.'));
        }
        this._scriptPromise = new Promise(function (resolve, reject) {
            var script = self.document.createElement('script');
            script.src = GIS_URL;
            script.async = true;
            script.defer = true;
            script.onload = function () {
                if (self.window && self.window.google && self.window.google.accounts &&
                        self.window.google.accounts.oauth2) resolve();
                else {
                    self._scriptPromise = null;
                    reject(new Error('Google sign-in library did not initialize.'));
                }
            };
            script.onerror = function () {
                self._scriptPromise = null;
                reject(new Error('Could not load Google sign-in.'));
            };
            self.document.head.appendChild(script);
        });
        return this._scriptPromise;
    };

    GoogleDriveStore.prototype.prepare = function () {
        return this._loadIdentityLibrary();
    };

    // Request a token with the given GIS prompt mode. prompt '' = show consent
    // only when needed; 'none' = never show UI (silent refresh); 'consent' =
    // always show the consent screen. Resolves true when a token is stored.
        GoogleDriveStore.prototype._requestToken = function (clientId, prompt) {
            var self = this;
            prompt = (prompt === undefined) ? '' : prompt;
            return this._ensureLibrary().then(function () {
                return new Promise(function (resolve, reject) {
                    var settled = false;
                    var client = self.window.google.accounts.oauth2.initTokenClient({
                        client_id: String(clientId).trim(),
                        scope: DRIVE_SCOPE,
                        callback: function (response) {
                            if (settled) return;
                            settled = true;
                            if (!response || response.error || !response.access_token) {
                                self._token = '';
                                self._expiresAt = 0;
                                reject(new Error((response && response.error_description) ||
                                    (response && response.error) || 'Google Drive authorization was not granted.'));
                                return;
                            }
                            self._token = response.access_token;
                            self._expiresAt = Date.now() + Math.max(0, Number(response.expires_in) || 3600) * 1000;
                            self._resetFolderCache();
                            resolve(true);
                        },
                        error_callback: function (error) {
                            if (settled) return;
                            settled = true;
                            reject(new Error((error && error.message) || 'Google sign-in was cancelled.'));
                        }
                    });
                    client.requestAccessToken({ prompt: prompt });
                });
            });
        };

        // Wait for the GIS library to load.
        GoogleDriveStore.prototype._ensureLibrary = function () {
            if (this.window && this.window.google && this.window.google.accounts &&
                    this.window.google.accounts.oauth2) {
                return Promise.resolve();
            }
            return this._loadIdentityLibrary();
        };

        // Public connect: show consent only when needed (first grant or re-consent).
        GoogleDriveStore.prototype.connect = function (clientId) {
            if (!clientId || !String(clientId).trim()) {
                throw new Error('The app owner must configure a Google OAuth web client ID.');
            }
            this._clientId = String(clientId).trim();
            return this._requestToken(clientId, '');
        };

        // Silent session restore: try prompt 'none' first (no UI). If Google
        // rejects that (grant expired/revoked), fall back to prompt '' so the
        // user can re-consent without a full page reload. Resolves true when a
        // token is obtained; rejects only when the user must explicitly connect.
        GoogleDriveStore.prototype.reconnect = function (clientId) {
            var self = this;
            this._clientId = String(clientId).trim();
            return this._requestToken(clientId, 'none').then(function () {
                return true;
            }, function (silentError) {
                return self._requestToken(clientId, '');
            });
        };

    GoogleDriveStore.prototype.disconnect = function () {
        var token = this._token;
        this._token = '';
        this._expiresAt = 0;
            this._clientId = '';
            this._resetFolderCache();
            if (token && this.window && this.window.google && this.window.google.accounts &&
                    this.window.google.accounts.oauth2) {
                this.window.google.accounts.oauth2.revoke(token, function () {});
            }
        };

    GoogleDriveStore.prototype._authorizedFetch = async function (url, options) {
        if (!this.fetch) throw new Error('Network access is unavailable.');
        if (!this.isConnected()) {
            this._token = '';
            throw makeError('Connect Google Drive to access your private data.', 'AUTH_REQUIRED');
        }
        options = options || {};
        options.headers = Object.assign({}, options.headers || {}, {
            Authorization: 'Bearer ' + this._token
        });
        var response = await this.fetch(url, options);
        if (response.status === 401) {
                // Token was rejected mid-flight (revoked, security challenge, or
                // simply expired since the last check). Try one silent refresh
                // before failing the request — this is what makes the Google
                // account "stay connected" across the one-hour token lifetime.
                var clientId = this._clientId;
                if (clientId) {
                    try {
                        await this._requestToken(clientId, 'none');
                        options.headers.Authorization = 'Bearer ' + this._token;
                        response = await this.fetch(url, options);
                    } catch (refreshError) {
                        this._token = '';
                        this._expiresAt = 0;
                        this._resetFolderCache();
                        throw makeError('Google Drive authorization expired. Connect again.', 'AUTH_REQUIRED', 401);
                    }
                }
                if (response.status === 401) {
                    this._token = '';
                    this._expiresAt = 0;
                    this._resetFolderCache();
                    throw makeError('Google Drive authorization expired. Connect again.', 'AUTH_REQUIRED', 401);
                }
            }
        if (response.status === 409 || response.status === 412) {
            throw makeError('Google Drive file changed on another device.', 409, response.status);
        }
        if (!response.ok) {
            var detail = await response.text();
            throw makeError('Google Drive request failed: ' + response.status +
                (detail ? ' ' + detail : ''), 'DRIVE_REQUEST_FAILED', response.status);
        }
        return response;
    };

    GoogleDriveStore.prototype._parsePath = function (path) {
        var parts = String(path).replace(/\\/g, '/').split('/');
        if ((parts.length !== 3 && parts.length !== 4) || parts[0] !== 'Users' ||
                !parts[1] || parts[1] === '.' || parts[1] === '..' ||
                !parts[2] || parts[2] === '.' || parts[2] === '..' ||
                (parts.length === 4 && (parts[2] !== 'sessions' ||
                    !parts[3] || parts[3] === '.' || parts[3] === '..'))) {
            throw new Error('Invalid athlete data path.');
        }
        return {
            athleteId: parts[1],
            fileName: parts.length === 4 ? parts[3] : parts[2],
            inSessions: parts.length === 4
        };
    };

    GoogleDriveStore.prototype._escapeQueryValue = function (value) {
        return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    };

    GoogleDriveStore.prototype._lookupFolder = async function (name, parentId) {
        var query = "name='" + this._escapeQueryValue(name) + "' and '" +
            this._escapeQueryValue(parentId) + "' in parents and " +
            "mimeType='application/vnd.google-apps.folder' and trashed=false";
        var url = DRIVE_API + '/files?spaces=drive&fields=files(id,name,mimeType)' +
            '&pageSize=10&q=' + encodeURIComponent(query);
        var response = await this._authorizedFetch(url);
        var data = await response.json();
        var files = Array.isArray(data.files) ? data.files : [];
        if (files.length > 1) {
            throw new Error('Multiple "' + name + '" folders matched in Google Drive.');
        }
        return files.length ? files[0] : null;
    };

    GoogleDriveStore.prototype._createFolder = async function (name, parentId) {
        var response = await this._authorizedFetch(DRIVE_API + '/files?fields=id,name,mimeType', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [parentId]
            })
        });
        return response.json();
    };

    GoogleDriveStore.prototype._ensureFolder = async function (name, parentId) {
        var folder = await this._lookupFolder(name, parentId);
        return folder || this._createFolder(name, parentId);
    };

    GoogleDriveStore.prototype._parentFolderId = async function (path) {
        var parsed = this._parsePath(path);
        if (!this._rootFolderId) {
            var root = await this._ensureFolder('AI Coach', 'root');
            this._rootFolderId = root.id;
        }
        if (!this._athleteFolderIds[parsed.athleteId]) {
            var athlete = await this._ensureFolder(parsed.athleteId, this._rootFolderId);
            this._athleteFolderIds[parsed.athleteId] = athlete.id;
        }
        var parentId = this._athleteFolderIds[parsed.athleteId];
        if (parsed.inSessions) {
            var sessionFolderKey = parsed.athleteId + '/sessions';
            if (!this._athleteFolderIds[sessionFolderKey]) {
                var sessions = await this._ensureFolder('sessions', parentId);
                this._athleteFolderIds[sessionFolderKey] = sessions.id;
            }
            parentId = this._athleteFolderIds[sessionFolderKey];
        }
        return { id: parentId, fileName: parsed.fileName };
    };

    GoogleDriveStore.prototype.listFiles = async function (directoryPath) {
        var parts = String(directoryPath).replace(/\\/g, '/').split('/');
        if (parts.length !== 3 || parts[0] !== 'Users' || !parts[1] ||
                parts[1] === '.' || parts[1] === '..' || parts[2] !== 'sessions') {
            throw new Error('Invalid chat session directory.');
        }
        var parent = await this._parentFolderId(parts.join('/') + '/index.json');
        var files = [];
        var pageToken = '';
        do {
            var query = "'" + this._escapeQueryValue(parent.id) + "' in parents and trashed=false";
            var url = DRIVE_API + '/files?spaces=drive&fields=nextPageToken,files(id,name,mimeType,modifiedTime,headRevisionId)' +
                '&pageSize=100&q=' + encodeURIComponent(query);
            if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);
            var response = await this._authorizedFetch(url);
            var data = await response.json();
            if (Array.isArray(data.files)) files = files.concat(data.files);
            pageToken = data.nextPageToken || '';
        } while (pageToken);
        return files.filter(function (file) {
            return file.mimeType !== 'application/vnd.google-apps.folder' && /\.json$/i.test(file.name || '');
        });
    };

    GoogleDriveStore.prototype._lookup = async function (path) {
        var parent = await this._parentFolderId(path);
        var query = "name='" + this._escapeQueryValue(parent.fileName) + "' and '" +
            this._escapeQueryValue(parent.id) + "' in parents and trashed=false";
        var url = DRIVE_API + '/files?spaces=drive&fields=files(id,name,modifiedTime,headRevisionId)' +
            '&pageSize=10&q=' + encodeURIComponent(query);
        var response = await this._authorizedFetch(url);
        var data = await response.json();
        var files = Array.isArray(data.files) ? data.files : [];
        if (files.length > 1) {
            throw new Error('Multiple Google Drive files matched ' + path + '.');
        }
        return files.length ? files[0] : null;
    };

    GoogleDriveStore.prototype.getFile = async function (path) {
        var file = await this._lookup(path);
        if (!file) return null;
        var response = await this._authorizedFetch(
            DRIVE_API + '/files/' + encodeURIComponent(file.id) + '?alt=media'
        );
        return {
            path: path,
            text: await response.text(),
            id: file.id,
            sha: file.headRevisionId || file.modifiedTime || '',
            modifiedTime: file.modifiedTime || ''
        };
    };

    GoogleDriveStore.prototype.getJSON = async function (path) {
        var file = await this.getFile(path);
        if (!file || !file.text) return null;
        try {
            return JSON.parse(file.text);
        } catch (error) {
            throw new Error('Invalid JSON stored in Google Drive for ' + path + ': ' + error.message);
        }
    };

    GoogleDriveStore.prototype.deleteFile = async function (path) {
        var file = await this._lookup(path);
        if (!file) return false;
        await this._authorizedFetch(DRIVE_API + '/files/' + encodeURIComponent(file.id), {
            method: 'DELETE'
        });
        return true;
    };

    GoogleDriveStore.prototype.putFile = async function (path, text, expectedVersion) {
        var existing = await this._lookup(path);
        if (arguments.length >= 3) {
            var currentVersion = existing && (existing.headRevisionId || existing.modifiedTime || '');
            if ((expectedVersion === null && existing) ||
                    (expectedVersion !== null && (!existing || currentVersion !== expectedVersion))) {
                throw makeError('Google Drive file changed on another device.', 409);
            }
        }

        var parent = await this._parentFolderId(path);
        var name = parent.fileName;
        var mimeType = /\.json$/i.test(path) ? 'application/json' : 'text/markdown';
        var url;
        var method;
        var body;
        var headers = {};
        if (!this.FormData || !this.Blob) throw new Error('Multipart upload is not supported in this browser.');
        var form = new this.FormData();
        if (existing) {
            url = DRIVE_UPLOAD_API + '/files/' + encodeURIComponent(existing.id) +
                '?uploadType=multipart&fields=id,name,modifiedTime,headRevisionId';
            method = 'PATCH';
            form.append('metadata', new this.Blob([JSON.stringify({ name: name })], { type: 'application/json' }));
        } else {
            url = DRIVE_UPLOAD_API + '/files?uploadType=multipart&fields=id,name,modifiedTime,headRevisionId';
            method = 'POST';
            form.append('metadata', new this.Blob([JSON.stringify({
                name: name,
                mimeType: mimeType,
                parents: [parent.id]
            })], { type: 'application/json' }));
        }
        form.append('file', new this.Blob([String(text)], { type: mimeType }));
        body = form;
        var response = await this._authorizedFetch(url, {
            method: method,
            headers: headers,
            body: body
        });
        var data = await response.json();
        return {
            id: data.id,
            name: data.name,
            modifiedTime: data.modifiedTime || '',
            sha: data.headRevisionId || data.modifiedTime || ''
        };
    };

    GoogleDriveStore.prototype.writeFile = async function (path, text) {
        var existing = await this.getFile(path);
        return this.putFile(path, text, existing ? existing.sha : null);
    };

    GoogleDriveStore.prototype.writeJSON = async function (path, value, expectedVersion) {
        return this.putFile(path, JSON.stringify(value), expectedVersion);
    };

    GoogleDriveStore.DRIVE_SCOPE = DRIVE_SCOPE;
    return GoogleDriveStore;
});
