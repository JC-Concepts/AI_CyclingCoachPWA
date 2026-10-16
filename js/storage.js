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
    StorageManager.prototype.getMemory = function () {
        return this.getJSON(KEYS.memory, null);
    };
    StorageManager.prototype.setMemory = function (mem) {
        return this.setJSON(KEYS.memory, mem);
    };
    StorageManager.prototype.getPendingFlush = function () {
        return this.getJSON(KEYS.memoryPending, false) === true;
    };
    StorageManager.prototype.setPendingFlush = function (flag) {
        return this.setJSON(KEYS.memoryPending, !!flag);
    };
    StorageManager.prototype.getLastPushHash = function () {
        return this._get(KEYS.lastPush) || '';
    };
    StorageManager.prototype.setLastPushHash = function (hash) {
        return this._set(KEYS.lastPush, hash || '');
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
