// api/_lib/mongo.js - Cached MongoDB client for warm Vercel Lambdas
const { MongoClient } = require('mongodb');

let cachedClient = null;
let cachedPromise = null;

async function getMongoClient() {
  if (cachedClient) return cachedClient;

  // De-duplicate concurrent connection attempts in the same cold-start window
  if (!cachedPromise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error('MONGODB_URI environment variable is not configured');
    }
    cachedPromise = new MongoClient(uri).connect().then(client => {
      cachedClient = client;
      return client;
    }).catch(err => {
      // Allow a later retry after failure
      cachedPromise = null;
      throw err;
    });
  }
  return cachedPromise;
}

function getArchiveCollection(client) {
  return client.db('nutiliti').collection('clickup_archived_tasks');
}

module.exports = { getMongoClient, getArchiveCollection };
