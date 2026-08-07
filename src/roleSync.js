'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { isExpired, isLicenseActive } = require('./utils');

function isCustomerRoleConfigured(config) {
  return Boolean(config.customerRole?.enabled && config.customerRole?.roleId && !String(config.customerRole.roleId).includes('CUSTOMER_ROLE'));
}

function isUnsupportedListEndpoint(error) {
  const message = String(error?.message || error?.body?.message || '');
  return error?.status === 404 && /No API route/i.test(message);
}

class RoleSyncService {
  constructor({ client, config, api, store, logger }) {
    this.client = client;
    this.config = config;
    this.api = api;
    this.store = store;
    this.logger = logger;
    this.lastFullApiRefreshAt = 0;
    this.fullApiRefreshSucceeded = false;
  }

  mode() {
    return String(this.config.nexalab?.licenseListMode || 'apiThenCache');
  }

  isEnabled() {
    return isCustomerRoleConfigured(this.config);
  }

  async refreshAllFromApi() {
    if (this.mode() === 'cacheOnly') return { ok: true, source: 'cache', count: 0 };
    try {
      const licenses = await this.api.listLicenses();
      this.store.upsertMany(licenses, { source: 'api' });
      this.store.setMeta('apiListAvailable', true);
      this.lastFullApiRefreshAt = Date.now();
      this.fullApiRefreshSucceeded = true;
      return { ok: true, source: 'api', count: licenses.length };
    } catch (error) {
      this.store.setMeta('apiListAvailable', false);
      this.fullApiRefreshSucceeded = false;
      if (this.mode() === 'apiOnly') throw error;
      return { ok: false, source: 'cache', count: 0, error };
    }
  }

  async activeLicensesForDiscord(discordId, { forceApi = false } = {}) {
    const mode = this.mode();
    if (mode !== 'cacheOnly' && (forceApi || mode === 'apiOnly' || mode === 'apiThenCache')) {
      try {
        const apiLicenses = await this.api.listLicensesForDiscord(discordId);
        const saved = this.store.upsertMany(apiLicenses, { source: 'api' });
        this.store.setMeta('apiListAvailable', true);
        return {
          licenses: saved.filter(isLicenseActive),
          source: 'api',
          fresh: true,
        };
      } catch (error) {
        this.store.setMeta('apiListAvailable', false);
        if (mode === 'apiOnly') throw error;
        const cached = this.store.activeLicensesForDiscord(discordId);
        return {
          licenses: cached,
          source: 'cache',
          // Si l’endpoint de listing n’est pas exposé, le cache local sert de référence.
          fresh: mode === 'cacheOnly' || isUnsupportedListEndpoint(error),
          error,
        };
      }
    }

    return {
      licenses: this.store.activeLicensesForDiscord(discordId),
      source: 'cache',
      fresh: true,
    };
  }

  async shouldHaveRole(discordId, options = {}) {
    const result = await this.activeLicensesForDiscord(discordId, options);
    return {
      ...result,
      should: result.licenses.length > 0,
    };
  }

  async ensureRoleObject(guild) {
    if (!this.isEnabled()) return null;
    try {
      return guild.roles.cache.get(this.config.customerRole.roleId) || await guild.roles.fetch(this.config.customerRole.roleId);
    } catch {
      return null;
    }
  }

  botCanManage(guild, role) {
    const me = guild.members.me;
    if (!me || !role) return false;
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) return false;
    return me.roles.highest.comparePositionTo(role) > 0;
  }

  async syncMemberRole(guild, userId, { forceApi = true, reason = 'NexaScript customer role sync' } = {}) {
    const result = {
      added: 0,
      removed: 0,
      kept: 0,
      skipped: 0,
      shouldHaveRole: false,
      source: 'cache',
      fresh: false,
    };

    if (!this.isEnabled() || !guild) {
      result.skipped += 1;
      return result;
    }

    const role = await this.ensureRoleObject(guild);
    if (!role || !this.botCanManage(guild, role)) {
      result.skipped += 1;
      return result;
    }

    let member;
    try {
      member = await guild.members.fetch(userId);
    } catch {
      result.skipped += 1;
      return result;
    }

    const check = await this.shouldHaveRole(userId, { forceApi });
    result.shouldHaveRole = check.should;
    result.source = check.source;
    result.fresh = check.fresh;

    const hasRole = member.roles.cache.has(role.id);
    if (check.should && !hasRole) {
      await member.roles.add(role, reason);
      result.added += 1;
    } else if (!check.should && hasRole && this.config.customerRole.removeWhenExpiredOrRevoked) {
      // Aucun retrait sans vérification fraîche: une licence temporaire peut avoir été renouvelée.
      if (!check.fresh && this.mode() !== 'cacheOnly') {
        result.skipped += 1;
      } else {
        await member.roles.remove(role, reason);
        result.removed += 1;
      }
    } else {
      result.kept += 1;
    }

    return result;
  }

  async syncGuild(guild, { reason = 'NexaScript daily customer role sync', forceApiBeforeRemoval = true } = {}) {
    const result = {
      guildId: guild?.id,
      added: 0,
      removed: 0,
      kept: 0,
      skipped: 0,
      apiRefreshed: false,
      apiRefreshError: null,
    };

    if (!this.isEnabled() || !guild) {
      result.skipped += 1;
      return result;
    }

    const role = await this.ensureRoleObject(guild);
    if (!role || !this.botCanManage(guild, role)) {
      result.skipped += 1;
      return result;
    }

    const apiRefresh = await this.refreshAllFromApi();
    result.apiRefreshed = apiRefresh.ok && apiRefresh.source === 'api';
    if (apiRefresh.error) result.apiRefreshError = apiRefresh.error.message;

    try {
      await guild.members.fetch();
    } catch {
      // En cas d’intent GuildMembers manquant, la synchronisation reste possible par utilisateur ciblé.
    }

    const targetIds = new Set();

    if (this.config.customerRole.grantMissingFromCacheOnSync) {
      for (const discordId of this.store.activeDiscordIds()) targetIds.add(discordId);
    }

    if (this.config.customerRole.removeUnknownRoleHoldersOnSync) {
      for (const member of guild.members.cache.values()) {
        if (member.roles.cache.has(role.id)) targetIds.add(member.id);
      }
    }

    for (const userId of targetIds) {
      try {
        const forceApi = forceApiBeforeRemoval && !result.apiRefreshed && this.mode() !== 'cacheOnly';
        const memberResult = await this.syncMemberRole(guild, userId, { forceApi, reason });
        result.added += memberResult.added;
        result.removed += memberResult.removed;
        result.kept += memberResult.kept;
        result.skipped += memberResult.skipped;
      } catch {
        result.skipped += 1;
      }
    }

    this.store.setMeta('lastSyncAt', new Date().toISOString());
    return result;
  }

  async syncExpiredKnownLicenses({ reason = 'NexaScript temporary license expiration check' } = {}) {
    const totals = { added: 0, removed: 0, kept: 0, skipped: 0, users: 0, guilds: 0 };
    if (!this.isEnabled() || !this.config.customerRole?.removeWhenExpiredOrRevoked) return totals;

    const expiredDiscordIds = new Set(
      this.store
        .allLicenses()
        .filter((license) => license.discordId && license.expiresAt && !license.deleted && isExpired(license.expiresAt))
        .map((license) => license.discordId),
    );

    for (const userId of expiredDiscordIds) {
      totals.users += 1;
      for (const guild of this.client.guilds.cache.values()) {
        try {
          const result = await this.syncMemberRole(guild, userId, { forceApi: true, reason });
          totals.added += result.added;
          totals.removed += result.removed;
          totals.kept += result.kept;
          totals.skipped += result.skipped;
          totals.guilds += 1;
        } catch {
          totals.skipped += 1;
        }
      }
    }

    return totals;
  }

  async syncAllGuilds({ reason = 'NexaScript daily customer role sync' } = {}) {
    const totals = { added: 0, removed: 0, kept: 0, skipped: 0, guilds: 0 };
    for (const guild of this.client.guilds.cache.values()) {
      const result = await this.syncGuild(guild, { reason });
      totals.added += result.added;
      totals.removed += result.removed;
      totals.kept += result.kept;
      totals.skipped += result.skipped;
      totals.guilds += 1;
    }
    return totals;
  }
}

module.exports = { RoleSyncService, isCustomerRoleConfigured };
