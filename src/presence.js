'use strict';

const { ActivityType } = require('discord.js');
const { replacePlaceholders } = require('./utils');

const activityTypeMap = {
  Playing: ActivityType.Playing,
  Streaming: ActivityType.Streaming,
  Listening: ActivityType.Listening,
  Watching: ActivityType.Watching,
  Competing: ActivityType.Competing,
};

class PresenceRotator {
  constructor(client, config) {
    this.client = client;
    this.config = config;
    this.index = 0;
    this.interval = null;
  }

  placeholders() {
    const guilds = this.client.guilds.cache.size;
    const users = this.client.guilds.cache.reduce((total, guild) => total + (guild.memberCount || 0), 0);
    return {
      version: this.config.version,
      guilds,
      users,
      shop: this.config.shop?.name || 'NexaScript',
    };
  }

  applyNext() {
    if (!this.config.presence?.enabled) return;
    const activities = this.config.presence.activities?.length
      ? this.config.presence.activities
      : [
          { type: 'Watching', text: 'NexaScript v{version}' },
          { type: 'Playing', text: 'Powered by NexaLab' },
        ];
    const activity = activities[this.index % activities.length];
    this.index += 1;

    const type = activityTypeMap[activity.type] ?? ActivityType.Playing;
    const name = replacePlaceholders(activity.text || 'NexaScript v{version}', this.placeholders());
    this.client.user.setPresence({
      status: this.config.discord?.status || 'online',
      activities: [{ name, type, url: activity.url }].filter(Boolean),
    });
  }

  start() {
    if (!this.config.presence?.enabled || !this.client.user) return;
    this.stop();
    this.applyNext();
    const seconds = Math.max(15, Number(this.config.presence.intervalSeconds || 30));
    this.interval = setInterval(() => this.applyNext(), seconds * 1000);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }
}

module.exports = { PresenceRotator };
