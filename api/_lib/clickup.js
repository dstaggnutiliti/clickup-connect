// api/_lib/clickup.js - Thin ClickUp API client built on native fetch
const { fetchJson, fetchJsonFull } = require('./http');

const BASE_URL = 'https://api.clickup.com/api/v2';

function getApiKey() {
  const key = process.env.CLICKUP_API_KEY;
  if (!key) {
    const err = new Error('CLICKUP_API_KEY environment variable is not configured');
    err.code = 'NO_API_KEY';
    throw err;
  }
  return key;
}

function authHeaders() {
  return { Authorization: getApiKey() };
}

async function getList(listId, { timeout = 5000 } = {}) {
  return fetchJson(`${BASE_URL}/list/${listId}`, {
    headers: authHeaders(),
    timeout
  });
}

async function getView(viewId, { timeout = 5000 } = {}) {
  return fetchJson(`${BASE_URL}/view/${viewId}`, {
    headers: authHeaders(),
    timeout
  });
}

async function getTask(taskId, { timeout = 8000 } = {}) {
  return fetchJson(`${BASE_URL}/task/${taskId}`, {
    headers: authHeaders(),
    timeout
  });
}

async function updateTaskStatus(taskId, status, { timeout = 5000 } = {}) {
  return fetchJson(`${BASE_URL}/task/${taskId}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: { status },
    timeout
  });
}

async function deleteTask(taskId, { timeout = 8000 } = {}) {
  return fetchJson(`${BASE_URL}/task/${taskId}`, {
    method: 'DELETE',
    headers: authHeaders(),
    timeout
  });
}

/**
 * DELETE a task and also return the rate-limit state reported by ClickUp.
 * Returns { data, rateLimit } where rateLimit = { limit, remaining, reset }
 * or null if headers were absent.
 */
async function deleteTaskWithMeta(taskId, { timeout = 8000 } = {}) {
  const { data, headers } = await fetchJsonFull(`${BASE_URL}/task/${taskId}`, {
    method: 'DELETE',
    headers: authHeaders(),
    timeout
  });
  return { data, rateLimit: parseRateLimit(headers) };
}

/**
 * Read ClickUp's rate-limit headers. `reset` is a Unix timestamp in seconds.
 * Returns null when the server didn't include any of the expected headers.
 */
function parseRateLimit(headers) {
  if (!headers || typeof headers.get !== 'function') return null;
  const toInt = (v) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  };
  const remaining = toInt(headers.get('x-ratelimit-remaining'));
  const reset = toInt(headers.get('x-ratelimit-reset'));
  const limit = toInt(headers.get('x-ratelimit-limit'));
  if (remaining == null && reset == null && limit == null) return null;
  return { remaining, reset, limit };
}

/**
 * Fetch a single page of tasks from a list.
 * Returns { tasks, error } — NEVER throws. A transient error returns
 * { tasks: [], error } so callers can distinguish end-of-list (no error)
 * from a fetch failure.
 */
async function fetchListPage(listId, page, { timeout = 8000, includeClosed = true } = {}) {
  const params = new URLSearchParams({
    page: String(page),
    subtasks: 'false',
    include_closed: String(includeClosed)
  });
  try {
    const data = await fetchJson(`${BASE_URL}/list/${listId}/task?${params}`, {
      headers: authHeaders(),
      timeout
    });
    return { tasks: data.tasks || [], error: null };
  } catch (err) {
    return { tasks: [], error: err };
  }
}

/**
 * Fetch a single page of tasks from a view.
 * Same error semantics as fetchListPage.
 */
async function fetchViewPage(viewId, page, { timeout = 8000 } = {}) {
  const params = new URLSearchParams({ page: String(page) });
  try {
    const data = await fetchJson(`${BASE_URL}/view/${viewId}/task?${params}`, {
      headers: authHeaders(),
      timeout
    });
    return { tasks: data.tasks || [], error: null };
  } catch (err) {
    return { tasks: [], error: err };
  }
}

module.exports = {
  getApiKey,
  getList,
  getView,
  getTask,
  updateTaskStatus,
  deleteTask,
  deleteTaskWithMeta,
  parseRateLimit,
  fetchListPage,
  fetchViewPage
};
