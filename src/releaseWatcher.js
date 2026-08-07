'use strict';

class ReleaseWatcher {
  constructor({ config, store, logger }) {
    this.config = config;
    this.store = store;
    this.logger = logger;
    this.interval = null;
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
      return { ok: false, error };
    }

    this.store.setMeta('lastReleaseCheckAt', new Date().toISOString());
    if (!latest?.tag_name) return { ok: true, release: null };

    const previous = this.store.getMeta('latestReleaseTag', null);
    if (!previous) {
      this.store.setMeta('latestReleaseTag', latest.tag_name);
      if (!announceFirst) return { ok: true, release: latest, announced: false };
    }

    if (announceFirst || previous !== latest.tag_name) {
      this.store.setMeta('latestReleaseTag', latest.tag_name);
      await this.logger.release({
        name: latest.name || latest.tag_name,
        tag: latest.tag_name,
        url: latest.html_url || this.config.github.releaseUrl,
        body: latest.body || '',
      });
      return { ok: true, release: latest, announced: true };
    }

    return { ok: true, release: latest, announced: false };
  }

  start() {
    if (!this.config.github?.enabled) return;
    this.stop();
    this.check({ announceFirst: false }).catch(() => {});
    const minutes = Math.max(10, Number(this.config.github.checkIntervalMinutes || 60));
    this.interval = setInterval(() => this.check({ announceFirst: false }).catch(() => {}), minutes * 60 * 1000);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }
}

module.exports = { ReleaseWatcher };
