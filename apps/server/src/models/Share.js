import mongoose from 'mongoose';
const shareSchema = new mongoose.Schema({
  shareId: { type: String, required: true, unique: true, index: true },
  ownerId: { type: String, required: true, index: true },
  chatId: { type: String, required: true },
  title: { type: String, default: 'Shared response', maxlength: 120 },
  messages: { type: [mongoose.Schema.Types.Mixed], default: [] },
  revokedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
}, { versionKey: false });
export const Share = mongoose.models.Share || mongoose.model('Share', shareSchema);
