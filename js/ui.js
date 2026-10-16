/**
 * ui.js - all DOM rendering and interactions.
 * Untrusted text is only ever inserted through CoachBlocks.escapeHtml() or
 * markdownToSafeHtml(). The workout chart (renderWorkoutIntensity) is preserved
 * from WorkoutGenerator. Browser-only.
 */
'use strict';

(function () {
    var ZONES = { 1: 'Active Recovery', 2: 'Endurance', 3: 'Tempo', 4: 'Threshold', 5: 'VO2 Max' };

    function UIManager(app) {
        this.app = app;
    }

    UIManager.prototype.esc = function (s) { return window.CoachBlocks.escapeHtml(s); };
    UIManager.prototype.$ = function (id) { return document.getElementById(id); };

    // ------------------------------------------------------------- loading/toast
    UIManager.prototype.showLoading = function (msg) {
        var o = this.$('loadingOverlay');
        if (o) { o.querySelector('p').textContent = msg || 'Loading\u2026'; o.style.display = 'flex'; }
    };
    UIManager.prototype.hideLoading = function () {
        var o = this.$('loadingOverlay');
        if (o) o.style.display = 'none';
    };
    UIManager.prototype.showToast = function (msg, type) {
        var t = this.$('toast');
        if (!t) return;
        t.textContent = msg;
        t.className = 'toast toast-' + (type || 'info');
        t.style.display = 'block';
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(function () { t.style.display = 'none'; }, 3500);
    };

    // ----------------------------------------------------------------- chat
    UIManager.prototype.appendMessage = function (role, text, streaming) {
        var log = this.$('chatLog');
        if (!log) return null;
        var el = document.createElement('div');
        el.className = 'msg msg-' + role;
        if (role === 'assistant') {
            el.innerHTML = window.CoachBlocks.markdownToSafeHtml(text || '');
            if (streaming) el.classList.add('streaming');
        } else {
            el.textContent = text || '';
        }
        log.appendChild(el);
        this.scrollChat();
        return el;
    };
    UIManager.prototype.updateMessage = function (el, text, streaming) {
        if (!el) return;
        el.innerHTML = window.CoachBlocks.markdownToSafeHtml(text || '');
        el.classList.toggle('streaming', !!streaming);
        this.scrollChat();
    };
    UIManager.prototype.appendSystemNote = function (text) {
        this.appendMessage('system', text);
    };
    UIManager.prototype.scrollChat = function () {
        var log = this.$('chatLog');
        if (log) log.scrollTop = log.scrollHeight;
    };
    UIManager.prototype.setChatBusy = function (busy) {
        var input = this.$('chatInput');
        var btn = this.$('chatSend');
        if (input) input.disabled = busy;
        if (btn) btn.disabled = busy;
        var s = this.$('chatSpinner');
        if (s) s.style.display = busy ? 'inline-block' : 'none';
    };

    UIManager.prototype.showPushConfirm = function (push) {
        var host = this.$('cardHost');
        if (!host) return;
        var file = push.workout_id || '';
        var div = document.createElement('div');
        div.className = 'action-card push-card';
        div.innerHTML =
            '<div class="action-h">Push to Intervals.icu</div>' +
            '<div class="action-row"><span>Workout</span><b>' + this.esc(push.workout_id) + '</b></div>' +
            '<div class="action-row"><span>Date</span><b>' + this.esc(push.date) + '</b></div>' +
            '<div class="action-row"><span>Reason</span><b>' + this.esc(push.reason || '\u2014') + '</b></div>' +
            '<div class="action-btns"><button class="btn-secondary" data-role="cancel">Cancel</button>' +
            '<button class="btn-primary" data-role="confirm">Confirm push</button></div>';
        div.querySelector('[data-role="cancel"]').addEventListener('click', function () { div.remove(); });
        div.querySelector('[data-role="confirm"]').addEventListener('click', (function (self, b) {
            return function () { self.app.confirmPush(b, div); };
        })(this, push));
        host.appendChild(div);
    };

    UIManager.prototype.showDossierDiff = function (block) {
        var host = this.$('cardHost');
        if (!host) return;
        var div = document.createElement('div');
        div.className = 'action-card dossier-card';
        div.innerHTML =
            '<div class="action-h">Dossier update</div>' +
            '<div class="action-row"><span>Section</span><b>' + this.esc(block.section) + '</b></div>' +
            '<div class="action-box"><div class="lbl">Current</div><div>' + this.esc(block.current || '') + '</div></div>' +
            '<div class="action-box"><div class="lbl">Proposed</div><div>' + this.esc(block.proposed || '') + '</div></div>' +
            '<div class="action-row"><span>Why</span><b>' + this.esc(block.why || '') + '</b></div>' +
            '<div class="action-btns"><button class="btn-secondary" data-role="cancel">Cancel</button>' +
            '<button class="btn-primary" data-role="confirm">Approve</button></div>';
        div.querySelector('[data-role="cancel"]').addEventListener('click', function () { div.remove(); });
        div.querySelector('[data-role="confirm"]').addEventListener('click', (function (self, b) {
            return function () { self.app.confirmDossier(b, div); };
        })(this, block));
        host.appendChild(div);
    };

    // ----------------------------------------------------------- dashboard
    UIManager.prototype.renderDashboard = function (freshness, latest) {
        var host = this.$('dashboard');
        if (!host) return;
        var rows = freshness && freshness.length
            ? freshness.map(function (f) {
                return '<div class="fr-row"><span>' + this.esc(f.name) + '</span><b class="' +
                    (f.stale ? 'fr-stale' : 'fr-ok') + '">' + this.esc(f.last_updated) +
                    ' (' + f.age_hours + 'h)</b></div>';
            }, this).join('')
            : '<div class="fr-empty">No cached data. Run a sync from Settings.</div>';
        host.innerHTML =
            '<div class="dash-h">Data freshness</div>' + rows;
    };

    // ----------------------------------------------------------- workouts tab
    UIManager.prototype.populateZoneFilter = function (workouts) {
        var sel = this.$('zone');
        if (!sel) return;
        var zones = {};
        workouts.forEach(function (w) { if (w.primary_zone) zones[w.primary_zone] = 1; });
        var opts = '<option value="">All Types</option>';
        Object.keys(zones).sort(function (a, b) { return a - b; }).forEach(function (z) {
            opts += '<option value="' + z + '">' + (ZONES[z] || ('Zone ' + z)) + '</option>';
        });
        sel.innerHTML = opts;
    };

    UIManager.prototype.showInitialState = function () {
        var c = this.$('workoutCards');
        var e = this.$('emptyState');
        if (c) c.innerHTML = '';
        if (e) {
            e.innerHTML = '<p>Filter the catalog of structured workouts, or ask the Coach to pick one for you.</p>';
            e.style.display = 'block';
        }
        this.updateResultCount(0);
    };

    UIManager.prototype.renderWorkouts = function (workouts) {
        var c = this.$('workoutCards');
        var e = this.$('emptyState');
        if (!c) return;
        if (!workouts || !workouts.length) {
            c.innerHTML = '';
            if (e) { e.innerHTML = '<h3>No Workouts Found</h3><p>Try adjusting your filters.</p>'; e.style.display = 'block'; }
            this.updateResultCount(0);
            return;
        }
        if (e) e.style.display = 'none';
        var self = this;
        c.innerHTML = workouts.map(function (w) {
            return '<div class="workout-card" data-id="' + self.esc(w.id) + '">' +
                '<div class="card-header"><h3>' + self.esc(w.name) + '</h3></div>' +
                '<div class="card-stats">' +
                '<div class="stat"><span class="stat-value">' + Math.round((w.duration_seconds || 0) / 60) + '</span><span class="stat-label">min</span></div>' +
                '<div class="stat"><span class="stat-value">' + (w.primary_zone || '-') + '</span><span class="stat-label">Zone</span></div>' +
                '<div class="stat"><span class="stat-value">' + (w.tss || 0) + '</span><span class="stat-label">TSS</span></div>' +
                '</div></div>';
        }).join('');
        Array.prototype.forEach.call(c.querySelectorAll('.workout-card'), function (card) {
            card.addEventListener('click', function () { self.app.showWorkoutDetail(card.getAttribute('data-id')); });
        });
        this.updateResultCount(workouts.length);
    };

    UIManager.prototype.updateResultCount = function (n) {
        var el = this.$('resultCount');
        if (el) el.textContent = n === 1 ? '1 workout' : (n + ' workouts');
    };

    UIManager.prototype.updateTSSLabel = function () {
        var min = this.$('tssMin'), max = this.$('tssMax'), label = this.$('tssLabel');
        if (label && min && max) label.textContent = 'TSS: ' + (min.value || 0) + ' - ' + (max.value || 500);
    };

    UIManager.prototype.showWorkoutDetail = function (w) {
        var modal = this.$('workoutModal');
        if (!modal || !w) return;
        this.$('detailName').textContent = w.name || 'Unknown';
        this.$('detailDescription').textContent = w.description || 'No description available';
        this.$('detailAuthor').textContent = w.author || 'Unknown';
        this.$('detailCategory').textContent = w.category || 'Unknown';
        this.$('detailDuration').textContent = Math.round((w.duration_seconds || 0) / 60);
        this.$('detailZone').textContent = w.primary_zone ? ('Zone ' + w.primary_zone) : 'N/A';
        this.$('detailTSS').textContent = (w.tss != null ? w.tss : 0);
        this.$('detailAvgPower').textContent = w.avg_power || 0;
        this.renderWorkoutIntensity(w);
        window.selectedWorkout = w;
        modal.style.display = 'flex';
    };

    /** Preserved SVG chart from WorkoutGenerator renderWorkoutIntensity. */
    UIManager.prototype.renderWorkoutIntensity = function (workoutData) {
        var container = this.$('intensityContainer');
        if (!container) return;
        var segments = (workoutData && workoutData.segments) || [];
        if (!segments || segments.length === 0) {
            container.innerHTML = '<p class="intensity-note">No segment data available. Download the file to view details.</p>';
            return;
        }
        var data = segments.map(function (s) { return s.power || 0; });
        var totalDuration = segments.reduce(function (a, s) { return a + s.duration; }, 0) || 1;
        var getZoneColor = function (p) {
            if (p < 55) return '#22c55e';
            if (p < 75) return '#3b82f6';
            if (p < 90) return '#eab308';
            if (p < 105) return '#f97316';
            return '#ef4444';
        };
        var width = 600, height = 200;
        var padding = { top: 25, right: 30, bottom: 35, left: 55 };
        var chartWidth = width - padding.left - padding.right;
        var chartHeight = height - padding.top - padding.bottom;
        var maxPower = Math.max.apply(null, data.concat([110]));
        var xScale = function (d) { return (d / totalDuration) * chartWidth; };
        var yScale = function (p) { return chartHeight - (p / maxPower) * chartHeight; };
        var currentX = padding.left, bars = '';
        segments.forEach(function (seg) {
            var barWidth = (seg.duration / totalDuration) * chartWidth;
            var power = seg.power || 0;
            var barHeight = (power / maxPower) * chartHeight;
            var y = padding.top + chartHeight - barHeight;
            bars += '<rect x="' + currentX + '" y="' + y + '" width="' + barWidth + '" height="' + barHeight + '" fill="' + getZoneColor(power) + '" />';
            currentX += barWidth;
        });
        var yLabels = '';
        for (var p = 0; p <= maxPower; p += 25) {
            yLabels += '<text x="' + (padding.left - 5) + '" y="' + (yScale(p) + padding.top + 3) + '" text-anchor="end" fill="#94a3b8" font-size="10">' + p + '%</text>';
        }
        var xLabels = '', xSteps = 4;
        for (var i = 0; i <= xSteps; i++) {
            var time = Math.round((totalDuration / xSteps) * i);
            var x = padding.left + (chartWidth / xSteps) * i;
            xLabels += '<text x="' + x + '" y="' + (height - 5) + '" text-anchor="middle" fill="#94a3b8" font-size="10">' + this.formatTime(time) + '</text>';
        }
        var gridLines = '';
        for (var g = 25; g < maxPower; g += 25) {
            var gy = padding.top + (chartHeight - (g / maxPower) * chartHeight);
            gridLines += '<line x1="' + padding.left + '" y1="' + gy + '" x2="' + (width - padding.right) + '" y2="' + gy + '" stroke="#334155" stroke-width="1" />';
        }
        container.innerHTML =
            '<div class="chart-container"><svg viewBox="0 0 ' + width + ' ' + height + '" class="workout-chart">' +
            gridLines + bars + yLabels + xLabels + '</svg></div>';
    };

    UIManager.prototype.formatTime = function (seconds) {
        var m = Math.floor(seconds / 60), s = seconds % 60;
        return m + ':' + String(s).padStart(2, '0');
    };

    UIManager.prototype.closeModal = function (id) {
        var m = this.$(id || 'workoutModal');
        if (m) m.style.display = 'none';
    };

    // ----------------------------------------------------------- settings form
    UIManager.prototype.fillSettingsForm = function (settings) {
        var s = settings || {};
        var map = {
            setAthleteId: 'athleteId', setIntervalsKey: 'intervalsKey',
            setOpenrouterKey: 'openrouterKey', setGithubToken: 'githubToken',
            setModel: 'model', setRepoOwner: 'repoOwner', setRepoName: 'repoName'
        };
        Object.keys(map).forEach((function (id) {
            var el = this.$(id);
            if (el) el.value = s[map[id]] || '';
        }).bind(this));
    };

    UIManager.prototype.readSettingsForm = function () {
        function val(id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; }
        return {
            athleteId: val('setAthleteId'),
            intervalsKey: val('setIntervalsKey'),
            openrouterKey: val('setOpenrouterKey'),
            githubToken: val('setGithubToken'),
            model: val('setModel'),
            repoOwner: val('setRepoOwner'),
            repoName: val('setRepoName')
        };
    };

    UIManager.prototype.fillModelSelect = function (models, current) {
        var sel = this.$('modelSelect');
        if (!sel) return;
        sel.innerHTML = '<option value="">Select a free model\u2026</option>' +
            models.map(function (m) {
                return '<option value="' + this.esc(m.id) + '"' + (m.id === current ? ' selected' : '') + '>' + this.esc(m.name || m.id) + '</option>';
            }, this).join('');
    };

    window.UIManager = UIManager;
})();
