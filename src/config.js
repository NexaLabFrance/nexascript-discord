'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { deepMerge, getPackageVersion, readJson } = require('./utils');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const EXAMPLE_PATH = path.join(ROOT, 'config.example.json');

const DEFAULT_CONFIG = {
  language: 'fr',
  version: getPackageVersion(),
  discord: {
    botToken: '',
    clientId: '',
    guildIds: [],
    registerCommandsOnStartup: true,
    status: 'online',
    staffRoleId: '',
    allowAdministrators: true,
  },
  nexalab: {
    baseUrl: 'https://api.nexalab.fr',
    apiToken: '',
    authMode: 'reseller',
    studioId: '',
    timeoutMs: 30000,
    licenseListMode: 'apiThenCache',
  },
  shop: {
    name: 'NexaScript',
    logoUrl: '',
    websiteUrl: 'https://nexalab.fr',
    supportUrl: '',
    footer: 'Powered by NexaLab',
    colors: {
      primary: '#5865F2',
      success: '#57F287',
      warning: '#FEE75C',
      danger: '#ED4245',
      neutral: '#2B2D31',
    },
  },
  customerRole: {
    enabled: true,
    roleId: '',
    giveOnLicenseCreate: true,
    removeWhenExpiredOrRevoked: true,
    dailyResync: true,
    dailyResyncHour: 3,
    expirationCheckMinutes: 15,
    claimCommandEnabled: true,
    grantMissingFromCacheOnSync: true,
    removeUnknownRoleHoldersOnSync: true,
  },
  licenseDefaults: {
    scriptId: '',
    maxSlots: 1,
    prefix: 'LIC',
    noteTemplate: 'Discord: {staffTag} -> {customerTag} ({customerId})',
  },
  delivery: {
    dmCustomerOnGive: true,
    includeLicenseKeyInStaffReply: true,
    includeLicenseKeyInLogs: false,
  },
  logging: {
    enabled: false,
    channelId: '',
    logDeniedPermission: true,
    logReleaseNotifications: true,
  },
  presence: {
    enabled: true,
    intervalSeconds: 30,
    activities: [
      { type: 'Watching', text: 'NexaScript v{version}' },
      { type: 'Playing', text: 'Powered by NexaLab' },
    ],
  },
  nameStyle: {
    enabled: false,
    applyOnStartup: true,
    reset: false,
    fontId: 10,
    effectId: 3,
    colors: ['#FFFFFF'],
    guildIds: [],
  },
  github: {
    enabled: true,
    repo: 'NexaLabFrance/nexascript-discord',
    checkIntervalMinutes: 60,
    releaseUrl: 'https://github.com/NexaLabFrance/nexascript-discord/releases/latest',
  },
  sync: {
    onReady: true,
    afterClaim: true,
    afterLicenseMutation: true,
    memberFetchChunkSize: 1000,
  },
};

function loadConfig() {
  let fileConfig = {};
  if (fs.existsSync(CONFIG_PATH)) {
    fileConfig = readJson(CONFIG_PATH, {});
  } else if (fs.existsSync(EXAMPLE_PATH)) {
    fileConfig = readJson(EXAMPLE_PATH, {});
  }

  const config = deepMerge(DEFAULT_CONFIG, fileConfig);

  // Les variables d’environnement gardent la priorité pour faciliter le déploiement.
  config.discord.botToken = process.env.DISCORD_BOT_TOKEN || config.discord.botToken || '';
  config.discord.clientId = process.env.DISCORD_CLIENT_ID || config.discord.clientId || '';
  config.nexalab.apiToken = process.env.NEXALAB_API_TOKEN || config.nexalab.apiToken || '';
  config.nexalab.studioId = process.env.NEXALAB_STUDIO_ID || config.nexalab.studioId || '';

  if (String(config.discord.clientId).includes('YOUR_DISCORD')) config.discord.clientId = '';
  config.version = config.version || getPackageVersion();
  config.language = ['fr', 'en'].includes(String(config.language).toLowerCase())
    ? String(config.language).toLowerCase()
    : 'fr';

  if (!Array.isArray(config.discord.guildIds)) config.discord.guildIds = [];
  config.discord.guildIds = config.discord.guildIds
    .map((id) => String(id).trim())
    .filter((id) => /^\d{15,25}$/.test(id));

  return config;
}

function validateRuntimeConfig(config) {
  const warnings = [];
  const errors = [];

  if (!config.discord.botToken || config.discord.botToken.includes('YOUR_DISCORD')) {
    errors.push('discord.botToken est manquant dans config.json.');
  }

  if (!config.discord.staffRoleId || config.discord.staffRoleId.includes('ROLE_ID')) {
    warnings.push('discord.staffRoleId est vide: les commandes staff ne seront accessibles qu’aux administrateurs si allowAdministrators=true.');
  }

  if (!config.nexalab.apiToken || config.nexalab.apiToken.includes('YOUR_RESELLER')) {
    errors.push('nexalab.apiToken est manquant dans config.json.');
  }

  if (config.customerRole.enabled && (!config.customerRole.roleId || config.customerRole.roleId.includes('CUSTOMER_ROLE'))) {
    warnings.push('customerRole.enabled=true mais customerRole.roleId est vide ou placeholder. Le système de rôle client sera ignoré tant qu’il n’est pas configuré.');
  }

  if (config.logging.enabled && (!config.logging.channelId || config.logging.channelId.includes('LOG_CHANNEL'))) {
    warnings.push('logging.enabled=true mais logging.channelId est vide ou placeholder. Les logs Discord seront ignorés.');
  }

  return { warnings, errors };
}

module.exports = {
  ROOT,
  CONFIG_PATH,
  DEFAULT_CONFIG,
  loadConfig,
  validateRuntimeConfig,
};
