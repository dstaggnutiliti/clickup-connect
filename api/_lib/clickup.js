// api/_lib/clickup.js - Thin ClickUp API client built on native fetch
const { fetchJson } = require('./http');

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
  getTask,
  updateTaskStatus,
  deleteTask,
  fetchListPage,
  fetchViewPage
};
