import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { storeConversationUploads, listConversationUploads, deleteConversationUploads } from '../src/services/interpreter/uploadStore.js';

test('conversation uploads are stored privately and can be retrieved for sandbox mounting', async () => {
  const owner = `upload-owner-${randomUUID()}`;
  const chat = `upload-chat-${randomUUID()}`;
  const content = Buffer.from('name,value\nalpha,42\n');
  const dataUrl = `data:text/csv;base64,${content.toString('base64')}`;
  const saved = await storeConversationUploads(owner, chat, [{ name: '../report.csv', mimeType: 'text/csv', dataUrl }]);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].name, 'report.csv');
  assert.equal(saved[0].sandboxPath, `uploads/${saved[0].uploadId}_report.csv`);
  const uploads = await listConversationUploads(owner, chat);
  assert.equal(uploads.length, 1);
  assert.equal(Buffer.from(uploads[0].data).toString(), content.toString());
  assert.equal((await listConversationUploads('another-owner', chat)).length, 0);
  assert.equal(await deleteConversationUploads(owner, chat), 1);
  assert.equal((await listConversationUploads(owner, chat)).length, 0);
});

test('conversation uploads reject unsupported MIME types and malformed base64', async () => {
  const owner = `upload-owner-${randomUUID()}`;
  const chat = `upload-chat-${randomUUID()}`;
  await assert.rejects(() => storeConversationUploads(owner, chat, [{ name: 'file.exe', mimeType: 'application/x-msdownload', dataUrl: 'data:application/x-msdownload;base64,YQ==' }]), /Unsupported file type/);
  await assert.rejects(() => storeConversationUploads(owner, chat, [{ name: 'file.csv', mimeType: 'text/csv', dataUrl: 'not-a-data-url' }]), /base64 data URL/);
});
