#!/usr/bin/env node
'use strict';

const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const { loadConfig, validateRuntimeConfig } = require('./config');
const { buildCommands, registerCommands } = require('./commands');
const { NexaLabApi } = require('./nexalabApi');
const { Store } = require('./store');
const { BotLogger } = require('./logger');
const { RoleSyncService } = require('./roleSync');
const { PresenceRotator } = require('./presence');
const { ReleaseWatcher } = require('./releaseWatcher');
const { applyNameStylesOnStartup } = require('./nameStyle');
const { handleInteraction } = require('./commandHandlers');

const config = loadConfig();
const validation = validateRuntimeConfig(config);

for (const warning of validation.warnings) console.warn(`⚠️  ${warning}`);
if (validation.errors.length) {
  for (const error of validation.errors) console.error(`❌ ${error}`);
  console.error('Copie config.example.json vers config.json puis complète les tokens/IDs.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel],
});

const api = new NexaLabApi(config);
const store = new Store();
let logger;
let roleSync;
let presence;
let releases;
let dailyInterval = null;
let expirationInterval = null;

function parisDayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function parisHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    hour12: false,
  }).format(date));
}

function startDailyRoleSync() {
  if (!config.customerRole?.enabled || !config.customerRole?.dailyResync) return;
  const targetHour = Number.isInteger(Number(config.customerRole.dailyResyncHour))
    ? Number(config.customerRole.dailyResyncHour)
    : 3;

  dailyInterval = setInterval(async () => {
    const today = parisDayKey();
    const lastDaily = store.getMeta('lastDailySyncDay', null);
    if (lastDaily === today) return;
    if (parisHour() !== targetHour) return;

    store.setMeta('lastDailySyncDay', today);
    try {
      const result = await roleSync.syncAllGuilds({ reason: 'NexaScript daily customer role sync' });
      console.log(`🔁 Daily role sync done: ${JSON.stringify(result)}`);
      await logger.action({
        title: '🔁 Daily role sync',
        action: 'daily-sync',
        kind: 'success',
        fields: [{ name: 'Result', value: JSON.stringify(result, null, 2) }],
      }).catch(() => {});
    } catch (error) {
      console.error('Daily role sync failed:', error);
      await logger.action({
        title: '🔁 Daily role sync failed',
        action: 'daily-sync',
        kind: 'danger',
        fields: [{ name: 'Error', value: error.message || String(error) }],
      }).catch(() => {});
    }
  }, 5 * 60 * 1000);
}

function startExpirationWatcher() {
  if (!config.customerRole?.enabled || !config.customerRole?.removeWhenExpiredOrRevoked) return;
  const minutes = Math.max(5, Number(config.customerRole.expirationCheckMinutes || 15));

  expirationInterval = setInterval(async () => {
    try {
      const result = await roleSync.syncExpiredKnownLicenses({ reason: 'NexaScript temporary license expiration check' });
      if (result.users > 0) console.log(`⏱️ Expiration role check: ${JSON.stringify(result)}`);
    } catch (error) {
      console.warn('⚠️ Expiration role check failed:', error.message || error);
    }
  }, minutes * 60 * 1000);
}

client.once(Events.ClientReady, async () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
  console.log('ℹ️  Garder le statut par défaut “Powered by NexaLab” nous apporte du soutien ❤️');

  logger = new BotLogger(client, config);
  roleSync = new RoleSyncService({ client, config, api, store, logger });
  presence = new PresenceRotator(client, config);
  releases = new ReleaseWatcher({ config, store, logger });

  if (config.discord?.registerCommandsOnStartup) {
    try {
      const commands = buildCommands(config);
      const result = await registerCommands({
        token: config.discord.botToken,
        clientId: config.discord.clientId || client.user.id,
        guildIds: config.discord.guildIds,
        commands,
      });
      console.log(`✅ Slash commands enregistrées: ${result.count} (${result.scope}).`);
    } catch (error) {
      console.error('❌ Impossible d’enregistrer les slash commands:', error);
    }
  }

  presence.start();

  try {
    const styleResults = await applyNameStylesOnStartup({ client, config });
    for (const result of styleResults) {
      if (result.ok) console.log(`🎨 Name style appliqué sur ${result.guildId}`);
      else console.warn(`⚠️ Name style impossible sur ${result.guildId}: ${result.error}`);
    }
  } catch (error) {
    console.warn('⚠️ Name style startup error:', error.message || error);
  }

  releases.start();

  if (config.sync?.onReady && config.customerRole?.enabled) {
    roleSync.syncAllGuilds({ reason: 'NexaScript startup role sync' })
      .then((result) => console.log(`🔁 Startup role sync: ${JSON.stringify(result)}`))
      .catch((error) => console.warn('⚠️ Startup role sync failed:', error.message || error));
  }

  startDailyRoleSync();
  startExpirationWatcher();
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!logger || !roleSync) return;
  await handleInteraction(interaction, { client, config, api, store, logger, roleSync });
});

client.on(Events.GuildCreate, async (guild) => {
  if (!presence) return;
  presence.applyNext();
  if (config.nameStyle?.enabled && config.nameStyle?.applyOnStartup) {
    applyNameStylesOnStartup({ client, config }).catch(() => {});
  }
  if (config.sync?.onReady && config.customerRole?.enabled && roleSync) {
    roleSync.syncGuild(guild, { reason: 'NexaScript joined guild role sync' }).catch(() => {});
  }
});

async function shutdown(signal) {
  console.log(`\n${signal} reçu, arrêt…`);
  if (dailyInterval) clearInterval(dailyInterval);
  if (expirationInterval) clearInterval(expirationInterval);
  if (presence) presence.stop();
  if (releases) releases.stop();
  client.destroy();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

client.login(config.discord.botToken);
