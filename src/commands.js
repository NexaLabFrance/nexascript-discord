'use strict';

const { REST, Routes, SlashCommandBuilder } = require('discord.js');

function localDescription(fr, en) {
  return { fr, 'en-US': en, 'en-GB': en };
}

function buildCommands(config) {
  const commands = [];

  commands.push(
    new SlashCommandBuilder()
      .setName('ping')
      .setDescription('Show bot latency')
      .setDescriptionLocalizations(localDescription('Affiche la latence du bot', 'Show bot latency'))
      .setDMPermission(true),
  );

  commands.push(
    new SlashCommandBuilder()
      .setName('status')
      .setDescription('Check NexaLab API health')
      .setDescriptionLocalizations(localDescription('Vérifie la santé de l’API NexaLab', 'Check NexaLab API health'))
      .setDMPermission(false),
  );

  commands.push(
    new SlashCommandBuilder()
      .setName('sync')
      .setDescription('Resynchronize customer roles')
      .setDescriptionLocalizations(localDescription('Resynchronise les rôles clients', 'Resynchronize customer roles'))
      .setDMPermission(false),
  );

  if (config.customerRole?.enabled && config.customerRole?.claimCommandEnabled) {
    commands.push(
      new SlashCommandBuilder()
        .setName('claim')
        .setDescription('Claim your customer role if you have an active license')
        .setDescriptionLocalizations(localDescription('Récupère ton rôle client si tu as une licence active', 'Claim your customer role if you have an active license'))
        .setDMPermission(false),
    );
  }

  const license = new SlashCommandBuilder()
    .setName('license')
    .setDescription('Manage NexaLab licenses')
    .setDescriptionLocalizations(localDescription('Gère les licences NexaLab', 'Manage NexaLab licenses'))
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('give')
        .setDescription('Create and give a license')
        .setDescriptionLocalizations(localDescription('Crée et donne une licence', 'Create and give a license'))
        .addStringOption((option) =>
          option
            .setName('script_id')
            .setDescription('NexaLab scriptId. Uses config default when omitted.')
            .setDescriptionLocalizations(localDescription('scriptId NexaLab. Utilise le défaut du config si vide.', 'NexaLab scriptId. Uses config default when omitted.'))
            .setRequired(false),
        )
        .addUserOption((option) =>
          option
            .setName('customer')
            .setDescription('Discord customer receiving the license')
            .setDescriptionLocalizations(localDescription('Client Discord qui reçoit la licence', 'Discord customer receiving the license'))
            .setRequired(false),
        )
        .addIntegerOption((option) =>
          option
            .setName('max_slots')
            .setDescription('Maximum concurrent servers')
            .setDescriptionLocalizations(localDescription('Nombre maximum de serveurs simultanés', 'Maximum concurrent servers'))
            .setMinValue(0)
            .setRequired(false),
        )
        .addIntegerOption((option) =>
          option
            .setName('duration_days')
            .setDescription('Temporary license duration in days')
            .setDescriptionLocalizations(localDescription('Durée de la licence temporaire en jours', 'Temporary license duration in days'))
            .setMinValue(1)
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName('expires_at')
            .setDescription('ISO expiry date or null/lifetime')
            .setDescriptionLocalizations(localDescription('Date ISO d’expiration ou null/à vie', 'ISO expiry date or null/lifetime'))
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName('prefix')
            .setDescription('License key prefix')
            .setDescriptionLocalizations(localDescription('Préfixe de la clé licence', 'License key prefix'))
            .setMaxLength(16)
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName('note')
            .setDescription('Internal note/order id')
            .setDescriptionLocalizations(localDescription('Note interne / ID commande', 'Internal note/order id'))
            .setMaxLength(512)
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('edit')
        .setDescription('Edit license slots or expiry')
        .setDescriptionLocalizations(localDescription('Modifie les slots ou l’expiration', 'Edit license slots or expiry'))
        .addStringOption((option) =>
          option
            .setName('key')
            .setDescription('License key')
            .setDescriptionLocalizations(localDescription('Clé de licence', 'License key'))
            .setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName('max_slots')
            .setDescription('New maximum concurrent servers')
            .setDescriptionLocalizations(localDescription('Nouveau nombre maximum de serveurs simultanés', 'New maximum concurrent servers'))
            .setMinValue(0)
            .setRequired(false),
        )
        .addIntegerOption((option) =>
          option
            .setName('duration_days')
            .setDescription('New duration from now, in days')
            .setDescriptionLocalizations(localDescription('Nouvelle durée à partir de maintenant, en jours', 'New duration from now, in days'))
            .setMinValue(1)
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName('expires_at')
            .setDescription('New ISO expiry date or null/lifetime')
            .setDescriptionLocalizations(localDescription('Nouvelle expiration ISO ou null/à vie', 'New ISO expiry date or null/lifetime'))
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Permanently delete a license')
        .setDescriptionLocalizations(localDescription('Supprime définitivement une licence', 'Permanently delete a license'))
        .addStringOption((option) =>
          option
            .setName('key')
            .setDescription('License key')
            .setDescriptionLocalizations(localDescription('Clé de licence', 'License key'))
            .setRequired(true),
        )
        .addBooleanOption((option) =>
          option
            .setName('confirm')
            .setDescription('Must be true to confirm permanent deletion')
            .setDescriptionLocalizations(localDescription('Doit être true pour confirmer la suppression définitive', 'Must be true to confirm permanent deletion'))
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('suspend')
        .setDescription('Suspend or restore a license')
        .setDescriptionLocalizations(localDescription('Suspend ou restaure une licence', 'Suspend or restore a license'))
        .addStringOption((option) =>
          option
            .setName('key')
            .setDescription('License key')
            .setDescriptionLocalizations(localDescription('Clé de licence', 'License key'))
            .setRequired(true),
        )
        .addBooleanOption((option) =>
          option
            .setName('revoked')
            .setDescription('true=suspend, false=restore. Defaults to true.')
            .setDescriptionLocalizations(localDescription('true=suspend, false=restore. Par défaut: true.', 'true=suspend, false=restore. Defaults to true.'))
            .setRequired(false),
        ),
    );

  commands.push(license);

  return commands.map((command) => command.toJSON());
}

async function registerCommands({ token, clientId, guildIds = [], commands }) {
  if (!token) throw new Error('Missing Discord bot token');
  if (!clientId) throw new Error('Missing Discord client/application id');
  const rest = new REST({ version: '10' }).setToken(token);
  if (guildIds.length) {
    for (const guildId of guildIds) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    }
    return { scope: 'guild', guilds: guildIds.length, count: commands.length };
  }
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  return { scope: 'global', guilds: 0, count: commands.length };
}

module.exports = { buildCommands, registerCommands };
