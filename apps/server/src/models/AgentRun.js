import mongoose from 'mongoose';

const agentRunSchema = new mongoose.Schema(
  {
    runId: { type: String, required: true, unique: true },
    ownerId: { type: String, required: true, index: true },
    chatId: { type: String, required: true, index: true },
    status: { type: String, enum: ['running', 'completed', 'interrupted', 'failed'], default: 'running', index: true },
    round: { type: Number, default: 0 },
    executionToolCalls: { type: Number, default: 0 },
    plan: { type: mongoose.Schema.Types.Mixed, default: null },
    completedOperations: { type: [mongoose.Schema.Types.Mixed], default: [] },
    lastError: { type: String, default: '', maxlength: 2000 },
    startedAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
  },
  { versionKey: false }
);

agentRunSchema.index({ ownerId: 1, chatId: 1, startedAt: -1 });

export const AgentRun = mongoose.models.AgentRun || mongoose.model('AgentRun', agentRunSchema);
