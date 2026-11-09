import mongoose from 'mongoose';

const conversationUploadSchema = new mongoose.Schema(
  {
    ownerId: { type: String, required: true },
    chatId: { type: String, required: true },
    uploadId: { type: String, required: true },
    name: { type: String, required: true, maxlength: 140 },
    mimeType: { type: String, required: true, maxlength: 120 },
    sandboxPath: { type: String, required: true, maxlength: 240 },
    size: { type: Number, required: true, min: 1 },
    sha256: { type: String, default: '', maxlength: 64 },
    data: { type: Buffer, required: true, select: false },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

conversationUploadSchema.index({ ownerId: 1, chatId: 1, uploadId: 1 }, { unique: true });
conversationUploadSchema.index({ ownerId: 1, chatId: 1, createdAt: 1 });

export const ConversationUpload =
  mongoose.models.ConversationUpload ||
  mongoose.model('ConversationUpload', conversationUploadSchema);
