/**
 * config.js - Application constants and defaults.
 * Dual-export: browser (window.CONFIG) and Node (module.exports).
 */
'use strict';

var CONFIG = {
    protocolVersion: '11.71',

    // WorkoutGenerator catalog (upstream, public)
    catalogSource:
        'https://raw.githubusercontent.com/JC-Concepts/WorkoutGenerator/refs/heads/main/workouts.json',
    catalogWorkoutsBase:
        'https://raw.githubusercontent.com/JC-Concepts/WorkoutGenerator/refs/heads/main/workouts',

    // Section 11 protocol assets
    section11Raw: 'https://raw.githubusercontent.com/CrankAddict/section-11/main',
    skillsApiUrl:
        'https://api.github.com/repos/JC-Concepts/AI_CyclingCoachPWA/contents/Skills?ref=main',

    // APIs
    intervalsBase: 'https://intervals.icu/api/v1',
    openRouterBase: 'https://openrouter.ai/api/v1',
    googleClientId: '335294954193-q97t0hhu0hl5cues5l74qkdn9e21sn5u.apps.googleusercontent.com',
    pyodideVersion: '0.27.7',

    // Timings / limits
    memoryFlushMs: 15 * 60 * 1000,
    syncStaleMs: 30 * 60 * 1000,
    dataStaleMs: 48 * 60 * 60 * 1000,
    syncPollIntervalMs: 5000,
    syncPollTimeoutMs: 90000,
    memoryMaxBytes: 200 * 1024,
    memoryMaxTurns: 40,
    contextTier1Tokens: 6000,
    contextTier2Tokens: 8000,
    catalogCandidateLimit: 10,

    // localStorage keys
    keys: {
        settings: 'coach.settings.v1',
        memory: 'coach.memory.v1',
        memoryPending: 'coach.memory.pending',
        chatSessions: 'coach.chatSessions.v1',
        models: 'coach.models.v1',
        skills: 'coach.skills.v1',
        dataCache: 'coach.cache.v1',
        firstLaunch: 'coach.firstLaunch',
        lastPush: 'coach.lastPushHash'
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CONFIG: CONFIG };
}
if (typeof window !== 'undefined') {
    window.CONFIG = CONFIG;
}
