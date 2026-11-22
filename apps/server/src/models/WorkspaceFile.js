import mongoose from 'mongoose';

const workspaceFileSchema = new mongoose.Schema(
  {
    ownerId: { type: String, required: true, index: true },
    chatId: { type: String, required: true, index: true },
    path: { type: String, required: true, maxlength: 500 },
    content: { type: String, default: '', select: true },
    size: { type: Number, required: true, min: 0 },
    revision: { type: Number, default: 1, min: 1 },
    sha256: { type: String, required: true, match: /^[a-f0-9]{64}$/i },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

workspaceFileSchema.index({ ownerId: 1, chatId: 1, path: 1 }, { unique: true });
workspaceFileSchema.index({ ownerId: 1, chatId: 1, updatedAt: -1 });

export const WorkspaceFile =
  mongoose.models.WorkspaceFile || mongoose.model('WorkspaceFile', workspaceFileSchema);
