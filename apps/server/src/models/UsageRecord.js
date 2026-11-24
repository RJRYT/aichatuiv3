import mongoose from 'mongoose';
const usageRecordSchema = new mongoose.Schema({
  generationId: { type: String, required: true, unique: true },
  ownerId: { type: String, required: true, index: true },
  chatId: { type: String, default: '' },
  messageId: { type: String, default: '' },
  role: { type: String, enum: ['user', 'assistant'], default: 'assistant' },
  versionIndex: { type: Number, default: 0 },
  occurredAt: { type: Date, default: Date.now, index: true },
  durationMs: { type: Number, default: 0 },
  usage: { type: mongoose.Schema.Types.Mixed, default: {} },
  usageByModel: { type: mongoose.Schema.Types.Mixed, default: {} },
  modelCallsByModel: { type: mongoose.Schema.Types.Mixed, default: {} },
  model: { type: mongoose.Schema.Types.Mixed, default: {} },
  toolCalls: { type: Number, default: 0 },
}, { versionKey: false });
usageRecordSchema.index({ ownerId: 1, occurredAt: -1 });
usageRecordSchema.index({ ownerId: 1, chatId: 1, role: 1, messageId: 1, versionIndex: 1 }, { unique: true });
export const UsageRecord = mongoose.models.UsageRecord || mongoose.model('UsageRecord', usageRecordSchema);
