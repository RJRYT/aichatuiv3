import crypto from 'node:crypto';

function encryptionKey() {
  const configured = String(process.env.USER_INTEGRATIONS_ENCRYPTION_KEY || '').trim();
  if (!configured)
    throw Object.assign(
      new Error(
        'Personal Integrations are unavailable until USER_INTEGRATIONS_ENCRYPTION_KEY is configured.'
      ),
      { status: 503 }
    );
  let key;
  if (/^[a-f0-9]{64}$/i.test(configured)) key = Buffer.from(configured, 'hex');
  else key = Buffer.from(configured, 'base64');
  if (key.length !== 32)
    throw Object.assign(
      new Error('USER_INTEGRATIONS_ENCRYPTION_KEY must be a 32-byte hex or base64 value.'),
      { status: 503 }
    );
  return key;
}

export function encryptCredentials(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64'),
    updatedAt: new Date(),
  };
}

export function decryptCredentials(record) {
  if (!record?.data || !record?.iv || !record?.tag) return {};
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(record.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(record.data, 'base64')),
    decipher.final(),
  ]);
  const parsed = JSON.parse(decrypted.toString('utf8'));
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

export function decryptUserIntegrations(user) {
  const records = user?.integrations || {};
  const output = {};
  const errors = {};
  for (const provider of ['nvidia', 'tavily', 'cloudflare', 'vercel']) {
    try {
      output[provider] = decryptCredentials(records[provider]);
    } catch (error) {
      output[provider] = {};
      errors[provider] = error;
    }
  }
  output.errors = errors;
  return output;
}

export function maskSecret(value) {
  const secret = String(value || '');
  return secret
    ? `${'•'.repeat(Math.max(4, Math.min(12, secret.length - 4)))}${secret.slice(-4)}`
    : '';
}
