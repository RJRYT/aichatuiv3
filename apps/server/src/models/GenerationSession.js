import mongoose from 'mongoose';

const generationSessionSchema = new mongoose.Schema({
  generationId: { type: String, required: true, unique: true },
  ownerId: { type: String, required: true, index: true },
  chatId: { type: String, required: true, index: true },
  status: { type: String, enum: ['running', 'completed', 'completed_with_errors', 'failed', 'interrupted', 'cancelled', 'stopped'], default: 'running', index: true },
  nextEventId: { type: Number, default: 1 },
  events: { type: [mongoose.Schema.Types.Mixed], default: [] },
  lastError: { type: String, default: '', maxlength: 2000 },
  startedAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
}, { versionKey: false });
generationSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
generationSessionSchema.index({ ownerId: 1, chatId: 1, startedAt: -1 });
export const GenerationSession = mongoose.models.GenerationSession || mongoose.model('GenerationSession', generationSessionSchema);
