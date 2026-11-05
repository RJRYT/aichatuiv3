import mongoose from 'mongoose';

let databaseMode = 'memory';

export async function connectDatabase() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    if (process.env.AUTH_REQUIRED !== 'false') throw new Error('MONGODB_URI is required when authentication is enabled. Configure MongoDB before starting Agent Lab.');
    console.warn('[db] MONGODB_URI is not set. Using temporary in-memory chat storage.');
    return;
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  databaseMode = 'mongodb';
  console.log('[db] Connected to MongoDB.');
}

export function getDatabaseMode() {
  return databaseMode;
}
