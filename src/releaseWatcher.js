'use strict';

const { getPackageVersion } = require('./utils');

function cleanVersion(value) {
  return String(value || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[+-]/)[0];
}

function parseVersion(value) {
  const clean = cleanVersion(value);
  if (!/^\d+(\.\d+){0,2}$/.test(clean)) return null;
  const [major = 0, minor = 0, patch = 0] = clean.split('.').map((part) => Number(part));
  return [major, minor, patch];
}

function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return String(a).localeCompare(String(b));

  for (let i = 0; i < 3; i += 1) {
    if (left[i] > right[i]) return 1;
    if (left[i] < right[i]) return -1;
  }

  return 0;
}

class ReleaseWatcher {
  constructor({ config, store, logger }) {
    this.config = config;
    this.store = store;
    this.logger = logger;
    this.interval = null;
    this.currentVersion = getPackageVersion();
  }

  latestApiUrl() {
    const repo = this.config.github?.repo || 'NexaLabFrance/nexascript-discord';
    return `https://api.github.com/repos/${repo}/releases/latest`;
  }

  async fetchLatest() {
    const response = await fetch(this.latestApiUrl(), {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'nexascript-discord-bot',
      },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
    return response.json();
  }

  async check({ announceFirst = false } = {}) {
    if (!this.config.github?.enabled) return null;

    let latest;
    try {
      latest = await this.fetchLatest();
    } catch (error) {
      this.store.setMeta('lastReleaseCheckAt', new Date().toISOString());
      console.warn(`[GitHub] Release check failed: ${error.message || error}`);
      return { ok: false, error };
    }

    this.store.setMeta('lastReleaseCheckAt', new Date().toISOString());

    if (!latest?.tag_name) {
      console.log(`[GitHub] No release found for ${this.config.github?.repo}. Current package version: ${this.currentVersion}`);
      return { ok: true, release: null };
    }

    const latestTag = latest.tag_name;
    const latestVersion = cleanVersion(latestTag);
    const currentVersion = this.currentVersion;
    const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
    const previousNotifiedTag = this.store.getMeta('latestReleaseTag', null);
    const releaseUrl = latest.html_url || this.config.github.releaseUrl;

    if (!updateAvailable) {
      this.store.setMeta('latestReleaseTag', latestTag);
      console.log(`[GitHub] Up to date: package.json v${currentVersion}, latest ${latestTag}`);
      return { ok: true, release: latest, announced: false, updateAvailable: false };
    }

    console.warn(`[GitHub] Update available: package.json v${currentVersion} -> ${latestTag} (${releaseUrl})`);

    const shouldAnnounce = announceFirst || previousNotifiedTag !== latestTag;
    if (shouldAnnounce) {
      this.store.setMeta('latestReleaseTag', latestTag);
      await this.logger.release({
        name: latest.name || latestTag,
        tag: latestTag,
        currentVersion,
        url: releaseUrl,
        body: latest.body || '',
      });
      return { ok: true, release: latest, announced: true, updateAvailable: true };
    }

    return { ok: true, release: latest, announced: false, updateAvailable: true };
  }

  start() {
    if (!this.config.github?.enabled) return;
    this.stop();
    console.log(`[GitHub] Release watcher started. Current package version: v${this.currentVersion}`);
    this.check({ announceFirst: false }).catch((error) => {
      console.warn(`[GitHub] Release check failed: ${error.message || error}`);
    });

    const minutes = Math.max(10, Number(this.config.github.checkIntervalMinutes || 60));
    this.interval = setInterval(() => {
      this.check({ announceFirst: false }).catch((error) => {
        console.warn(`[GitHub] Release check failed: ${error.message || error}`);
      });
    }, minutes * 60 * 1000);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }
}

module.exports = { ReleaseWatcher };