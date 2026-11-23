import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptCredentials, decryptCredentials, maskSecret } from '../src/services/integrations/crypto.js';

test('personal integration credentials are encrypted and round-trip through AES-256-GCM', () => {
  const previous = process.env.USER_INTEGRATIONS_ENCRYPTION_KEY;
  process.env.USER_INTEGRATIONS_ENCRYPTION_KEY = 'a'.repeat(64);
  try {
    const credentials = { apiKey: 'nvapi-example-secret', teamId: 'team_123' };
    const record = encryptCredentials(credentials);
    assert.equal(JSON.stringify(record).includes(credentials.apiKey), false);
    assert.deepEqual(decryptCredentials(record), credentials);
    assert.notEqual(record.iv, encryptCredentials(credentials).iv);
    assert.equal(maskSecret(credentials.apiKey).endsWith('cret'), true);
  } finally {
    if (previous === undefined) delete process.env.USER_INTEGRATIONS_ENCRYPTION_KEY;
    else process.env.USER_INTEGRATIONS_ENCRYPTION_KEY = previous;
  }
});
