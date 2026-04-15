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
 * Small wrapper around native fetch with:
 *  - AbortController-based timeout
 *  - JSON body handling
 *  - Normalized error: throws an Error with `.status` and `.body` on non-2xx
 */
async function fetchJson(url, { method = 'GET', headers = {}, body, timeout = 8000 } = {}) {
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
      throw err;
    }

    return data;
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

module.exports = { applyCors, fetchJson };
