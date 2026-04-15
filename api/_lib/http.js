// api/_lib/http.js - Shared HTTP helpers (CORS, fetch with timeout)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

function applyCors(res) {
  for (const [key, value] of Object.entries(corsHeaders)) {
    res.setHeader(key, value);
  }
}

/**
 * Low-level fetch wrapper that returns { data, headers, status }.
 * Throws a normalized Error on non-2xx — error carries `.status`, `.body`,
 * and `.headers` so callers can read things like `Retry-After`.
 */
async function fetchJsonFull(url, { method = 'GET', headers = {}, body, timeout = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });

    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!res.ok) {
      const err = new Error(data?.err || data?.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.body = data;
      err.headers = res.headers;
      throw err;
    }

    return { data, headers: res.headers, status: res.status };
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error(`Request timed out after ${timeout}ms`);
      timeoutErr.code = 'ETIMEDOUT';
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Convenience wrapper returning just the parsed JSON body.
 * Use fetchJsonFull when you need response headers (e.g. rate-limit info).
 */
async function fetchJson(url, opts) {
  const { data } = await fetchJsonFull(url, opts);
  return data;
}

module.exports = { applyCors, fetchJson, fetchJsonFull };
