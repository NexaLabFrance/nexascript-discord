'use strict';

const { extractLicensesFromResponse, sleep } = require('./utils');

class NexaLabApiError extends Error {
  constructor(message, { status = 0, code = 'unknown', body = null, url = '' } = {}) {
    super(message);
    this.name = 'NexaLabApiError';
    this.status = status;
    this.code = code;
    this.body = body;
    this.url = url;
  }
}

class NexaLabApi {
  constructor(config) {
    this.config = config;
    this.baseUrl = String(config.nexalab?.baseUrl || 'https://api.nexalab.fr').replace(/\/$/, '');
    this.apiToken = config.nexalab?.apiToken || '';
    this.timeoutMs = Number(config.nexalab?.timeoutMs || 30000);
    this.authMode = String(config.nexalab?.authMode || 'reseller').toLowerCase();
    this.studioId = config.nexalab?.studioId || '';
  }

  authHeaders() {
    const headers = {};
    if (this.authMode === 'studio') {
      headers['X-Studio-Key'] = this.apiToken;
      if (this.studioId) headers['X-Studio-Id'] = this.studioId;
      return headers;
    }
    if (this.authMode === 'auto' || this.authMode === 'both') {
      headers['X-Reseller-Key'] = this.apiToken;
      headers['X-Studio-Key'] = this.apiToken;
      if (this.studioId) headers['X-Studio-Id'] = this.studioId;
      return headers;
    }
    headers['X-Reseller-Key'] = this.apiToken;
    return headers;
  }

  async request(method, route, { body, auth = true, retry = false, query } = {}) {
    const url = new URL(`${this.baseUrl}${route}`);
    if (query && typeof query === 'object') {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
      }
    }

    const headers = {
      Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) Object.assign(headers, this.authHeaders());

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response;
    let text;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      text = await response.text();
    } catch (error) {
      clearTimeout(timeout);
      if (error.name === 'AbortError') {
        throw new NexaLabApiError('Request timed out', { status: 0, code: 'timeout', url: url.toString() });
      }
      throw new NexaLabApiError(error.message || 'Network error', { status: 0, code: 'network_error', url: url.toString() });
    } finally {
      clearTimeout(timeout);
    }

    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { message: text };
      }
    }

    if (!response.ok) {
      const code = json?.error || `http_${response.status}`;
      const message = json?.message || response.statusText || 'NexaLab API error';
      if (retry && response.status >= 500) {
        await sleep(700);
        return this.request(method, route, { body, auth, retry: false, query });
      }
      throw new NexaLabApiError(message, {
        status: response.status,
        code,
        body: json,
        url: url.toString(),
      });
    }

    return json ?? {};
  }

  async health() {
    return this.request('GET', '/api/health', { auth: false, retry: true });
  }

  async createLicense(payload) {
    const body = {
      scriptId: payload.scriptId,
      maxSlots: payload.maxSlots,
      note: payload.note,
      discordId: payload.discordId || undefined,
      expiresAt: payload.expiresAt === undefined ? undefined : payload.expiresAt,
      prefix: payload.prefix || undefined,
    };
    // Pas de retry automatique sur la création: un timeout peut malgré tout avoir émis une clé.
    return this.request('POST', '/api/reseller/licenses', { body, retry: false });
  }

  async editLicense(key, patch) {
    return this.request('PATCH', `/api/reseller/licenses/${encodeURIComponent(key)}`, { body: patch, retry: true });
  }

  async revokeLicense(key, revoked = true) {
    return this.request('POST', `/api/reseller/licenses/${encodeURIComponent(key)}/revoke`, {
      body: { revoked },
      retry: true,
    });
  }

  async deleteLicense(key) {
    return this.request('DELETE', `/api/reseller/licenses/${encodeURIComponent(key)}`, { retry: true });
  }

  async listLicenses(filters = {}) {
    const json = await this.request('GET', '/api/reseller/licenses', {
      retry: true,
      query: filters,
    });
    return extractLicensesFromResponse(json);
  }

  async listLicensesForDiscord(discordId, extraFilters = {}) {
    return this.listLicenses({ ...extraFilters, discordId });
  }
}

module.exports = { NexaLabApi, NexaLabApiError };
