'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (fallback !== null) return fallback;
    throw error;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function getPackageVersion() {
  const pkg = readJson(path.join(__dirname, '..', 'package.json'), { version: '0.0.0' });
  return pkg.version || '0.0.0';
}

function hexToInt(hex, fallback = 0x5865F2) {
  if (typeof hex === 'number' && Number.isInteger(hex) && hex >= 0 && hex <= 0xFFFFFF) return hex;
  if (typeof hex !== 'string') return fallback;
  const clean = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return fallback;
  return parseInt(clean, 16);
}

function intToHex(int) {
  const n = Number.isInteger(int) && int >= 0 && int <= 0xFFFFFF ? int : 0;
  return `#${n.toString(16).toUpperCase().padStart(6, '0')}`;
}

function colorsToInts(colors, fallback = ['#5865F2']) {
  const list = Array.isArray(colors) && colors.length ? colors : fallback;
  return list.slice(0, 2).map((color) => hexToInt(color));
}

function maskKey(key) {
  if (!key) return '—';
  const value = String(key);
  if (value.length <= 8) return `${value.slice(0, 2)}…${value.slice(-2)}`;
  const parts = value.split('-');
  if (parts.length >= 4) return `${parts[0]}-${parts[1]}-…-${parts.at(-1)}`;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function escapeMarkdown(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/([*_`~|>])/g, '\\$1');
}

function truncate(value, max = 1024) {
  const text = String(value ?? '');
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function replacePlaceholders(text, placeholders = {}) {
  return String(text ?? '').replace(/\{([a-zA-Z0-9_.-]+)\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(placeholders, key)) return String(placeholders[key]);
    return match;
  });
}

function parseDateLike(input) {
  if (input === null || input === undefined || input === '') return undefined;
  const text = String(input).trim();
  if (!text) return undefined;
  if (/^(null|none|never|lifetime|permanent|permanent(e)?|à vie|a vie)$/i.test(text)) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw new Error('invalid_date');
  }
  return date.toISOString();
}

function expiresFromDurationDays(days) {
  if (days === null || days === undefined) return undefined;
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) throw new Error('invalid_duration');
  return new Date(Date.now() + Math.round(n * 24 * 60 * 60 * 1000)).toISOString();
}

function isExpired(expiresAt, now = Date.now()) {
  if (!expiresAt) return false;
  const time = new Date(expiresAt).getTime();
  if (Number.isNaN(time)) return false;
  return time <= now;
}

function isLicenseActive(license, now = Date.now()) {
  if (!license || license.deleted) return false;
  if (license.revoked === true) return false;
  return !isExpired(license.expiresAt, now);
}

function formatDateTime(value, locale = 'fr-FR') {
  if (!value) return locale.startsWith('fr') ? 'Jamais' : 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Paris',
  }).format(date);
}

function humanDuration(ms, lang = 'fr') {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (lang === 'en') {
    if (days) return `${days}d ${hours}h`;
    if (hours) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }
  if (days) return `${days} j ${hours} h`;
  if (hours) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}

function normalizeDiscordId(value) {
  if (!value) return null;
  const match = String(value).match(/\d{15,25}/);
  return match ? match[0] : null;
}

function normalizeLicense(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const key = raw.key || raw.licenseKey || raw.license_key || raw.id;
  if (!key) return null;
  return {
    key: String(key).trim(),
    scriptId: raw.scriptId ?? raw.script_id ?? raw.script ?? null,
    maxSlots: raw.maxSlots ?? raw.max_slots ?? raw.slots ?? 1,
    note: raw.note ?? '',
    discordId: normalizeDiscordId(raw.discordId ?? raw.discord_id ?? raw.customerDiscordId ?? raw.userId),
    expiresAt: raw.expiresAt === undefined ? (raw.expires_at ?? null) : raw.expiresAt,
    revoked: Boolean(raw.revoked ?? raw.suspended ?? false),
    deleted: Boolean(raw.deleted ?? false),
    createdAt: raw.createdAt ?? raw.created_at ?? null,
    updatedAt: raw.updatedAt ?? raw.updated_at ?? null,
    lastSeenAt: new Date().toISOString(),
    source: raw.source || 'api',
  };
}

function extractLicensesFromResponse(json) {
  if (!json) return [];
  if (Array.isArray(json)) return json.map(normalizeLicense).filter(Boolean);
  const candidates = [json.licenses, json.data, json.items, json.results, json.rows];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.map(normalizeLicense).filter(Boolean);
  }
  if (json.license) {
    const normalized = normalizeLicense(json.license);
    return normalized ? [normalized] : [];
  }
  return [];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  readJson,
  writeJsonAtomic,
  deepMerge,
  getPackageVersion,
  hexToInt,
  intToHex,
  colorsToInts,
  maskKey,
  escapeMarkdown,
  truncate,
  replacePlaceholders,
  parseDateLike,
  expiresFromDurationDays,
  isExpired,
  isLicenseActive,
  formatDateTime,
  humanDuration,
  normalizeDiscordId,
  normalizeLicense,
  extractLicensesFromResponse,
  sleep,
};
