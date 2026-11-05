import mongoose from 'mongoose';

const chatSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, index: true },
  title: { type: String, default: 'New chat', maxlength: 120 },
  messages: { type: [mongoose.Schema.Types.Mixed], default: [] },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now, index: true }
}, { versionKey: false });

chatSchema.index({ sessionId: 1, updatedAt: -1 });
export const Chat = mongoose.models.Chat || mongoose.model('Chat', chatSchema);
