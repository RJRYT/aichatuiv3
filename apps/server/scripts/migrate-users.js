import dotenv from 'dotenv';
import mongoose from 'mongoose';
import crypto from 'node:crypto';
import { User } from '../src/models/User.js';
import { Chat } from '../src/models/Chat.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(root, '.env') });
if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
await mongoose.connect(process.env.MONGODB_URI);
let migratedUsers = 0, migratedChats = 0;
for await (const user of User.find({})) {
  let changed = false;
  const linked = Array.isArray(user.linkedAccounts) ? [...user.linkedAccounts] : [];
  if (user.provider && user.providerId && !linked.some(x => x.provider === user.provider && x.providerId === user.providerId)) { linked.push({ provider: user.provider, providerId: user.providerId, providerEmail: user.emailVerified ? user.email : '', linkedAt: user.createdAt || new Date() }); user.linkedAccounts = linked; changed = true; }
  if (!user.username) {
    const base = String(user.name || 'user').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 14) || 'user';
    let candidate;
    do { candidate = `${base}_${crypto.randomBytes(4).toString('hex')}`; } while (await User.exists({ username: candidate }));
    user.username = candidate; changed = true;
  }
  if (changed) { await user.save(); migratedUsers++; }
}
for await (const chat of Chat.find({})) {
  let changed = false;
  const rawChat = await Chat.collection.findOne({ _id: chat._id }, { projection: { revision: 1, activeBranchId: 1 } });
  if (rawChat?.revision == null) { chat.revision = 0; changed = true; }
  if (!rawChat?.activeBranchId) { chat.activeBranchId = 'main'; changed = true; }
  const messages = (Array.isArray(chat.messages) ? chat.messages : []).map(message => {
    if (!message.id) { changed = true; return { ...message, id: crypto.randomUUID() }; }
    return message;
  });
  if (!Array.isArray(chat.branches) || !chat.branches.length) {
    chat.branches = [{ branchId: 'main', parentBranchId: null, forkedFromMessageId: null, messages: [], createdAt: chat.createdAt || new Date(), updatedAt: new Date() }];
    chat.activeBranchId = 'main'; changed = true;
  } else {
    chat.branches = chat.branches.map(branch => {
      const branchMessages = (Array.isArray(branch.messages) ? branch.messages : []).map(message => {
        if (!message.id) { changed = true; return { ...message, id: crypto.randomUUID() }; }
        return message;
      });
      return { ...branch, messages: branchMessages };
    });
    if (!chat.activeBranchId) { chat.activeBranchId = 'main'; changed = true; }
  }
  if (changed) { chat.messages = messages; chat.revision = Number(chat.revision || 0); await chat.save(); migratedChats++; }
}

await mongoose.disconnect();
console.log(`Migration complete. Users updated: ${migratedUsers}; chats updated: ${migratedChats}.`);
