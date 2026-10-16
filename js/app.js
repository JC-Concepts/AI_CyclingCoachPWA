/**
 * app.js - application controller: wiring, tab routing, athlete data loading,
 * sync dispatch, settings, and the 15-minute diff-guarded memory flush.
 * Browser-only.
 */
'use strict';

(function () {
    var CONFIG = window.CONFIG;

    function AthletePath(id) { this.id = id; }
    AthletePath.prototype.file = function (suffix, ext) {
        return 'Users/' + this.id + '/' + this.id + '_' + suffix + (ext || '.json');
    };

    function App() {
        this.storage = new window.StorageManager();
        this.api = new window.ApiManager(this.storage);
        this.ui = new window.UIManager(this);
        this.chat = new window.ChatController(this);
        this.catalog = [];
        this.dossierCache = '';
        this._memTimer = null;
    }

    // -------------------------------------------------------------- lifecycle
    App.prototype.init = async function () {
        var self = this;
        window.app = this;

        this.ui.fillSettingsForm(this.storage.getSettings());
        this.setActiveTab('coach');

        // event listeners
        this._bind('chatSend', 'click', function () { self.sendChat(); });
        var input = document.getElementById('chatInput');
        if (input) input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); self.sendChat(); }
        });
        this._bind('saveSettingsBtn', 'click', function () { self.saveSettings(); });
        this._bind('loadModelsBtn', 'click', function () { self.loadModels(true); });
        this._bind('runSyncBtn', 'click', function () { self.runSync(); });
        this._bind('applyFiltersBtn', 'click', function () { self.filterWorkouts(); });
        this._bind('resetFiltersBtn', 'click', function () { self.resetFilters(); });
        this._bind('downloadWorkoutBtn', 'click', function () { self.downloadSelectedWorkout(); });
        this._bind('pushSelectedBtn', 'click', function () { self.pushSelectedWorkout(); });
        this._bind('startInterviewBtn', 'click', function () { self.startDossierInterview(); });
        this._bind('installBtn', 'click', function () { self.ui.$('pwaInstallModal').style.display = 'flex'; });
        this._bind('dismissPwaBtn', 'click', function () { self.dismissPwa(); });

        ['workoutModal', 'settingsModal', 'pwaInstallModal', 'donateModal'].forEach(function (id) {
            var m = document.getElementById(id);
            if (m) m.addEventListener('click', function (e) { if (e.target.id === id) m.style.display = 'none'; });
        });
        Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
            t.addEventListener('click', function () { self.setActiveTab(t.getAttribute('data-tab')); });
        });
        ['duration', 'zone', 'tssMin', 'tssMax'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.addEventListener('input', function () { self.ui.updateTSSLabel(); });
        });

        this.checkFirstLaunch();
        this.loadCachedData();
        this.refreshDashboard();
        this.loadMemoryFromStorage();
        await this.loadCatalog();
        this.loadModels(false);
        this.startMemoryFlush();
        await this.loadAthleteData().catch(function () { /* offline ok */ });
    };

    App.prototype._bind = function (id, ev, fn) {
        var el = document.getElementById(id);
        if (el) el.addEventListener(ev, fn);
    };

    App.prototype.checkFirstLaunch = function () {
        if (this.storage.isFirstLaunch()) {
            var self = this;
            setTimeout(function () {
                var m = document.getElementById('pwaInstallModal');
                if (m) m.style.display = 'flex';
            }, 600);
        }
    };
    App.prototype.dismissPwa = function () {
        this.storage.setLaunched();
        this.ui.closeModal('pwaInstallModal');
    };

    // -------------------------------------------------------------- tabs
    App.prototype.setActiveTab = function (name) {
        Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
            t.classList.toggle('active', t.getAttribute('data-tab') === name);
        });
        Array.prototype.forEach.call(document.querySelectorAll('.tab-panel'), function (p) {
            p.classList.toggle('active', p.id === 'tab-' + name);
        });
        if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    };

    // -------------------------------------------------------------- catalog
    App.prototype.loadCatalog = async function () {
        var cached = this.storage.getCachedData('catalog.json');
        if (cached && cached.workouts) { this.catalog = window.CoachCatalog.parseCatalog(cached); }
        try {
            var res = await fetch(CONFIG.catalogSource + '?t=' + Date.now());
            if (res.ok) {
                var data = await res.json();
                this.storage.setCachedData('catalog.json', data);
                this.catalog = window.CoachCatalog.parseCatalog(data);
                this.ui.populateZoneFilter(this.catalog);
                this.ui.showInitialState();
            }
        } catch (e) {
            if (this.catalog.length) this.ui.showToast('Using cached workout catalog.', 'info');
            else this.ui.showToast('Could not load workout catalog.', 'error');
        }
    };
    App.prototype.getCatalog = function () { return this.catalog; };

    App.prototype.filterWorkouts = function () {
        var duration = (document.getElementById('duration') || {}).value || '';
        var zone = parseInt((document.getElementById('zone') || {}).value || '', 10);
        var tssMin = parseInt((document.getElementById('tssMin') || {}).value || '0', 10) || 0;
        var tssMax = parseInt((document.getElementById('tssMax') || {}).value || '500', 10) || 500;
        var q = { tss_min: tssMin, tss_max: tssMax, limit: 0 };
        if (zone) q.zones = [zone];
        if (duration) {
            var map = {
                less_30: [0, 30], '30_45': [30, 45], '45_60': [45, 60],
                '60_90': [60, 90], greater_90: [90, 100000]
            };
            if (map[duration]) { q.duration_min = map[duration][0]; q.duration_max = map[duration][1]; }
        }
        this.ui.renderWorkouts(window.CoachCatalog.filterCatalog(this.catalog, q));
    };
    App.prototype.resetFilters = function () {
        ['duration', 'zone'].forEach(function (id) { var e = document.getElementById(id); if (e) e.value = ''; });
        var min = document.getElementById('tssMin'), max = document.getElementById('tssMax');
        if (min) min.value = 0; if (max) max.value = 500;
        this.ui.updateTSSLabel();
        this.ui.showInitialState();
    };

    App.prototype.showWorkoutDetail = function (id) {
        var w = this.catalog.find(function (x) { return String(x.id) === String(id); });
        if (w) this.ui.showWorkoutDetail(w);
    };

    // -------------------------------------------------------------- settings
    App.prototype.saveSettings = function () {
        var s = this.ui.readSettingsForm();
        var v = window.CoachSettings.validateSettings(s);
        this.storage.saveSettings(s);
        this.ui.showToast(v.ok ? 'Settings saved.' : 'Saved, but some fields are still missing.', v.ok ? 'success' : 'warning');
        this.refreshDashboard();
    };

    App.prototype.loadModels = async function (force) {
        var cached = this.storage.getModels();
        var now = Date.now();
        if (!force && cached && cached.list && (now - cached.ts) < 24 * 3600 * 1000) {
            this.ui.fillModelSelect(cached.list, this.storage.getSettings().model);
            return;
        }
        try {
            var models = await this.api.listModels();
            this.storage.setModels({ ts: now, list: models });
            this.ui.fillModelSelect(models, this.storage.getSettings().model);
            if (force) this.ui.showToast('Loaded ' + models.length + ' free models.', 'success');
        } catch (e) {
            if (cached && cached.list) this.ui.fillModelSelect(cached.list, this.storage.getSettings().model);
            if (force) this.ui.showToast('Could not load models: ' + e.message, 'error');
        }
    };

    // -------------------------------------------------------------- athlete data
    App.prototype._path = function () { return new AthletePath(this.storage.getSettings().athleteId); };

    App.prototype.loadCachedData = function () {
        var names = ['latest.json', 'intervals.json', 'routes.json', 'saved_workouts.json', 'ftp_history.json'];
        this._cache = {};
        names.forEach(function (n) { this._cache[n] = this.storage.getCachedData(n); }, this);
    };

    App.prototype.loadAthleteData = async function () {
        var id = this.storage.getSettings().athleteId;
        if (!id) return;
        var p = new AthletePath(id);
        var files = [
            ['latest.json', p.file('latest')],
            ['intervals.json', p.file('intervals')],
            ['routes.json', p.file('routes')],
            ['saved_workouts.json', p.file('saved_workouts')],
            ['ftp_history.json', p.file('ftp_history')]
        ];
        for (var i = 0; i < files.length; i++) {
            try {
                var data = await this.api.ghGetJSON(files[i][1]);
                if (data != null) this.storage.setCachedData(files[i][0], data);
            } catch (e) { /* keep cache */ }
        }
        try {
            var d = await this.api.ghGetFile(p.file('dossier', '.md'));
            if (d && d.text) { this.dossierCache = d.text; this.storage.setCachedData('dossier.md', d.text); }
        } catch (e) { /* ignore */ }
        await this.loadRemoteMemory();
        this.refreshDashboard();
    };

    App.prototype.refreshDashboard = function () {
        var files = {};
        ['latest.json', 'intervals.json', 'routes.json', 'saved_workouts.json', 'ftp_history.json'].forEach(function (n) {
            files[n] = this.storage.getCachedData(n);
        }, this);
        this.ui.renderDashboard(window.CoachContext.buildFreshness(files, Date.now()), files['latest.json']);
    };

    // -------------------------------------------------------------- sync
    App.prototype.runSync = async function () {
        var s = this.storage.getSettings();
        var v = window.CoachSettings.validateSettings(s);
        if (!v.ok) { this.ui.showToast('Complete Settings first.', 'error'); this.setActiveTab('settings'); return; }
        this.ui.showLoading('Dispatching sync\u2026');
        try {
            await this.api.ghDispatchWorkflow('sync-intervals.yml', {
                athlete_id: s.athleteId,
                intervals_key: s.intervalsKey
            });
            this.ui.showLoading('Syncing data\u2026 (up to 90s)');
            var run = await this.api.ghWaitForRun('sync-intervals.yml', {});
            await this.loadAthleteData();
            this.ui.hideLoading();
            this.ui.showToast(run && run.conclusion === 'success' ? 'Sync complete.' :
                (run ? ('Sync finished: ' + run.conclusion) : 'Sync still running; data will appear shortly.'), 'info');
        } catch (e) {
            this.ui.hideLoading();
            this.ui.showToast('Sync failed: ' + e.message, 'error');
        }
    };

    // -------------------------------------------------------------- push
    App.prototype._resolveFile = function (workoutId) {
        var w = this.catalog.find(function (x) { return String(x.id) === String(workoutId); });
        return w && w.file ? w.file : (String(workoutId).replace(/^workout_/, '') + '.zwo');
    };

    App.prototype.confirmPush = async function (push, cardEl) {
        var s = this.storage.getSettings();
        var v = window.CoachSettings.validateSettings(s);
        if (!v.ok) { this.ui.showToast('Complete Settings first.', 'error'); return; }
        this.ui.showLoading('Pushing workout\u2026');
        try {
            var file = this._resolveFile(push.workout_id);
            var content = await this.api.fetchCatalogWorkout(file);
            await this.api.intervalsUpload(content,
                file.split('/').pop(),
                push.date + 'T00:00:00',
                s.athleteId, s.intervalsKey,
                { name: push.workout_id, description: push.reason || 'AI Cycling Coach' });
            this.ui.hideLoading();
            this.ui.showToast('Workout pushed to Intervals.icu.', 'success');
            if (cardEl) cardEl.remove();
        } catch (e) {
            this.ui.hideLoading();
            this.ui.showToast('Push failed: ' + e.message, 'error');
        }
    };

    App.prototype.downloadSelectedWorkout = async function () {
        if (!window.selectedWorkout) return;
        try {
            var content = await this.api.fetchCatalogWorkout(window.selectedWorkout.file);
            var blob = new Blob([content], { type: 'application/xml' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url; a.download = window.selectedWorkout.name + '.zwo';
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e) { this.ui.showToast('Download failed: ' + e.message, 'error'); }
    };

    App.prototype.pushSelectedWorkout = function () {
        if (!window.selectedWorkout) return;
        var d = new Date();
        var date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        this.ui.closeModal('workoutModal');
        this.confirmPush({ workout_id: window.selectedWorkout.id, date: date, reason: 'Manual push' });
    };

    // -------------------------------------------------------------- dossier
    App.prototype.getDossierText = function () { return this.dossierCache || this.storage.getCachedData('dossier.md') || ''; };
    App.prototype.getDossierState = function () { var t = this.getDossierText(); return t ? 'present' : 'missing'; };

    App.prototype.startDossierInterview = function () {
        this.sendChat('Start the onboarding dossier interview. Ask me the first question only, as a single question card, then stop.');
    };

    App.prototype.confirmDossier = async function (block, cardEl) {
        var id = this.storage.getSettings().athleteId;
        if (!id) { this.ui.showToast('Set your Athlete ID first.', 'error'); return; }
        var existing = this.getDossierText();
        var line = '- **' + block.section + '**: ' + block.proposed;
        var updated = existing ? (existing.replace(/\s*$/, '') + '\n' + line + '\n') : ('# Athlete Dossier\n\n' + line + '\n');
        this.ui.showLoading('Saving dossier\u2026');
        try {
            var path = new AthletePath(id).file('dossier', '.md');
            await this.api.ghWriteFile(path, updated, 'dossier ' + id + ' [skip ci]');
            this.dossierCache = updated;
            this.storage.setCachedData('dossier.md', updated);
            this.ui.hideLoading();
            this.ui.showToast('Dossier updated.', 'success');
            if (cardEl) cardEl.remove();
        } catch (e) {
            this.ui.hideLoading();
            this.ui.showToast('Dossier save failed: ' + e.message, 'error');
        }
    };

    // -------------------------------------------------------------- memory
    App.prototype.getMemory = function () {
        return this.storage.getMemory() || window.CoachMemory.createEmpty(this.storage.getSettings().athleteId);
    };
    App.prototype.appendMemory = function (role, text) {
        if (!text) return;
        var mem = window.CoachMemory.appendTurn(this.getMemory(), { role: role, text: text });
        this.storage.setMemory(mem);
        this.storage.setPendingFlush(true);
    };
    App.prototype.loadMemoryFromStorage = function () {
        if (!this.storage.getMemory()) {
            this.storage.setMemory(window.CoachMemory.createEmpty(this.storage.getSettings().athleteId));
        }
    };
    App.prototype.loadRemoteMemory = async function () {
        var id = this.storage.getSettings().athleteId;
        if (!id) return;
        try {
            var remote = await this.api.ghGetJSON(new AthletePath(id).file('memory'));
            if (remote && remote.messages) {
                var merged = window.CoachMemory.mergeMemory(this.getMemory(), remote);
                this.storage.setMemory(merged);
            }
        } catch (e) { /* offline ok */ }
    };

    App.prototype.startMemoryFlush = function () {
        var self = this;
        this._memTimer = setInterval(function () { self.flushMemory(); }, CONFIG.memoryFlushMs);
        window.addEventListener('pagehide', function () { self.flushMemory(); });
    };

    App.prototype.maybeFlushMemory = function () { /* diff guard runs on the timer; nothing eager here */ };

    App.prototype.flushMemory = async function () {
        var id = this.storage.getSettings().athleteId;
        if (!id) return false;
        var mem = this.getMemory();
        var last = this.storage.getLastPushHash();
        var changed = await window.CoachMemory.needsPush(mem, last);
        if (!changed) return false;

        mem = window.CoachMemory.compact(mem, CONFIG.memoryMaxTurns, CONFIG.memoryMaxBytes);
        var path = new AthletePath(id).file('memory');
        try {
            var existing = await this.api.ghGetFile(path);
            await this.api.ghPutFile(path, JSON.stringify(mem, null, 1), 'memory ' + id + ' [skip ci]', existing ? existing.sha : undefined);
        } catch (e) {
            if (e.code === 409) {
                var remote = await this.api.ghGetJSON(path);
                mem = window.CoachMemory.mergeMemory(mem, remote);
                await this.api.ghPutFile(path, JSON.stringify(mem, null, 1), 'memory ' + id + ' [skip ci]');
            } else {
                this.storage.setPendingFlush(true);
                return false;
            }
        }
        this.storage.setMemory(mem);
        this.storage.setLastPushHash(await window.CoachMemory.contentHash(mem));
        this.storage.setPendingFlush(false);
        return true;
    };

    // -------------------------------------------------------------- chat entry
    App.prototype.sendChat = function () {
        var input = document.getElementById('chatInput');
        if (!input) return;
        var text = input.value;
        input.value = '';
        this.chat.send(text);
    };

    window.App = App;
    document.addEventListener('DOMContentLoaded', function () {
        new App().init().catch(function (e) { console.error('Init failed', e); });
    });
})();
