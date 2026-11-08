import crypto from 'node:crypto';
import logger from '../utils/logger.js';

const log = logger.child({ component: 'conversationBranches' });
const id = () => crypto.randomUUID();

export function ensureBranches(chat) {
  if (!Array.isArray(chat.branches) || !chat.branches.length) {
    chat.branches = [{ branchId: 'main', parentBranchId: null, forkedFromMessageId: null, messages: Array.isArray(chat.messages) ? chat.messages : [], createdAt: chat.createdAt || new Date(), updatedAt: new Date() }];
    chat.activeBranchId = 'main';
  }
  return chat;
}

export function getBranchMessages(chat, branchId = chat.activeBranchId || 'main') {
  ensureBranches(chat);
  const branch = chat.branches.find(item => item.branchId === branchId);
  if (!branch) return null;
  if (branch.branchId === 'main' && Array.isArray(chat.messages)) return [...chat.messages];
  if (!branch.parentBranchId) return [...(branch.messages || [])];
  const parentMessages = getBranchMessages(chat, branch.parentBranchId);
  if (!parentMessages) return null;
  const forkIndex = parentMessages.findIndex(message => message.id === branch.forkedFromMessageId);
  return [...parentMessages.slice(0, forkIndex < 0 ? parentMessages.length : forkIndex + 1), ...(branch.messages || [])];
}

export function createBranch(chat, { fromBranchId, forkedFromMessageId, messages = [] }) {
  ensureBranches(chat);
  if (chat.branches.length >= 100) {
    log.warn('Branch limit reached', { branchCount: chat.branches.length });
    throw Object.assign(new Error('This conversation has reached the 100-branch limit.'), { status: 429 });
  }
  let depth = 0, cursor = chat.branches.find(item => item.branchId === fromBranchId);
  while (cursor?.parentBranchId) { depth++; cursor = chat.branches.find(item => item.branchId === cursor.parentBranchId); }
  if (depth >= 20) {
    log.warn('Branch nesting limit reached', { depth });
    throw Object.assign(new Error('Branch nesting limit reached.'), { status: 429 });
  }
  const source = getBranchMessages(chat, fromBranchId);
  if (!source) {
    log.warn('Source branch not found', { fromBranchId });
    throw Object.assign(new Error('Source branch not found.'), { status: 404 });
  }
  const index = forkedFromMessageId ? source.findIndex(message => message.id === forkedFromMessageId) : -1;
  if (forkedFromMessageId && index < 0) {
    log.warn('Fork message not found', { forkedFromMessageId });
    throw Object.assign(new Error('Fork message not found.'), { status: 404 });
  }
  const branch = { branchId: id(), parentBranchId: forkedFromMessageId ? fromBranchId : null, forkedFromMessageId: forkedFromMessageId || null, messages, createdAt: new Date(), updatedAt: new Date() };
  chat.branches.push(branch); chat.activeBranchId = branch.branchId;
  log.info('Branch created', { branchId: branch.branchId, parentBranchId: branch.parentBranchId, forkedFromMessageId: branch.forkedFromMessageId });
  return { branch, messages: forkedFromMessageId ? [...source.slice(0, index + 1), ...messages] : [...messages] };
}

export function setBranchMessages(chat, branchId, messages) {
  ensureBranches(chat);
  const branch = chat.branches.find(item => item.branchId === branchId);
  if (!branch) return false;
  if (branch.parentBranchId) {
    const prefix = getBranchMessages(chat, branch.parentBranchId);
    const forkIndex = prefix.findIndex(message => message.id === branch.forkedFromMessageId);
    branch.messages = messages.slice(forkIndex + 1);
  } else {
    if (branch.branchId === 'main') { chat.messages = messages; branch.messages = []; }
    else branch.messages = messages;
  }
  branch.updatedAt = new Date();
  return true;
}
