import mongoose from 'mongoose';
import logger from '../utils/logger.js';

const log = logger.child({ component: 'db' });
let databaseMode = 'memory';

export async function connectDatabase() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    if (process.env.AUTH_REQUIRED !== 'false')
      throw new Error(
        'MONGODB_URI is required when authentication is enabled. Configure MongoDB before starting Agent Lab.'
      );
    log.warn('MONGODB_URI is not set. Using temporary in-memory chat storage.');
    return;
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  databaseMode = 'mongodb';
  log.info('Connected to MongoDB.');
}

export function getDatabaseMode() {
  return databaseMode;
}
