/**
 * storage.js - localStorage-backed state manager.
 * All secrets live here (coach.settings.v1) and nowhere else.
 * Dual-export; backend injectable for tests.
 */
'use strict';

(function () {
    var cfg = (typeof module !== 'undefined' && module.exports)
        ? require('./config.js').CONFIG
        : (typeof window !== 'undefined' ? window.CONFIG : null);
    var KEYS = (cfg && cfg.keys) || {
        settings: 'coach.settings.v1',
        memory: 'coach.memory.v1',
        memoryPending: 'coach.memory.pending',
        chatSessions: 'coach.chatSessions.v1',
        models: 'coach.models.v1',
        dataCache: 'coach.cache.v1',
        firstLaunch: 'coach.firstLaunch',
        lastPush: 'coach.lastPushHash'
    };

    function defaultBackend() {
        try {
            if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
        } catch (e) { /* access denied */ }
        return null;
    }

    function MemoryBackend(initial) {
        this.map = Object.assign({}, initial || {});
    }
    MemoryBackend.prototype.getItem = function (k) {
        return Object.prototype.hasOwnProperty.call(this.map, k) ? this.map[k] : null;
    };
    MemoryBackend.prototype.setItem = function (k, v) { this.map[k] = String(v); };
    MemoryBackend.prototype.removeItem = function (k) { delete this.map[k]; };

    function StorageManager(backend) {
        this.backend = backend || defaultBackend();
        if (!this.backend) this.backend = new MemoryBackend();
    }

    StorageManager.prototype._get = function (k) {
        try { return this.backend.getItem(k); } catch (e) { return null; }
    };
    StorageManager.prototype._set = function (k, v) {
        try { this.backend.setItem(k, v); return true; } catch (e) { return false; }
    };
    StorageManager.prototype._remove = function (k) {
        try { this.backend.removeItem(k); } catch (e) { /* ignore */ }
    };

    // ---- settings (contains all secrets) ----
    StorageManager.prototype.getSettings = function () {
        var raw = this._get(KEYS.settings);
        if (!raw) return {};
        try { return JSON.parse(raw) || {}; } catch (e) { return {}; }
    };
    StorageManager.prototype.saveSettings = function (settings) {
        return this._set(KEYS.settings, JSON.stringify(settings || {}));
    };
    StorageManager.prototype.patchSettings = function (patch) {
        var s = this.getSettings();
        Object.assign(s, patch || {});
        this.saveSettings(s);
        return s;
    };

    // ---- generic JSON helpers ----
    StorageManager.prototype.getJSON = function (key, fallback) {
        var raw = this._get(key);
        if (!raw) return fallback === undefined ? null : fallback;
        try { return JSON.parse(raw); } catch (e) { return fallback === undefined ? null : fallback; }
    };
    StorageManager.prototype.setJSON = function (key, value) {
        return this._set(key, JSON.stringify(value));
    };

    // ---- memory ----
    StorageManager.prototype.setMemory = function (mem) {
        var athleteId = arguments.length > 1 ? arguments[1] : (mem && mem.athlete_id);
        var key = this._athleteKey(KEYS.memory, athleteId);
        var saved = this.setJSON(key, mem);
        if (saved && athleteId) {
            var legacy = this.getJSON(KEYS.memory, null);
            if (legacy && (!legacy.athlete_id || legacy.athlete_id === athleteId)) {
                var pending = this.getJSON(KEYS.memoryPending, null);
                var hash = this._get(KEYS.lastPush);
                if (pending !== null) this.setJSON(this._athleteKey(KEYS.memoryPending, athleteId), pending);
                if (hash) this._set(this._athleteKey(KEYS.lastPush, athleteId), hash);
                this._remove(KEYS.memory);
                this._remove(KEYS.memoryPending);
                this._remove(KEYS.lastPush);
            }
        }
        return saved;
    };
    StorageManager.prototype._athleteKey = function (key, athleteId) {
        return athleteId ? key + '.' + encodeURIComponent(String(athleteId)) : key;
    };
    StorageManager.prototype.getMemory = function (athleteId) {
        var scoped = this.getJSON(this._athleteKey(KEYS.memory, athleteId), null);
        if (scoped || !athleteId) return scoped;
        var legacy = this.getJSON(KEYS.memory, null);
        return legacy && (!legacy.athlete_id || legacy.athlete_id === athleteId) ? legacy : null;
    };
    StorageManager.prototype.getPendingFlush = function (athleteId) {
        var key = this._athleteKey(KEYS.memoryPending, athleteId);
        var scoped = this.getJSON(key, null);
        if (scoped !== null) return scoped === true;
        var memory = this.getMemory(athleteId);
        return !!memory && this.getJSON(KEYS.memoryPending, false) === true;
    };
    StorageManager.prototype.setPendingFlush = function (flag, athleteId) {
        return this.setJSON(this._athleteKey(KEYS.memoryPending, athleteId), !!flag);
    };
    StorageManager.prototype.getLastPushHash = function (athleteId) {
        var key = this._athleteKey(KEYS.lastPush, athleteId);
        var scoped = this._get(key);
        if (scoped !== null) return scoped;
        if (!athleteId) return '';
        return this.getMemory(athleteId) ? (this._get(KEYS.lastPush) || '') : '';
    };
    StorageManager.prototype.setLastPushHash = function (hash, athleteId) {
        return this._set(this._athleteKey(KEYS.lastPush, athleteId), hash || '');
    };

    // ---- chat history ----
    StorageManager.prototype._chatSessionsKey = function (athleteId) {
        return KEYS.chatSessions + '.' + encodeURIComponent(String(athleteId || '_default'));
    };
    StorageManager.prototype.getChatSessions = function (athleteId) {
        return this.getJSON(this._chatSessionsKey(athleteId), { activeId: '', sessions: [], deletedIds: [] });
    };
    StorageManager.prototype.setChatSessions = function (athleteId, archive) {
        return this.setJSON(this._chatSessionsKey(athleteId), archive);
    };

    // ---- data cache (latest.json etc.) ----
    StorageManager.prototype.getCachedData = function (name) {
        var cache = this.getJSON(KEYS.dataCache, {}) || {};
        return cache[name] || null;
    };
    StorageManager.prototype.setCachedData = function (name, value) {
        var cache = this.getJSON(KEYS.dataCache, {}) || {};
        cache[name] = value;
        return this.setJSON(KEYS.dataCache, cache);
    };

    // ---- models cache ----
    StorageManager.prototype.getModels = function () {
        return this.getJSON(KEYS.models, null);
    };
    StorageManager.prototype.setModels = function (models) {
        return this.setJSON(KEYS.models, models);
    };

    // ---- first launch ----
    StorageManager.prototype.isFirstLaunch = function () {
        return this._get(KEYS.firstLaunch) === null;
    };
    StorageManager.prototype.setLaunched = function () {
        return this._set(KEYS.firstLaunch, 'false');
    };

    var api = { StorageManager: StorageManager, MemoryBackend: MemoryBackend, KEYS: KEYS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.StorageManager = StorageManager;
})();
