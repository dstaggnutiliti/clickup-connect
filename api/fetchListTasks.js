// api/fetchListTasks.js - Fetch tasks from a list/view for archiving
const { applyCors } = require('./_lib/http');
const { fetchListPage, fetchViewPage } = require('./_lib/clickup');

const PAGES_PER_BATCH = 20;
const PAGE_TIMEOUT_MS = 8000;

function mapTask(task, fallbackListId) {
  return {
    taskId: task.id,
    name: task.name,
    description: task.description || '',
    status: {
      status: task.status?.status || 'Unknown',
      color: task.status?.color || null
    },
    dateCreated: task.date_created ? new Date(parseInt(task.date_created)) : null,
    dateUpdated: task.date_updated ? new Date(parseInt(task.date_updated)) : null,
    dateClosed: task.date_closed ? new Date(parseInt(task.date_closed)) : null,
    dueDate: task.due_date ? new Date(parseInt(task.due_date)) : null,
    assignees: task.assignees?.map(a => ({ id: a.id, username: a.username, email: a.email })) || [],
    tags: task.tags?.map(t => ({ name: t.name, tagFg: t.tag_fg, tagBg: t.tag_bg })) || [],
    customFields: task.custom_fields || [],
    url: task.url,
    listId: task.list?.id || fallbackListId,
    listName: task.list?.name || 'Unknown List',
    priority: task.priority,
    rawData: task
  };
}

module.exports = async (req, res) => {
  applyCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const listId = req.query.listId;
  const viewId = req.query.viewId;
  const page = parseInt(req.query.page) || 0;
  const limit = Math.min(parseInt(req.query.limit) || 100, 100);
  const closedOnly = req.query.closedOnly === 'true';

  if (!listId && !viewId) {
    return res.status(400).json({
      error: 'Missing parameter',
      message: 'listId or viewId query parameter is required'
    });
  }

  try {
    console.log(
      `Fetching tasks - listId: ${listId}, viewId: ${viewId}, page: ${page}, closedOnly: ${closedOnly}`
    );

    let allTasks = [];
    let hadFetchError = false;

    if (viewId) {
      // View is already sorted/filtered by ClickUp. Fetch a batch of pages in parallel.
      const startPage = page * PAGES_PER_BATCH;
      console.log(`Fetching view ${viewId}, pages ${startPage}-${startPage + PAGES_PER_BATCH - 1} in parallel...`);

      const results = await Promise.all(
        Array.from({ length: PAGES_PER_BATCH }, (_, i) =>
          fetchViewPage(viewId, startPage + i, { timeout: PAGE_TIMEOUT_MS })
        )
      );

      let scanned = 0;
      for (const { tasks, error } of results) {
        if (error) hadFetchError = true;
        scanned += tasks.length;
        allTasks.push(...tasks);
      }

      console.log(`View batch ${page}: fetched ${scanned} tasks total, ${allTasks.length} collected`);

    } else if (closedOnly) {
      // Scan multiple pages in parallel, filter client-side by date_closed, then sort oldest first.
      const startPage = page * PAGES_PER_BATCH;
      console.log(`Fetching pages ${startPage}-${startPage + PAGES_PER_BATCH - 1} in parallel for closed tasks...`);

      const results = await Promise.all(
        Array.from({ length: PAGES_PER_BATCH }, (_, i) =>
          fetchListPage(listId, startPage + i, { timeout: PAGE_TIMEOUT_MS, includeClosed: true })
        )
      );

      let scanned = 0;
      for (const { tasks, error } of results) {
        if (error) hadFetchError = true;
        scanned += tasks.length;
        for (const t of tasks) {
          if (t.date_closed) allTasks.push(t);
        }
      }

      console.log(`Batch ${page}: scanned ${scanned} tasks, found ${allTasks.length} closed`);

      allTasks.sort((a, b) => (parseInt(a.date_closed) || 0) - (parseInt(b.date_closed) || 0));

    } else {
      // Single page of all tasks, oldest first.
      const { tasks, error } = await fetchListPage(listId, page, {
        timeout: PAGE_TIMEOUT_MS,
        includeClosed: true
      });
      if (error) throw error;
      allTasks = tasks;
    }

    const mappedTasks = allTasks.slice(0, limit).map(t => mapTask(t, listId));

    return res.status(200).json({
      success: true,
      listId,
      page,
      taskCount: mappedTasks.length,
      totalFound: allTasks.length,
      hasMore: allTasks.length > limit || hadFetchError, // keep scanning if errors may have dropped results
      hadFetchError,
      tasks: mappedTasks
    });
  } catch (error) {
    console.error('Error in fetchListTasks:', error.message);

    if (error.code === 'NO_API_KEY') {
      return res.status(500).json({ error: error.message });
    }

    if (error.code === 'ETIMEDOUT') {
      return res.status(504).json({
        error: 'Request timeout',
        message: 'The request timed out. Try a smaller page size.'
      });
    }

    if (error.status) {
      return res.status(error.status).json({
        error: 'ClickUp API error',
        message: error.message
      });
    }

    return res.status(500).json({
      error: 'Failed to fetch tasks',
      message: error.message
    });
  }
};
