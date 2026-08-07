#!/usr/bin/env node
'use strict';

const { loadConfig } = require('./config');
const { buildCommands, registerCommands } = require('./commands');

async function main() {
  const config = loadConfig();
  const commands = buildCommands(config);
  const result = await registerCommands({
    token: config.discord.botToken,
    clientId: config.discord.clientId,
    guildIds: config.discord.guildIds,
    commands,
  });
  console.log(`✅ ${result.count} command(s) deployed (${result.scope}${result.guilds ? `, ${result.guilds} guild(s)` : ''}).`);
}

main().catch((error) => {
  console.error('❌ Failed to deploy commands:');
  console.error(error);
  process.exit(1);
});
