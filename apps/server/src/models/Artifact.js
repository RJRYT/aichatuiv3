import mongoose from 'mongoose';

const artifactSchema = new mongoose.Schema(
  {
    ownerId: { type: String, required: true },
    chatId: { type: String, default: '' },
    executionId: { type: String, default: '' },
    name: { type: String, required: true, maxlength: 140 },
    relativePath: { type: String, default: '' },
    mimeType: { type: String, default: 'application/octet-stream' },
    size: { type: Number, required: true, min: 1 },
    sha256: { type: String, default: '', match: /^[a-f0-9]{64}$/i },
    data: { type: Buffer, required: true, select: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

artifactSchema.index({ ownerId: 1, createdAt: -1 });
artifactSchema.index({ ownerId: 1, chatId: 1, createdAt: -1 });
artifactSchema.index(
  { ownerId: 1, chatId: 1, relativePath: 1 },
  { unique: true, partialFilterExpression: { relativePath: { $type: 'string', $gt: '' } } }
);

export const Artifact = mongoose.models.Artifact || mongoose.model('Artifact', artifactSchema);
