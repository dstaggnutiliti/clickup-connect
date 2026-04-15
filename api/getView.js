// api/getView.js - Fetch view details (mainly name, for UI display)
const { applyCors } = require('./_lib/http');
const { getView } = require('./_lib/clickup');

module.exports = async (req, res) => {
  applyCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { viewId } = req.query;

  if (!viewId) {
    return res.status(400).json({ error: 'View ID is required' });
  }

  try {
    const data = await getView(viewId, { timeout: 8000 });
    return res.status(200).json(data);
  } catch (error) {
    console.error('Error in getView:', error.message);

    if (error.code === 'NO_API_KEY') {
      return res.status(500).json({ error: error.message });
    }

    if (error.code === 'ETIMEDOUT') {
      return res.status(504).json({
        error: 'ClickUp API timeout',
        message: error.message
      });
    }

    if (error.status) {
      return res.status(error.status).json({
        error: 'ClickUp API error',
        message: error.message,
        details: error.body
      });
    }

    return res.status(500).json({
      error: 'Request failed',
      message: error.message
    });
  }
};
