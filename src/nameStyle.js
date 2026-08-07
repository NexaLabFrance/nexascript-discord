'use strict';

const { REST, PermissionFlagsBits } = require('discord.js');
const { colorsToInts, sleep } = require('./utils');

const FONT_IDS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
const EFFECT_IDS = new Set([1, 2, 3, 4, 5, 6]);

function validateNameStyle(config) {
  const style = config.nameStyle || {};
  if (style.reset) return { ok: true, body: { display_name_font_id: null, display_name_effect_id: null, display_name_colors: null } };

  const fontId = Number(style.fontId);
  const effectId = Number(style.effectId);
  const colors = colorsToInts(style.colors, ['#FFFFFF']);

  if (!FONT_IDS.has(fontId)) return { ok: false, error: `Invalid fontId ${style.fontId}. Must be 1-12.` };
  if (!EFFECT_IDS.has(effectId)) return { ok: false, error: `Invalid effectId ${style.effectId}. Must be 1-6.` };
  if (!Array.isArray(colors) || colors.length < 1 || colors.length > 2) return { ok: false, error: 'colors must contain 1 or 2 colors.' };
  if (effectId === 2 && colors.length < 2) return { ok: false, error: 'Gradient effectId 2 requires 2 colors.' };

  return {
    ok: true,
    body: {
      display_name_font_id: fontId,
      display_name_effect_id: effectId,
      display_name_colors: colors,
    },
  };
}

async function applyNameStyleToGuild({ client, guild, config }) {
  const validation = validateNameStyle(config);
  if (!validation.ok) return { ok: false, guildId: guild.id, error: validation.error };

  try {
    const me = guild.members.me || await guild.members.fetchMe();
    if (!me.permissions.has(PermissionFlagsBits.ChangeNickname)) {
      return { ok: false, guildId: guild.id, error: 'Missing Change Nickname permission.' };
    }

    const rest = new REST({ version: '10' }).setToken(client.token);
    await rest.patch(`/guilds/${guild.id}/members/@me`, { body: validation.body });
    return { ok: true, guildId: guild.id };
  } catch (error) {
    return { ok: false, guildId: guild.id, error: error?.rawError?.message || error.message || 'Unknown error' };
  }
}

async function applyNameStylesOnStartup({ client, config }) {
  if (!config.nameStyle?.enabled || !config.nameStyle?.applyOnStartup) return [];

  const configuredGuildIds = Array.isArray(config.nameStyle.guildIds) ? config.nameStyle.guildIds.filter(Boolean) : [];
  const guilds = configuredGuildIds.length
    ? configuredGuildIds.map((id) => client.guilds.cache.get(id)).filter(Boolean)
    : [...client.guilds.cache.values()];

  const results = [];
  for (const guild of guilds) {
    results.push(await applyNameStyleToGuild({ client, guild, config }));
    await sleep(1500);
  }
  return results;
}

module.exports = { validateNameStyle, applyNameStyleToGuild, applyNameStylesOnStartup };
