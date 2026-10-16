/**
 * settings.js - deterministic settings validation (the Settings gate).
 * Required fields gate coaching. Pure functions, dual-export.
 */
'use strict';

(function () {
    var BASE_FIELDS = [
        { key: 'athleteId', label: 'Intervals.icu Athlete ID', section: 'Intervals.icu' },
        { key: 'intervalsKey', label: 'Intervals.icu API Key', section: 'Intervals.icu' }
    ];
    var PROVIDER_FIELDS = {
        openrouter: [
            { key: 'openrouterKey', label: 'OpenRouter API Key', section: 'OpenRouter' },
            { key: 'model', label: 'OpenRouter Model', section: 'OpenRouter' }
        ],
        gemini: [
            { key: 'geminiKey', label: 'Gemini API Key', section: 'Google Gemini' },
            { key: 'geminiModel', label: 'Gemini Model ID', section: 'Google Gemini' }
        ]
    };

    function requiredFields(settings) {
        var provider = settings && settings.provider || 'openrouter';
        return BASE_FIELDS.concat(PROVIDER_FIELDS[provider] || [
            { key: 'provider', label: 'AI Provider', section: 'AI Provider' }
        ]);
    }

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
        var fields = requiredFields(s);
        for (var i = 0; i < fields.length; i++) {
            if (fields[i].key === 'provider' || isBlank(s[fields[i].key])) missing.push(fields[i]);
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
        return requiredFields(s).filter(function (f) {
            return f.key !== 'provider' && !isBlank(s[f.key]);
        });
    }

    var api = {
        FIELDS: BASE_FIELDS,
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
