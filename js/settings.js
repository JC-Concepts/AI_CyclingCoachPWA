/**
 * settings.js - deterministic settings validation (the Settings gate).
 * Required fields gate coaching. Pure functions, dual-export.
 */
'use strict';

(function () {
    var FIELDS = [
        { key: 'athleteId', label: 'Intervals.icu Athlete ID', section: 'Intervals.icu' },
        { key: 'intervalsKey', label: 'Intervals.icu API Key', section: 'Intervals.icu' },
        { key: 'openrouterKey', label: 'OpenRouter API Key', section: 'OpenRouter' },
        { key: 'model', label: 'OpenRouter Model', section: 'OpenRouter' }
    ];

    function isBlank(v) {
        return v === undefined || v === null || String(v).trim() === '';
    }

    /**
     * Validate the settings object.
     * @returns {{ok:boolean, missing:Array<{key,label,section}>}}
     */
    function validateSettings(settings) {
        var s = settings || {};
        var missing = [];
        for (var i = 0; i < FIELDS.length; i++) {
            if (isBlank(s[FIELDS[i].key])) missing.push(FIELDS[i]);
        }
        return { ok: missing.length === 0, missing: missing };
    }

    /**
     * Human-readable missing-info message used by the chat gate.
     */
    function formatMissingMessage(missing, present) {
        var lines = ['Setup incomplete - I can\'t coach yet. Missing in Settings:'];
        (missing || []).forEach(function (f) {
            lines.push('\u2022 ' + f.label + '  \u2192 Settings \u25b8 ' + f.section);
        });
        if (present && present.length) {
            lines.push('(entered: ' + present.map(function (f) { return f.label; }).join(', ') + ')');
        }
        return lines.join('\n');
    }

    function presentFields(settings) {
        var s = settings || {};
        return FIELDS.filter(function (f) { return !isBlank(s[f.key]); });
    }

    var api = {
        FIELDS: FIELDS,
        validateSettings: validateSettings,
        formatMissingMessage: formatMissingMessage,
        presentFields: presentFields,
        isBlank: isBlank
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') {
        window.CoachSettings = api;
        window.validateSettings = validateSettings;
    }
})();
