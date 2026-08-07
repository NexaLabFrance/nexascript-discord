'use strict';

const { buildMessage, safeReply, safeEdit, keyForDisplay } = require('./ui');
const { t } = require('./i18n');
const {
  expiresFromDurationDays,
  formatDateTime,
  humanDuration,
  maskKey,
  parseDateLike,
  replacePlaceholders,
  truncate,
} = require('./utils');
const { isStaffMember } = require('./permissions');
const { isCustomerRoleConfigured } = require('./roleSync');

function locale(config) {
  return config.language === 'en' ? 'en-US' : 'fr-FR';
}

function apiErrorDescription(config, error) {
  return t(config.language, 'api_error', {
    status: error?.status ?? 0,
    code: error?.code || 'unknown',
    message: error?.message || 'Unknown error',
  });
}

async function ensureStaff(interaction, ctx) {
  if (isStaffMember(interaction, ctx.config)) return true;
  await safeReply(interaction, ctx.config, {
    title: t(ctx.config.language, 'no_permission_title'),
    description: t(ctx.config.language, 'no_permission_body'),
    kind: 'danger',
    ephemeral: true,
  });
  await ctx.logger.denied(interaction, interaction.commandName).catch(() => {});
  return false;
}

function getExpiryFromOptions(interaction) {
  const expiresAtInput = interaction.options.getString('expires_at');
  const durationDays = interaction.options.getInteger('duration_days');
  if (expiresAtInput !== null) return parseDateLike(expiresAtInput);
  if (durationDays !== null) return expiresFromDurationDays(durationDays);
  return undefined;
}

function getRoleDisplay(guild, config) {
  const roleId = config.customerRole?.roleId;
  if (!roleId) return '—';
  const role = guild?.roles.cache.get(roleId);
  return role ? `<@&${role.id}>` : `<@&${roleId}>`;
}

async function maybeDmLicense({ config, customer, license }) {
  if (!customer || !config.delivery?.dmCustomerOnGive) return { sent: false, skipped: true };
  try {
    await customer.send(
      buildMessage(config, {
        title: t(config.language, 'license_give_dm_title', { shop: config.shop?.name || 'NexaScript' }),
        kind: 'success',
        fields: [
          {
            value: t(config.language, 'license_give_dm_body', {
              key: license.key,
              scriptId: license.scriptId || '—',
              expiresAt: formatDateTime(license.expiresAt, locale(config)),
            }),
          },
        ],
        buttons: [],
      }),
    );
    return { sent: true };
  } catch (error) {
    return { sent: false, error };
  }
}

function licenseMutationUserId(store, key, responseLicense) {
  return responseLicense?.discordId || responseLicense?.discord_id || store.getLicense(key)?.discordId || null;
}

async function handlePing(interaction, ctx) {
  const roundtrip = Date.now() - interaction.createdTimestamp;
  await safeReply(interaction, ctx.config, {
    title: t(ctx.config.language, 'ping_title'),
    kind: 'primary',
    fields: [
      {
        value: t(ctx.config.language, 'ping_body', {
          ws: Math.round(ctx.client.ws.ping),
          roundtrip,
        }),
      },
    ],
    ephemeral: false,
  });
}

async function handleStatus(interaction, ctx) {
  if (!(await ensureStaff(interaction, ctx))) return;
  await safeReply(interaction, ctx.config, {
    title: t(ctx.config.language, 'loading_title'),
    description: t(ctx.config.language, 'loading_body'),
    kind: 'neutral',
    ephemeral: true,
  });

  try {
    const health = await ctx.api.health();
    await safeEdit(interaction, ctx.config, {
      title: t(ctx.config.language, 'status_title'),
      kind: 'success',
      fields: [
        {
          value: t(ctx.config.language, 'status_ok', {
            status: health.status || 'unknown',
            uptime: humanDuration((health.uptime || 0) * 1000, ctx.config.language),
            timestamp: health.timestamp || Date.now(),
          }),
        },
      ],
      ephemeral: true,
    });
    await ctx.logger.action({ interaction, title: t(ctx.config.language, 'status_title'), action: '/status', kind: 'success' });
  } catch (error) {
    await safeEdit(interaction, ctx.config, {
      title: t(ctx.config.language, 'status_title'),
      kind: 'danger',
      fields: [{ value: t(ctx.config.language, 'status_ko', { error: error.message || 'unknown' }) }],
      ephemeral: true,
    });
    await ctx.logger.action({ interaction, title: t(ctx.config.language, 'status_title'), action: '/status failed', kind: 'danger', fields: [{ name: 'Error', value: error.message }] });
  }
}

async function handleSync(interaction, ctx) {
  if (!(await ensureStaff(interaction, ctx))) return;
  await safeReply(interaction, ctx.config, {
    title: t(ctx.config.language, 'sync_title'),
    description: t(ctx.config.language, 'sync_started'),
    kind: 'neutral',
    ephemeral: true,
  });

  if (!isCustomerRoleConfigured(ctx.config)) {
    await safeEdit(interaction, ctx.config, {
      title: t(ctx.config.language, 'sync_title'),
      kind: 'warning',
      description: ctx.config.customerRole?.enabled ? t(ctx.config.language, 'role_not_configured') : t(ctx.config.language, 'role_sync_disabled'),
      ephemeral: true,
    });
    return;
  }

  const result = await ctx.roleSync.syncGuild(interaction.guild, { reason: `Manual sync by ${interaction.user.tag}` });
  await safeEdit(interaction, ctx.config, {
    title: t(ctx.config.language, 'sync_title'),
    kind: 'success',
    fields: [
      {
        value: t(ctx.config.language, 'sync_done', result),
      },
    ],
    ephemeral: true,
  });
  await ctx.logger.action({
    interaction,
    title: t(ctx.config.language, 'sync_title'),
    action: '/sync',
    kind: 'success',
    fields: [{ name: 'Result', value: JSON.stringify(result, null, 2) }],
  });
}

async function handleClaim(interaction, ctx) {
  if (!ctx.config.customerRole?.enabled || !ctx.config.customerRole?.claimCommandEnabled) {
    await safeReply(interaction, ctx.config, {
      title: t(ctx.config.language, 'claim_disabled_title'),
      description: t(ctx.config.language, 'claim_disabled_body'),
      kind: 'warning',
      ephemeral: true,
    });
    return;
  }

  await safeReply(interaction, ctx.config, {
    title: t(ctx.config.language, 'claim_title'),
    description: t(ctx.config.language, 'claim_checking'),
    kind: 'neutral',
    ephemeral: true,
  });

  if (!isCustomerRoleConfigured(ctx.config)) {
    await safeEdit(interaction, ctx.config, {
      title: t(ctx.config.language, 'claim_title'),
      description: t(ctx.config.language, 'role_not_configured'),
      kind: 'warning',
      ephemeral: true,
    });
    return;
  }

  const roleDisplay = getRoleDisplay(interaction.guild, ctx.config);
  const memberSync = await ctx.roleSync.syncMemberRole(interaction.guild, interaction.user.id, {
    forceApi: true,
    reason: `License claim by ${interaction.user.tag}`,
  });

  let resyncResult = null;
  if (ctx.config.sync?.afterClaim) {
    resyncResult = await ctx.roleSync.syncGuild(interaction.guild, { reason: `Post-claim sync by ${interaction.user.tag}` });
  }

  if (memberSync.shouldHaveRole) {
    const bodyKey = memberSync.added > 0 ? 'claim_success' : 'claim_already';
    await safeEdit(interaction, ctx.config, {
      title: t(ctx.config.language, 'claim_title'),
      kind: 'success',
      fields: [
        { value: t(ctx.config.language, bodyKey, { role: roleDisplay }) },
        resyncResult ? { name: 'Resync', value: t(ctx.config.language, 'sync_done', resyncResult) } : null,
      ].filter(Boolean),
      ephemeral: true,
    });
  } else {
    await safeEdit(interaction, ctx.config, {
      title: t(ctx.config.language, 'claim_title'),
      kind: 'warning',
      fields: [
        { value: t(ctx.config.language, 'claim_no_license') },
        resyncResult ? { name: 'Resync', value: t(ctx.config.language, 'sync_done', resyncResult) } : null,
      ].filter(Boolean),
      ephemeral: true,
    });
  }
}

async function handleLicenseGive(interaction, ctx) {
  const customer = interaction.options.getUser('customer');
  const scriptId = interaction.options.getString('script_id') || ctx.config.licenseDefaults?.scriptId;
  if (!scriptId) {
    await safeEdit(interaction, ctx.config, {
      title: t(ctx.config.language, 'generic_error_title'),
      description: '`script_id` est requis si licenseDefaults.scriptId est vide.',
      kind: 'danger',
      ephemeral: true,
    });
    return;
  }

  let expiresAt;
  try {
    expiresAt = getExpiryFromOptions(interaction);
  } catch (error) {
    await safeEdit(interaction, ctx.config, {
      title: t(ctx.config.language, 'generic_error_title'),
      description: t(ctx.config.language, error.message === 'invalid_duration' ? 'invalid_duration' : 'invalid_date'),
      kind: 'danger',
      ephemeral: true,
    });
    return;
  }

  const maxSlots = interaction.options.getInteger('max_slots') ?? ctx.config.licenseDefaults?.maxSlots ?? 1;
  const prefix = interaction.options.getString('prefix') || ctx.config.licenseDefaults?.prefix || undefined;
  const manualNote = interaction.options.getString('note');
  const note = manualNote || replacePlaceholders(ctx.config.licenseDefaults?.noteTemplate || '', {
    staffTag: interaction.user.tag,
    staffId: interaction.user.id,
    customerTag: customer?.tag || 'no-customer',
    customerId: customer?.id || 'none',
    scriptId,
  });

  try {
    const response = await ctx.api.createLicense({
      scriptId,
      maxSlots,
      note,
      discordId: customer?.id,
      expiresAt,
      prefix,
    });
    const license = ctx.store.upsertLicense({
      ...(response.license || {}),
      source: 'bot',
      discordId: response.license?.discordId || customer?.id || null,
    });

    let roleResult = null;
    if (customer && ctx.config.customerRole?.enabled && ctx.config.customerRole?.giveOnLicenseCreate) {
      roleResult = await ctx.roleSync.syncMemberRole(interaction.guild, customer.id, {
        forceApi: false,
        reason: `License created by ${interaction.user.tag}`,
      });
    }

    const dm = await maybeDmLicense({ config: ctx.config, customer, license });
    const staffKey = keyForDisplay(ctx.config, license.key, Boolean(ctx.config.delivery?.includeLicenseKeyInStaffReply));
    const fields = [
      {
        value: t(ctx.config.language, 'license_give_body', {
          customer: customer ? `<@${customer.id}>` : '—',
          key: staffKey,
          scriptId: license.scriptId || scriptId,
          maxSlots: license.maxSlots ?? maxSlots,
          expiresAt: formatDateTime(license.expiresAt, locale(ctx.config)),
        }),
      },
    ];
    if (roleResult) fields.push({ name: 'Role sync', value: t(ctx.config.language, 'sync_done', roleResult) });
    if (dm.error) fields.push({ name: 'DM', value: t(ctx.config.language, 'dm_failed') });

    await safeEdit(interaction, ctx.config, {
      title: t(ctx.config.language, 'license_give_title'),
      kind: 'success',
      fields,
      ephemeral: true,
    });

    await ctx.logger.action({
      interaction,
      title: t(ctx.config.language, 'license_give_title'),
      action: '/license give',
      target: customer ? `${customer.tag} (${customer.id})` : 'no customer',
      kind: 'success',
      fields: [
        { name: 'License', value: `Key: \`${ctx.logger.safeKey(license.key)}\`\nScript: \`${license.scriptId || scriptId}\`\nExpires: ${formatDateTime(license.expiresAt, locale(ctx.config))}` },
      ],
    });
  } catch (error) {
    await safeEdit(interaction, ctx.config, {
      title: t(ctx.config.language, 'generic_error_title'),
      description: apiErrorDescription(ctx.config, error),
      kind: 'danger',
      ephemeral: true,
    });
    await ctx.logger.action({ interaction, title: 'License give failed', action: '/license give', kind: 'danger', fields: [{ name: 'Error', value: apiErrorDescription(ctx.config, error) }] });
  }
}

async function handleLicenseEdit(interaction, ctx) {
  const key = interaction.options.getString('key', true).trim();
  const previous = ctx.store.getLicense(key);
  const patch = {};
  const maxSlots = interaction.options.getInteger('max_slots');
  if (maxSlots !== null) patch.maxSlots = maxSlots;

  try {
    const expiresAt = getExpiryFromOptions(interaction);
    if (expiresAt !== undefined) patch.expiresAt = expiresAt;
  } catch (error) {
    await safeEdit(interaction, ctx.config, {
      title: t(ctx.config.language, 'generic_error_title'),
      description: t(ctx.config.language, error.message === 'invalid_duration' ? 'invalid_duration' : 'invalid_date'),
      kind: 'danger',
      ephemeral: true,
    });
    return;
  }

  if (!Object.prototype.hasOwnProperty.call(patch, 'maxSlots') && !Object.prototype.hasOwnProperty.call(patch, 'expiresAt')) {
    await safeEdit(interaction, ctx.config, {
      title: t(ctx.config.language, 'generic_error_title'),
      description: t(ctx.config.language, 'no_patch_fields'),
      kind: 'danger',
      ephemeral: true,
    });
    return;
  }

  try {
    const response = await ctx.api.editLicense(key, patch);
    const license = ctx.store.upsertLicense({
      ...(previous || { key }),
      ...(response.license || {}),
      ...patch,
      key,
      source: 'bot',
    });

    const userId = licenseMutationUserId(ctx.store, key, license);
    let roleResult = null;
    if (ctx.config.sync?.afterLicenseMutation && userId) {
      roleResult = await ctx.roleSync.syncMemberRole(interaction.guild, userId, {
        forceApi: false,
        reason: `License edited by ${interaction.user.tag}`,
      });
    }

    await safeEdit(interaction, ctx.config, {
      title: t(ctx.config.language, 'license_edit_title'),
      kind: 'success',
      fields: [
        {
          value: t(ctx.config.language, 'license_edit_body', {
            key: keyForDisplay(ctx.config, key, Boolean(ctx.config.delivery?.includeLicenseKeyInStaffReply)),
            maxSlots: license.maxSlots ?? patch.maxSlots ?? '—',
            expiresAt: formatDateTime(license.expiresAt, locale(ctx.config)),
          }),
        },
        roleResult ? { name: 'Role sync', value: t(ctx.config.language, 'sync_done', roleResult) } : null,
      ].filter(Boolean),
      ephemeral: true,
    });

    await ctx.logger.action({
      interaction,
      title: t(ctx.config.language, 'license_edit_title'),
      action: '/license edit',
      kind: 'success',
      fields: [{ name: 'License', value: `Key: \`${ctx.logger.safeKey(key)}\`\nPatch: \`${JSON.stringify(patch)}\`` }],
    });
  } catch (error) {
    await safeEdit(interaction, ctx.config, {
      title: t(ctx.config.language, 'generic_error_title'),
      description: apiErrorDescription(ctx.config, error),
      kind: 'danger',
      ephemeral: true,
    });
    await ctx.logger.action({ interaction, title: 'License edit failed', action: '/license edit', kind: 'danger', fields: [{ name: 'Error', value: apiErrorDescription(ctx.config, error) }] });
  }
}

async function handleLicenseDelete(interaction, ctx) {
  const key = interaction.options.getString('key', true).trim();
  const confirm = interaction.options.getBoolean('confirm', true);
  if (!confirm) {
    await safeEdit(interaction, ctx.config, {
      title: t(ctx.config.language, 'generic_warning_title'),
      description: t(ctx.config.language, 'license_delete_confirm_missing'),
      kind: 'warning',
      ephemeral: true,
    });
    return;
  }

  const previous = ctx.store.getLicense(key);
  try {
    await ctx.api.deleteLicense(key);
    ctx.store.markDeleted(key);

    let roleResult = null;
    const userId = previous?.discordId;
    if (ctx.config.sync?.afterLicenseMutation && userId) {
      roleResult = await ctx.roleSync.syncMemberRole(interaction.guild, userId, {
        forceApi: true,
        reason: `License deleted by ${interaction.user.tag}`,
      });
    }

    await safeEdit(interaction, ctx.config, {
      title: t(ctx.config.language, 'license_delete_title'),
      kind: 'success',
      fields: [
        { value: t(ctx.config.language, 'license_delete_body', { key: keyForDisplay(ctx.config, key, Boolean(ctx.config.delivery?.includeLicenseKeyInStaffReply)) }) },
        roleResult ? { name: 'Role sync', value: t(ctx.config.language, 'sync_done', roleResult) } : null,
      ].filter(Boolean),
      ephemeral: true,
    });

    await ctx.logger.action({
      interaction,
      title: t(ctx.config.language, 'license_delete_title'),
      action: '/license delete',
      kind: 'danger',
      fields: [{ name: 'License', value: `Key: \`${ctx.logger.safeKey(key)}\`` }],
    });
  } catch (error) {
    await safeEdit(interaction, ctx.config, {
      title: t(ctx.config.language, 'generic_error_title'),
      description: apiErrorDescription(ctx.config, error),
      kind: 'danger',
      ephemeral: true,
    });
    await ctx.logger.action({ interaction, title: 'License delete failed', action: '/license delete', kind: 'danger', fields: [{ name: 'Error', value: apiErrorDescription(ctx.config, error) }] });
  }
}

async function handleLicenseSuspend(interaction, ctx) {
  const key = interaction.options.getString('key', true).trim();
  const revoked = interaction.options.getBoolean('revoked') ?? true;
  const previous = ctx.store.getLicense(key);
  try {
    const response = await ctx.api.revokeLicense(key, revoked);
    const license = ctx.store.upsertLicense({
      ...(previous || { key }),
      key,
      revoked: response.revoked ?? revoked,
      source: 'bot',
    });

    const userId = licenseMutationUserId(ctx.store, key, license);
    let roleResult = null;
    if (ctx.config.sync?.afterLicenseMutation && userId) {
      roleResult = await ctx.roleSync.syncMemberRole(interaction.guild, userId, {
        forceApi: revoked,
        reason: `License ${revoked ? 'suspended' : 'restored'} by ${interaction.user.tag}`,
      });
    }

    await safeEdit(interaction, ctx.config, {
      title: t(ctx.config.language, revoked ? 'license_suspend_title' : 'license_restore_title'),
      kind: revoked ? 'warning' : 'success',
      fields: [
        {
          value: t(ctx.config.language, 'license_suspend_body', {
            key: keyForDisplay(ctx.config, key, Boolean(ctx.config.delivery?.includeLicenseKeyInStaffReply)),
            revoked: String(response.revoked ?? revoked),
          }),
        },
        roleResult ? { name: 'Role sync', value: t(ctx.config.language, 'sync_done', roleResult) } : null,
      ].filter(Boolean),
      ephemeral: true,
    });

    await ctx.logger.action({
      interaction,
      title: t(ctx.config.language, revoked ? 'license_suspend_title' : 'license_restore_title'),
      action: '/license suspend',
      kind: revoked ? 'warning' : 'success',
      fields: [{ name: 'License', value: `Key: \`${ctx.logger.safeKey(key)}\`\nrevoked: ${String(response.revoked ?? revoked)}` }],
    });
  } catch (error) {
    await safeEdit(interaction, ctx.config, {
      title: t(ctx.config.language, 'generic_error_title'),
      description: apiErrorDescription(ctx.config, error),
      kind: 'danger',
      ephemeral: true,
    });
    await ctx.logger.action({ interaction, title: 'License suspend failed', action: '/license suspend', kind: 'danger', fields: [{ name: 'Error', value: apiErrorDescription(ctx.config, error) }] });
  }
}

async function handleLicense(interaction, ctx) {
  if (!(await ensureStaff(interaction, ctx))) return;
  await safeReply(interaction, ctx.config, {
    title: t(ctx.config.language, 'loading_title'),
    description: t(ctx.config.language, 'loading_body'),
    kind: 'neutral',
    ephemeral: true,
  });

  const subcommand = interaction.options.getSubcommand(true);
  if (subcommand === 'give') return handleLicenseGive(interaction, ctx);
  if (subcommand === 'edit') return handleLicenseEdit(interaction, ctx);
  if (subcommand === 'delete') return handleLicenseDelete(interaction, ctx);
  if (subcommand === 'suspend') return handleLicenseSuspend(interaction, ctx);

  return safeEdit(interaction, ctx.config, {
    title: t(ctx.config.language, 'generic_error_title'),
    description: `Unknown subcommand: ${subcommand}`,
    kind: 'danger',
    ephemeral: true,
  });
}

async function handleInteraction(interaction, ctx) {
  if (!interaction.isChatInputCommand()) return;
  try {
    if (interaction.commandName === 'ping') return handlePing(interaction, ctx);
    if (interaction.commandName === 'status') return handleStatus(interaction, ctx);
    if (interaction.commandName === 'sync') return handleSync(interaction, ctx);
    if (interaction.commandName === 'claim') return handleClaim(interaction, ctx);
    if (interaction.commandName === 'license') return handleLicense(interaction, ctx);
  } catch (error) {
    const title = t(ctx.config.language, 'generic_error_title');
    const description = truncate(error?.stack || error?.message || String(error), 1800);
    if (interaction.replied || interaction.deferred) {
      await safeEdit(interaction, ctx.config, { title, description, kind: 'danger', ephemeral: true }).catch(() => {});
    } else {
      await safeReply(interaction, ctx.config, { title, description, kind: 'danger', ephemeral: true }).catch(() => {});
    }
    await ctx.logger.action({ interaction, title: 'Unhandled command error', action: `/${interaction.commandName}`, kind: 'danger', fields: [{ name: 'Error', value: description }] }).catch(() => {});
  }
}

module.exports = { handleInteraction };
