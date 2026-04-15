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

/**
 * Upsert many archive docs in a single round-trip. Unordered so a single
 * bad doc doesn't block the rest. `docs` must each have `clickupTaskId`.
 */
async function bulkUpsertArchiveDocs(collection, docs) {
  if (!docs.length) return { upsertedCount: 0, modifiedCount: 0, matchedCount: 0 };
  const ops = docs.map(doc => ({
    updateOne: {
      filter: { clickupTaskId: doc.clickupTaskId },
      update: { $set: doc },
      upsert: true
    }
  }));
  return collection.bulkWrite(ops, { ordered: false });
}

module.exports = { getMongoClient, getArchiveCollection, bulkUpsertArchiveDocs };
