'use strict';

const { PermissionFlagsBits } = require('discord.js');

function isStaffMember(interactionOrMember, config) {
  const member = interactionOrMember.member || interactionOrMember;
  if (!member) return false;

  if (config.discord?.allowAdministrators) {
    const permissions = member.permissions;
    if (permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
    if (typeof permissions === 'string') {
      try {
        if ((BigInt(permissions) & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator) return true;
      } catch {
        // Permissions non parsables: on poursuit avec les autres contrôles.
      }
    }
  }

  const staffRoleId = config.discord?.staffRoleId;
  if (!staffRoleId) return false;

  const roles = member.roles;
  if (!roles) return false;
  if (roles.cache?.has?.(staffRoleId)) return true;
  if (Array.isArray(roles)) return roles.includes(staffRoleId);
  if (typeof roles === 'string') return roles === staffRoleId;
  return false;
}

function canManageCustomerRole(guild, config) {
  const roleId = config.customerRole?.roleId;
  if (!config.customerRole?.enabled || !roleId || !guild) return false;
  const me = guild.members.me;
  if (!me) return false;
  return me.permissions.has(PermissionFlagsBits.ManageRoles);
}

module.exports = { isStaffMember, canManageCustomerRole };
