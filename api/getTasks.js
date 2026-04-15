// api/getTasks.js - Batch-fetch task status
const { applyCors } = require('./_lib/http');
const { getTask } = require('./_lib/clickup');

const BATCH_SIZE = 2;
const INTER_BATCH_DELAY_MS = 1000;

module.exports = async (req, res) => {
  applyCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { taskIds } = req.body || {};

  if (!Array.isArray(taskIds) || taskIds.length === 0) {
    return res.status(400).json({
      error: 'Missing required parameters',
      message: 'taskIds array is required'
    });
  }

  const results = [];

  try {
    for (let i = 0; i < taskIds.length; i += BATCH_SIZE) {
      const batch = taskIds.slice(i, i + BATCH_SIZE);
      console.log(`Fetching batch ${Math.floor(i / BATCH_SIZE) + 1}, tasks: ${batch.join(', ')}`);

      const batchResults = await Promise.all(batch.map(async (taskId) => {
        try {
          const task = await getTask(taskId, { timeout: 8000 });
          return {
            taskId: task.id,
            name: task.name,
            status: {
              status: task.status?.status || 'Unknown',
              color: task.status?.color || null
            },
            url: task.url,
            list: task.list ? { id: task.list.id, name: task.list.name } : null,
            success: true
          };
        } catch (error) {
          console.error(`Error fetching task ${taskId}:`, error.message);
          return {
            taskId,
            success: false,
            message: error.code === 'ETIMEDOUT'
              ? 'Request timed out. Please try again with fewer tasks.'
              : `Failed: ${error.body?.err || error.message}`
          };
        }
      }));

      results.push(...batchResults);

      if (i + BATCH_SIZE < taskIds.length) {
        await new Promise(resolve => setTimeout(resolve, INTER_BATCH_DELAY_MS));
      }
    }

    return res.status(200).json({ results });
  } catch (error) {
    console.error('Unhandled error in getTasks:', error.message);

    if (error.code === 'NO_API_KEY') {
      return res.status(500).json({ error: error.message });
    }

    return res.status(500).json({
      error: 'Failed to process request',
      message: error.message || 'An unknown error occurred'
    });
  }
};
