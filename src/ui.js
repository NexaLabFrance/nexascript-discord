'use strict';

const { hexToInt, maskKey, truncate } = require('./utils');

const MessageFlagsV2 = 1 << 15; // Flag Discord IS_COMPONENTS_V2.
const MessageFlagsEphemeral = 1 << 6;

const ComponentType = Object.freeze({
  ActionRow: 1,
  Button: 2,
  Section: 9,
  TextDisplay: 10,
  Thumbnail: 11,
  Separator: 14,
  Container: 17,
});

const ButtonStyle = Object.freeze({
  Primary: 1,
  Secondary: 2,
  Success: 3,
  Danger: 4,
  Link: 5,
});

function flags(ephemeral = false) {
  return MessageFlagsV2 | (ephemeral ? MessageFlagsEphemeral : 0);
}

function isProbablyUrl(value) {
  if (!value || typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'attachment:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function colorFromKind(config, kind) {
  const colors = config.shop?.colors || {};
  if (kind === 'success') return hexToInt(colors.success || '#57F287');
  if (kind === 'warning') return hexToInt(colors.warning || '#FEE75C');
  if (kind === 'danger' || kind === 'error') return hexToInt(colors.danger || '#ED4245');
  if (kind === 'neutral') return hexToInt(colors.neutral || '#2B2D31');
  return hexToInt(colors.primary || '#5865F2');
}

function textDisplay(content) {
  return {
    type: ComponentType.TextDisplay,
    content: truncate(content, 4000),
  };
}

function separator(divider = true, spacing = 1) {
  return {
    type: ComponentType.Separator,
    divider,
    spacing,
  };
}

function linkButton(label, url, emoji) {
  const component = {
    type: ComponentType.Button,
    style: ButtonStyle.Link,
    label: truncate(label, 80),
    url,
  };
  if (emoji) component.emoji = typeof emoji === 'string' ? { name: emoji } : emoji;
  return component;
}

function actionRow(components) {
  return {
    type: ComponentType.ActionRow,
    components: components.slice(0, 5),
  };
}

function buildContainer(config, options = {}) {
  const {
    title = config.shop?.name || 'NexaScript',
    description = '',
    kind = 'primary',
    color,
    fields = [],
    thumbnailUrl,
    buttons = [],
    footer,
  } = options;

  const accent = typeof color === 'number' ? color : colorFromKind(config, color || kind);
  const shopName = config.shop?.name || 'NexaScript';
  const logo = thumbnailUrl || config.shop?.logoUrl;
  const components = [];
  const header = `## ${title}${description ? `\n${description}` : ''}`;

  if (isProbablyUrl(logo)) {
    components.push({
      type: ComponentType.Section,
      components: [textDisplay(header)],
      accessory: {
        type: ComponentType.Thumbnail,
        media: { url: logo },
        description: shopName,
        spoiler: false,
      },
    });
  } else {
    components.push(textDisplay(header));
  }

  if (fields.length) {
    components.push(separator(true, 1));
    const body = fields
      .filter(Boolean)
      .map((field) => {
        if (typeof field === 'string') return field;
        const name = field.name ? `**${field.name}**` : '';
        const value = field.value ?? '';
        return name ? `${name}\n${value}` : String(value);
      })
      .join('\n\n');
    if (body) components.push(textDisplay(body));
  }

  const finalButtons = [...buttons];
  if (config.shop?.websiteUrl && isProbablyUrl(config.shop.websiteUrl)) {
    finalButtons.push(linkButton('Website', config.shop.websiteUrl, '🌐'));
  }
  if (config.shop?.supportUrl && isProbablyUrl(config.shop.supportUrl)) {
    finalButtons.push(linkButton('Support', config.shop.supportUrl, '💬'));
  }

  if (finalButtons.length) {
    components.push(separator(false, 1));
    components.push(actionRow(finalButtons));
  }

  const footerText = footer === undefined ? config.shop?.footer : footer;
  if (footerText) {
    components.push(separator(true, 1));
    components.push(textDisplay(`-# ${footerText}`));
  }

  return {
    type: ComponentType.Container,
    accent_color: accent,
    spoiler: false,
    components,
  };
}

function buildMessage(config, options = {}) {
  return {
    components: [buildContainer(config, options)],
    flags: flags(Boolean(options.ephemeral)),
    allowedMentions: { parse: [] },
  };
}

async function safeReply(interaction, config, options = {}) {
  const payload = buildMessage(config, options);
  try {
    if (interaction.deferred || interaction.replied) return await interaction.editReply(payload);
    return await interaction.reply(payload);
  } catch (error) {
    // Fallback texte si l’instance Discord refuse un payload Components V2.
    const text = `${options.title || config.shop?.name || 'NexaScript'}\n\n${options.description || ''}\n${(options.fields || [])
      .map((f) => (typeof f === 'string' ? f : `${f.name ? `${f.name}: ` : ''}${f.value || ''}`))
      .join('\n')}`.trim();
    const fallback = {
      content: truncate(text || 'OK', 1900),
      ephemeral: Boolean(options.ephemeral),
      allowedMentions: { parse: [] },
    };
    if (interaction.deferred || interaction.replied) return interaction.editReply(fallback);
    return interaction.reply(fallback);
  }
}

async function safeEdit(interaction, config, options = {}) {
  const payload = buildMessage(config, options);
  try {
    return await interaction.editReply(payload);
  } catch (error) {
    const text = `${options.title || config.shop?.name || 'NexaScript'}\n\n${options.description || ''}\n${(options.fields || [])
      .map((f) => (typeof f === 'string' ? f : `${f.name ? `${f.name}: ` : ''}${f.value || ''}`))
      .join('\n')}`.trim();
    return interaction.editReply({ content: truncate(text || 'OK', 1900), components: [] });
  }
}

async function sendToChannel(channel, config, options = {}) {
  if (!channel?.send) return null;
  try {
    return await channel.send(buildMessage(config, { ...options, ephemeral: false }));
  } catch (error) {
    const text = `${options.title || config.shop?.name || 'NexaScript'}\n\n${options.description || ''}`.trim();
    try {
      return await channel.send({ content: truncate(text || 'OK', 1900), allowedMentions: { parse: [] } });
    } catch {
      return null;
    }
  }
}

function keyForDisplay(config, key, forceReveal = false) {
  if (forceReveal || config.delivery?.includeLicenseKeyInLogs) return key || '—';
  return maskKey(key);
}

module.exports = {
  MessageFlagsV2,
  MessageFlagsEphemeral,
  ComponentType,
  ButtonStyle,
  flags,
  buildContainer,
  buildMessage,
  safeReply,
  safeEdit,
  sendToChannel,
  linkButton,
  actionRow,
  keyForDisplay,
  colorFromKind,
};
