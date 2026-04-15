// api/processTask.js - Update status for a single task
const { applyCors } = require('./_lib/http');
const { updateTaskStatus } = require('./_lib/clickup');

module.exports = async (req, res) => {
  applyCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { taskId, status } = req.body || {};

  if (!taskId || !status) {
    return res.status(400).json({
      error: 'Missing required parameters',
      message: 'taskId and status are required'
    });
  }

  try {
    await updateTaskStatus(taskId, status, { timeout: 5000 });
    return res.status(200).json({
      taskId,
      success: true,
      message: 'Status updated successfully'
    });
  } catch (error) {
    console.error(`Error updating task ${taskId}:`, error.message);

    if (error.code === 'NO_API_KEY') {
      return res.status(500).json({ error: error.message });
    }

    // Preserve original behavior: return 200 with success:false so the
    // frontend's per-task loop can display the error without throwing.
    return res.status(200).json({
      taskId,
      success: false,
      message: `Failed: ${error.body?.err || error.message}`
    });
  }
};
