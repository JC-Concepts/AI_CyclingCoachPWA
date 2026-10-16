/**
 * skills.js - discovers and caches every Markdown skill in the public Skills directory.
 * Athlete data and credentials are never sent to this public-source request.
 */
'use strict';

(function (root, factory) {
    var SkillsLoader = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = SkillsLoader;
    if (root) root.SkillsLoader = SkillsLoader;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    function SkillsLoader(storage, options) {
        options = options || {};
        this.storage = storage;
        this.apiUrl = options.apiUrl || '';
        this.fetch = options.fetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
        this.now = options.now || Date.now;
        this.cacheKey = options.cacheKey || 'coach.skills.v1';
        this.cacheTtlMs = options.cacheTtlMs || 24 * 60 * 60 * 1000;
    }

    SkillsLoader.prototype._readCache = function () {
        var cache = this.storage.getJSON(this.cacheKey, null);
        return cache && Array.isArray(cache.skills) ? cache : null;
    };

    SkillsLoader.prototype._fetchAll = async function (cachedSkills) {
        if (!this.apiUrl) throw new Error('The public Skills directory URL is not configured.');
        if (!this.fetch) throw new Error('Network access is unavailable.');

        var response = await this.fetch(this.apiUrl, {
            headers: { Accept: 'application/vnd.github+json' }
        });
        if (!response.ok) {
            throw new Error('Could not list public skills (' + response.status + ').');
        }
        var entries = await response.json();
        if (!Array.isArray(entries)) throw new Error('The public Skills directory response is invalid.');

        var markdownFiles = entries.filter(function (entry) {
            return entry && entry.type === 'file' && /\.md$/i.test(entry.name || '');
        }).sort(function (a, b) {
            return a.name.localeCompare(b.name);
        });
        var cachedByName = Object.create(null);
        (cachedSkills || []).forEach(function (skill) {
            cachedByName[skill.name] = skill;
        });

        var skills = await Promise.all(markdownFiles.map(async function (entry) {
            var cached = cachedByName[entry.name];
            if (cached && entry.sha && cached.sha === entry.sha && typeof cached.content === 'string') {
                return cached;
            }
            var url = entry.download_url;
            if (!url || new URL(url).hostname !== 'raw.githubusercontent.com') {
                throw new Error('Invalid public download URL for skill ' + entry.name + '.');
            }
            var skillResponse = await this.fetch(url);
            if (!skillResponse.ok) {
                throw new Error('Could not load skill ' + entry.name + ' (' +
                    skillResponse.status + ').');
            }
            return { name: entry.name, sha: entry.sha || '', content: await skillResponse.text() };
        }, this));

        return skills;
    };

    SkillsLoader.prototype.load = async function (forceRefresh) {
        var cached = this._readCache();
        var currentTime = this.now();
        if (!forceRefresh && cached && currentTime - cached.fetchedAt < this.cacheTtlMs) {
            return { skills: cached.skills, stale: false, fromCache: true };
        }

        try {
            var skills = await this._fetchAll(cached && cached.skills);
            if (!skills.length) throw new Error('No Markdown skills were found in the Skills directory.');
            this.storage.setJSON(this.cacheKey, { fetchedAt: currentTime, skills: skills });
            return { skills: skills, stale: false, fromCache: false };
        } catch (error) {
            if (cached) {
                return {
                    skills: cached.skills,
                    stale: true,
                    fromCache: true,
                    warning: error.message
                };
            }
            throw error;
        }
    };

    SkillsLoader.formatForPrompt = function (skills) {
        if (!Array.isArray(skills) || !skills.length) return '';
        return '=== ALL SKILLS DISCOVERED IN THE PUBLIC Skills/ DIRECTORY ===\n' +
            skills.map(function (skill) {
                return '--- Skills/' + skill.name + ' ---\n' + skill.content;
            }).join('\n\n');
    };

    return SkillsLoader;
});
