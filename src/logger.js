'use strict';

const { sendToChannel } = require('./ui');
const { maskKey, truncate } = require('./utils');
const { t } = require('./i18n');

class BotLogger {
  constructor(client, config) {
    this.client = client;
    this.config = config;
  }

  async getChannel() {
    if (!this.config.logging?.enabled || !this.config.logging?.channelId) return null;
    try {
      return await this.client.channels.fetch(this.config.logging.channelId);
    } catch {
      return null;
    }
  }

  safeKey(key) {
    if (this.config.delivery?.includeLicenseKeyInLogs) return key;
    return maskKey(key);
  }

  async action({ interaction, title, action, target, fields = [], kind = 'primary' }) {
    const channel = await this.getChannel();
    if (!channel) return null;
    const lang = this.config.language || 'fr';
    const staff = interaction?.user ? `${interaction.user.tag} (${interaction.user.id})` : 'system';
    const guild = interaction?.guild ? `${interaction.guild.name} (${interaction.guild.id})` : 'system';
    const lines = [
      { name: t(lang, 'log_action_title'), value: `**Action:** ${action || title || 'unknown'}\n**Staff:** ${staff}\n**Guild:** ${guild}${target ? `\n**Target:** ${target}` : ''}` },
      ...fields.map((field) => (typeof field === 'string' ? field : { name: field.name, value: truncate(field.value, 1000) })),
    ];
    return sendToChannel(channel, this.config, {
      title: title || t(lang, 'log_action_title'),
      kind,
      fields: lines,
      footer: `${this.config.shop?.footer || 'Powered by NexaLab'} • ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`,
    });
  }

  async denied(interaction, commandName) {
    if (!this.config.logging?.logDeniedPermission) return null;
    return this.action({
      interaction,
      title: '⛔ Permission denied',
      kind: 'danger',
      action: `/${commandName}`,
      target: interaction?.user ? `${interaction.user.tag} (${interaction.user.id})` : undefined,
    });
  }

  async release({ name, tag, currentVersion, url, body }) {
    if (!this.config.logging?.logReleaseNotifications) return null;
    const channel = await this.getChannel();
    if (!channel) return null;
    const lang = this.config.language || 'fr';
    const fields = [];
    if (currentVersion) fields.push({ name: 'Version', value: `Installed: \`v${currentVersion}\`\nLatest: \`${tag}\`` });
    if (body) fields.push({ name: 'Changelog', value: truncate(body, 1800) });

    return sendToChannel(channel, this.config, {
      title: t(lang, 'release_title'),
      kind: 'success',
      description: t(lang, 'release_body', { name, tag, url }),
      fields,
      buttons: url ? [{ type: 2, style: 5, label: 'GitHub Release', url, emoji: { name: '🚀' } }] : [],
    });
  }
}

module.exports = { BotLogger };