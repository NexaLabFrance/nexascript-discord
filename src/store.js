'use strict';

const path = require('node:path');
const { ROOT } = require('./config');
const { readJson, writeJsonAtomic, normalizeLicense, isLicenseActive } = require('./utils');

const DEFAULT_STATE = {
  version: 1,
  licenses: {},
  meta: {
    latestReleaseTag: null,
    lastReleaseCheckAt: null,
    lastSyncAt: null,
    apiListAvailable: null,
  },
};

class Store {
  constructor(filePath = path.join(ROOT, 'data', 'state.json')) {
    this.filePath = filePath;
    this.state = readJson(filePath, DEFAULT_STATE);
    this.state.version ||= 1;
    this.state.licenses ||= {};
    this.state.meta ||= {};
  }

  save() {
    writeJsonAtomic(this.filePath, this.state);
  }

  getMeta(key, fallback = null) {
    return Object.prototype.hasOwnProperty.call(this.state.meta, key) ? this.state.meta[key] : fallback;
  }

  setMeta(key, value) {
    this.state.meta[key] = value;
    this.save();
  }

  upsertLicense(raw, extra = {}) {
    const normalized = normalizeLicense({ ...raw, ...extra });
    if (!normalized) return null;
    const previous = this.state.licenses[normalized.key] || {};
    const merged = {
      ...previous,
      ...normalized,
      ...extra,
      key: normalized.key,
      lastSeenAt: new Date().toISOString(),
    };
    this.state.licenses[normalized.key] = merged;
    this.save();
    return merged;
  }

  upsertMany(licenses, extra = {}) {
    const saved = [];
    for (const license of licenses || []) {
      const normalized = normalizeLicense({ ...license, ...extra });
      if (!normalized) continue;
      const previous = this.state.licenses[normalized.key] || {};
      this.state.licenses[normalized.key] = {
        ...previous,
        ...normalized,
        ...extra,
        key: normalized.key,
        lastSeenAt: new Date().toISOString(),
      };
      saved.push(this.state.licenses[normalized.key]);
    }
    if (saved.length) this.save();
    return saved;
  }

  markDeleted(key) {
    if (!key) return null;
    const current = this.state.licenses[key] || { key };
    this.state.licenses[key] = {
      ...current,
      deleted: true,
      revoked: true,
      updatedAt: new Date().toISOString(),
    };
    this.save();
    return this.state.licenses[key];
  }

  getLicense(key) {
    return this.state.licenses[key] || null;
  }

  allLicenses({ includeDeleted = false } = {}) {
    const values = Object.values(this.state.licenses || {});
    return includeDeleted ? values : values.filter((license) => !license.deleted);
  }

  activeLicensesForDiscord(discordId) {
    if (!discordId) return [];
    return this.allLicenses().filter(
      (license) => String(license.discordId) === String(discordId) && isLicenseActive(license),
    );
  }

  licensesForDiscord(discordId) {
    if (!discordId) return [];
    return this.allLicenses().filter((license) => String(license.discordId) === String(discordId));
  }

  activeDiscordIds() {
    return [...new Set(this.allLicenses().filter(isLicenseActive).map((license) => license.discordId).filter(Boolean))];
  }
}

module.exports = { Store };
