/**
 * config.js - Application constants and defaults.
 * Dual-export: browser (window.CONFIG) and Node (module.exports).
 */
'use strict';

var CONFIG = {
    protocolVersion: '11.71',

    // GitHub (overridable per-device via Settings, stored locally)
    repoOwner: 'JC-Concepts',
    repoName: 'AI_CyclingCoachPWA',
    defaultBranch: 'main',

    // WorkoutGenerator catalog (upstream, public)
    catalogSource:
        'https://raw.githubusercontent.com/JC-Concepts/WorkoutGenerator/refs/heads/main/workouts.json',
    catalogWorkoutsBase:
        'https://raw.githubusercontent.com/JC-Concepts/WorkoutGenerator/refs/heads/main/workouts',

    // Section 11 protocol assets
    section11Raw: 'https://raw.githubusercontent.com/CrankAddict/section-11/main',

    // APIs
    intervalsBase: 'https://intervals.icu/api/v1',
    openRouterBase: 'https://openrouter.ai/api/v1',
    githubApiBase: 'https://api.github.com',

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
        models: 'coach.models.v1',
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
