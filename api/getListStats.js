// api/getListStats.js - Get list statistics (ClickUp task count + archived count)
const { applyCors } = require('./_lib/http');
const { getList, fetchListPage } = require('./_lib/clickup');
const { getMongoClient, getArchiveCollection } = require('./_lib/mongo');

const PAGE_SIZE = 100;
const PARALLEL_PAGES = 10;
const MAX_DURATION_MS = 8000; // Leave ~2s headroom under Vercel's 10s limit

module.exports = async (req, res) => {
  applyCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const defaultListId = process.env.CLICKUP_LIST_ID;
  const listId = req.query.listId || defaultListId;

  if (!listId) {
    return res.status(400).json({
      error: 'Missing parameter',
      message: 'List ID is required (provide listId query param or set CLICKUP_LIST_ID env var)'
    });
  }

  const startedAt = Date.now();

  try {
    // Fire the MongoDB archive count in parallel with the ClickUp work.
    // It almost always returns first; no reason to serialize.
    const archivedCountPromise = (async () => {
      try {
        const client = await getMongoClient();
        return await getArchiveCollection(client).countDocuments({ listId });
      } catch (mongoError) {
        console.error('MongoDB error:', mongoError.message);
        return 0;
      }
    })();

    // 1. List metadata
    const listData = await getList(listId, { timeout: 5000 });
    const listName = listData.name || 'Unknown List';

    // 2. Count tasks in parallel batches until we hit a short/empty page
    //    or run out of budget. Distinguish transient errors from end-of-list.
    let taskCount = 0;
    let pageGroup = 0;
    let hasMore = true;
    let isPartialCount = false;
    let hadFetchError = false;

    while (hasMore) {
      if (Date.now() - startedAt > MAX_DURATION_MS) {
        console.log('Time limit reached, returning partial count');
        isPartialCount = true;
        break;
      }

      const pages = Array.from({ length: PARALLEL_PAGES }, (_, i) => pageGroup * PARALLEL_PAGES + i);
      const results = await Promise.all(
        pages.map(page => fetchListPage(listId, page, { timeout: 5000 }))
      );

      let groupCount = 0;
      let reachedEnd = false;
      for (const { tasks, error } of results) {
        if (error) {
          hadFetchError = true;
          console.error(`Page fetch error:`, error.message);
          continue;
        }
        groupCount += tasks.length;
        // ClickUp returns exactly PAGE_SIZE until the last page.
        // A short page ONLY signals end-of-list when the fetch itself succeeded.
        if (tasks.length < PAGE_SIZE) reachedEnd = true;
      }

      taskCount += groupCount;
      console.log(
        `Pages ${pageGroup * PARALLEL_PAGES + 1}-${(pageGroup + 1) * PARALLEL_PAGES}: ` +
        `found ${groupCount} tasks (total: ${taskCount})`
      );

      if (reachedEnd || groupCount === 0) {
        hasMore = false;
      } else {
        pageGroup++;
      }
    }

    // If any page errored, the count is known to be under-reported.
    if (hadFetchError) isPartialCount = true;

    const archivedCount = await archivedCountPromise;

    console.log(
      `Final count: ${taskCount} tasks in ClickUp, ${archivedCount} archived, partial: ${isPartialCount}`
    );

    return res.status(200).json({
      success: true,
      listId,
      listName,
      taskCount,
      isPartialCount,
      archivedCount,
      defaultListId: defaultListId || null
    });
  } catch (error) {
    console.error('Error in getListStats:', error.message);

    if (error.code === 'NO_API_KEY') {
      return res.status(500).json({ error: error.message });
    }

    if (error.status) {
      return res.status(error.status).json({
        error: 'ClickUp API error',
        message: error.message
      });
    }

    return res.status(500).json({
      error: 'Failed to fetch stats',
      message: error.message
    });
  }
};
