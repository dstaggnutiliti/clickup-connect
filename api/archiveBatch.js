// api/archiveBatch.js - Archive tasks to MongoDB, then delete from ClickUp.
// Uses a single Mongo bulkWrite plus adaptive pacing driven by ClickUp's
// X-RateLimit-* headers, so we stay just under the per-minute ceiling
// without hardcoding a fixed delay.
const { applyCors } = require('./_lib/http');
const { deleteTaskWithMeta, parseRateLimit } = require('./_lib/clickup');
const { getMongoClient, getArchiveCollection, bulkUpsertArchiveDocs } = require('./_lib/mongo');

const MAX_BATCH_SIZE = 10;
const DEFAULT_DELAY_MS = 300;       // fallback when ClickUp omits rate headers
const MAX_SINGLE_DELAY_MS = 8000;   // never sleep longer than this in one go (Vercel budget)
const RETRY_BUFFER_MS = 500;        // grace added on top of Retry-After / Reset

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Given the last-known rate-limit state, return how long to wait before
 * the next DELETE. The strategy: spread `remaining` requests evenly across
 * the remaining seconds until the window resets. If we're out of budget,
 * wait for the reset.
 */
function computeDelay(rateLimit, now = Date.now()) {
  if (!rateLimit || rateLimit.remaining == null || rateLimit.reset == null) {
    return DEFAULT_DELAY_MS;
  }
  const { remaining, reset } = rateLimit;
  const msUntilReset = Math.max(0, reset * 1000 - now);

  if (remaining <= 0) return msUntilReset + RETRY_BUFFER_MS;

  // Pace evenly. Using (remaining - 1) leaves a small safety buffer so we
  // don't send the very last token of the window and trip a 429 on race.
  const evenly = msUntilReset / Math.max(1, remaining - 1);
  return Math.min(Math.max(0, Math.ceil(evenly)), MAX_SINGLE_DELAY_MS);
}

module.exports = async (req, res) => {
  applyCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tasks, knownRateLimit } = req.body || {};

  if (!Array.isArray(tasks) || tasks.length === 0) {
    return res.status(400).json({ error: 'Missing parameter', message: 'tasks array is required' });
  }
  if (tasks.length > MAX_BATCH_SIZE) {
    return res.status(400).json({
      error: 'Batch too large',
      message: `Maximum ${MAX_BATCH_SIZE} tasks per batch to prevent timeouts`
    });
  }

  const results = tasks.map(t => ({
    taskId: t.taskId,
    name: t.name,
    savedToMongo: false,
    deletedFromClickUp: false,
    success: false,
    message: ''
  }));

  // --- Step 1: Bulk upsert to Mongo (safety net before any delete) ---
  let collection;
  try {
    const client = await getMongoClient();
    collection = getArchiveCollection(client);
    const archiveDocs = tasks.map(task => ({
      ...task,
      clickupTaskId: task.taskId,
      archivedAt: new Date(),
      _originalTaskId: task.taskId
    }));
    await bulkUpsertArchiveDocs(collection, archiveDocs);
    for (const r of results) r.savedToMongo = true;
    console.log(`Bulk-upserted ${tasks.length} tasks to MongoDB`);
  } catch (err) {
    console.error('MongoDB bulk write failed:', err.message);
    return res.status(500).json({
      error: 'MongoDB bulk write failed',
      message: err.message,
      results
    });
  }

  // --- Step 2: Delete from ClickUp with adaptive pacing ---
  // Seed with the client's previously-seen rate limit (if any) so we don't
  // burn credits right after the previous batch ended near zero.
  let rateLimit = knownRateLimit && Number.isFinite(knownRateLimit.remaining)
    ? knownRateLimit
    : null;

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const result = results[i];

    if (i > 0) {
      const delay = computeDelay(rateLimit);
      if (delay > 0) await sleep(delay);
    }

    try {
      const { rateLimit: rl } = await deleteTaskWithMeta(task.taskId, { timeout: 8000 });
      if (rl) rateLimit = rl;
      result.deletedFromClickUp = true;
      result.success = true;
      result.message = 'Archived successfully';
    } catch (err) {
      // Refresh rate-limit state from the error if we can
      const rlFromErr = err.headers ? parseRateLimit(err.headers) : null;
      if (rlFromErr) rateLimit = rlFromErr;

      // One retry on 429, honoring Retry-After when present
      if (err.status === 429) {
        const retryAfterSec = parseInt(err.headers?.get('retry-after'), 10);
        const waitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
          ? retryAfterSec * 1000 + RETRY_BUFFER_MS
          : computeDelay({ remaining: 0, reset: rateLimit?.reset ?? Math.floor(Date.now() / 1000) + 60 });
        console.log(`429 on ${task.taskId}, waiting ${waitMs}ms and retrying`);
        await sleep(Math.min(waitMs, MAX_SINGLE_DELAY_MS));
        try {
          const { rateLimit: rl2 } = await deleteTaskWithMeta(task.taskId, { timeout: 8000 });
          if (rl2) rateLimit = rl2;
          result.deletedFromClickUp = true;
          result.success = true;
          result.message = 'Archived successfully (after retry)';
          continue;
        } catch (err2) {
          result.message = `Saved to archive; delete failed after retry: ${err2.body?.err || err2.message}`;
          continue;
        }
      }

      console.error(`Delete failed for ${task.taskId}:`, err.message);
      result.message = `Saved to archive; delete failed: ${err.body?.err || err.message}`;
    }
  }

  const successful = results.filter(r => r.success).length;
  return res.status(200).json({
    success: successful === results.length,
    processed: results.length,
    successful,
    failed: results.length - successful,
    rateLimit, // let the client pipe this into the next batch
    results
  });
};
