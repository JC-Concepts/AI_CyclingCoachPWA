/**
 * chat.js - Coach conversation controller.
 * Orchestrates: settings gate -> context build -> streamed completion ->
 * structured-block tool loop (catalog search) -> push/dossier cards -> memory.
 * Browser-only.
 */
'use strict';

(function () {
    function ChatController(app) {
        this.app = app;
        this.api = app.api;
        this.storage = app.storage;
        this.ui = app.ui;
        this.busy = false;
    }

    ChatController.prototype._todayIso = function () {
        var d = new Date();
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    };

    ChatController.prototype.send = async function (text) {
        text = String(text || '').trim();
        if (!text || this.busy) return;

        var settings = this.storage.getSettings();
        var v = window.CoachSettings.validateSettings(settings);

        this.ui.appendMessage('user', text);

        if (!v.ok) {
            this.ui.appendMessage('system',
                window.CoachSettings.formatMissingMessage(v.missing, window.CoachSettings.presentFields(settings)));
            this.app.setActiveTab('settings');
            return;
        }

        var session = this.app.ensureActiveChatSession();
        var priorMessages = (session.messages || []).slice();
        this.app.recordChatMessage('user', text);

        this.busy = true;
        this.ui.setChatBusy(true);
        var el = this.ui.appendMessage('assistant', '');
        try {
            await this.app.skillsReady;
            var mem = this.app.getMemory();
            var ctx = window.CoachContext.buildContext({
                settings: settings,
                latest: this.storage.getCachedData('latest.json'),
                intervals: this.storage.getCachedData('intervals.json'),
                routes: this.storage.getCachedData('routes.json'),
                savedWorkouts: this.storage.getCachedData('saved_workouts.json'),
                ftpHistory: this.storage.getCachedData('ftp_history.json'),
                memory: mem,
                dossier: this.app.getDossierText(),
                now: Date.now()
            });

            var sys = window.CoachPrompt.fillSystemPrompt(ctx.systemVars);
            var allSkills = window.SkillsLoader.formatForPrompt(this.app.skills);
            if (!allSkills) {
                allSkills = '=== SKILLS UNAVAILABLE ===\n' +
                    'No Markdown skill files loaded from Skills/. ' +
                    (this.app.skillsLoadError || 'The skill directory is empty.');
            }
            sys += '\n\n' + allSkills;
            var ctxMsg = '[CONTEXT]\n' + ctx.dataMessage + '\n[/CONTEXT]';
            var history = priorMessages.slice(-40).map(function (m) {
                return { role: m.role === 'assistant' ? 'assistant' : 'user', content: m.text };
            });

            var dossierText = this.app.getDossierText();
            var interviewMode = text && text.toLowerCase().indexOf('interview') >= 0;
            var hiddenSkillRequest = 'All Markdown files discovered in the public Skills/ directory are included in the system context. Apply relevant skills; do not assume the skill set is limited to named examples. Use the Section 11 coaching protocol and workout reference as binding framework sources.';
            if (interviewMode) {
                hiddenSkillRequest += ' INTERVIEW MODE ACTIVE: athlete is in dossier intake. Read previous dossier below. Ask ONE question card only, then stop. Do not coach. If previous dossier exists, ask what needs updating.';
            }
            if (dossierText) {
                hiddenSkillRequest += ' PREVIOUS DOSSIER DATA (read before asking):\n' + dossierText.slice(0, 3000);
            }
            var messages = [{ role: 'system', content: sys }, { role: 'user', content: hiddenSkillRequest }, { role: 'user', content: ctxMsg }]
                .concat(history)
                .concat([{ role: 'user', content: text }]);

            var full = await this._stream(el, messages);
            var blocks = window.CoachBlocks.parseBlocks(full);

            var toolTurns = 0;
            while (blocks.search && toolTurns < 2) {
                var q = window.CoachBlocks.normalizeSearchBlock(blocks.search);
                var rows = window.CoachCatalog.filterCatalog(this.app.getCatalog(), q);
                var toolResult = 'TOOL_RESULT\n' + window.CoachCatalog.formatCandidates(rows);
                messages.push({ role: 'assistant', content: full });
                messages.push({ role: 'user', content: toolResult });
                full = await this._stream(el, messages);
                blocks = window.CoachBlocks.parseBlocks(full);
                toolTurns++;
            }

            this.ui.updateMessage(el, blocks.cleaned || '_(empty response)_');

            if (blocks.errors.length) {
                this.ui.appendSystemNote('Model returned a malformed JSON block; it was ignored.');
            }
            if (blocks.push) {
                var val = window.CoachBlocks.validatePushBlock(blocks.push, this._todayIso());
                if (val.ok) this.ui.showPushConfirm(blocks.push);
                else this.ui.appendSystemNote('Push request rejected: ' + val.error);
            }
            if (blocks.dossier) this.ui.showDossierDiff(blocks.dossier);

            this.app.recordChatMessage('assistant', blocks.cleaned || '');
            await this.app.saveChatSessionToDrive(this.app.getActiveChatSession());
        } catch (err) {
            this.ui.updateMessage(el, '**Error:** ' + (err && err.message ? err.message : String(err)));
            await this.app.saveChatSessionToDrive(this.app.getActiveChatSession());
        } finally {
            this.busy = false;
            this.ui.setChatBusy(false);
        }
    };

    ChatController.prototype._stream = async function (el, messages) {
        var acc = '';
        var ui = this.ui;
        return this.api.chat(messages, {
            onToken: function (t) {
                acc += t;
                ui.updateMessage(el, acc, true);
            }
        }).then(function (full) {
            return full || acc;
        });
    };

    window.ChatController = ChatController;
})();
