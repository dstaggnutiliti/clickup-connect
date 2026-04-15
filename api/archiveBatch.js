// api/archiveBatch.js - Archive tasks to MongoDB, then delete from ClickUp
const { applyCors } = require('./_lib/http');
const { deleteTask } = require('./_lib/clickup');
const { getMongoClient, getArchiveCollection } = require('./_lib/mongo');

const MAX_BATCH_SIZE = 10;
const INTER_TASK_DELAY_MS = 300;

module.exports = async (req, res) => {
  applyCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tasks } = req.body || {};

  if (!Array.isArray(tasks) || tasks.length === 0) {
    return res.status(400).json({
      error: 'Missing parameter',
      message: 'tasks array is required'
    });
  }

  if (tasks.length > MAX_BATCH_SIZE) {
    return res.status(400).json({
      error: 'Batch too large',
      message: `Maximum ${MAX_BATCH_SIZE} tasks per batch to prevent timeouts`
    });
  }

  const results = [];

  try {
    const client = await getMongoClient();
    const collection = getArchiveCollection(client);

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const result = {
        taskId: task.taskId,
        name: task.name,
        savedToMongo: false,
        deletedFromClickUp: false,
        success: false,
        message: ''
      };

      try {
        // Step 1: Save to MongoDB FIRST (safety net)
        const archiveDoc = {
          ...task,
          clickupTaskId: task.taskId, // match existing unique index
          archivedAt: new Date(),
          _originalTaskId: task.taskId
        };

        await collection.updateOne(
          { clickupTaskId: task.taskId },
          { $set: archiveDoc },
          { upsert: true }
        );

        result.savedToMongo = true;
        console.log(`Saved task ${task.taskId} to MongoDB`);

        // Step 2: Delete from ClickUp only after a successful save
        try {
          await deleteTask(task.taskId, { timeout: 8000 });
          result.deletedFromClickUp = true;
          result.success = true;
          result.message = 'Archived successfully';
          console.log(`Deleted task ${task.taskId} from ClickUp`);
        } catch (deleteError) {
          console.error(`Failed to delete task ${task.taskId}:`, deleteError.message);
          result.message =
            `Saved to archive but failed to delete from ClickUp: ` +
            `${deleteError.body?.err || deleteError.message}`;
        }
      } catch (saveError) {
        console.error(`Failed to save task ${task.taskId}:`, saveError.message);
        result.message = `Failed to save to archive: ${saveError.message}`;
      }

      results.push(result);

      if (i < tasks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, INTER_TASK_DELAY_MS));
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failedCount = results.length - successCount;

    return res.status(200).json({
      success: failedCount === 0,
      processed: results.length,
      successful: successCount,
      failed: failedCount,
      results
    });
  } catch (error) {
    console.error('Error in archiveBatch:', error.message);
    return res.status(500).json({
      error: 'Archive process failed',
      message: error.message,
      results
    });
  }
};
