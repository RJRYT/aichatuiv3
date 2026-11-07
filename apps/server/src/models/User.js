import mongoose from 'mongoose';
const linkedAccountSchema = new mongoose.Schema({ provider: { type: String, enum: ['google','github','discord'], required: true }, providerId: { type: String, required: true }, providerEmail: { type: String, default: '' }, linkedAt: { type: Date, default: Date.now } }, { _id: false });
const memorySchema = new mongoose.Schema({ text: { type: String, required: true, maxlength: 2000 }, source: { type: String, default: 'user' }, createdAt: { type: Date, default: Date.now } }, { _id: true });
const userSchema = new mongoose.Schema({
  // Legacy fields are retained for backward-compatible migration.
  provider: { type: String, default: '' }, providerId: { type: String, default: '' },
  linkedAccounts: { type: [linkedAccountSchema], default: [] },
  name: { type: String, default: 'User', maxlength: 80 }, username: { type: String, trim: true, lowercase: true, minlength: 3, maxlength: 24 },
  email: { type: String, default: '', lowercase: true, trim: true }, emailVerified: { type: Boolean, default: false }, avatar: { type: String, default: '' },
  preferences: { baseStyle: { type: String, default: 'friendly' }, tone: { type: String, default: 'balanced' }, warmth: { type: Number, default: 3, min: 1, max: 5 }, enthusiasm: { type: Number, default: 3, min: 1, max: 5 }, emoji: { type: String, default: 'moderate' }, visualAnswers: { type: Boolean, default: true }, headers: { type: Boolean, default: true }, lists: { type: Boolean, default: true } },
  memories: { type: [memorySchema], default: [] }, createdAt: { type: Date, default: Date.now }, lastLoginAt: { type: Date, default: Date.now }
}, { timestamps: true });
userSchema.index({ provider: 1, providerId: 1 }, { unique: true });
userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string', $gt: '' }, emailVerified: true } });
userSchema.index({ username: 1 }, { unique: true, partialFilterExpression: { username: { $type: 'string' } }, collation: { locale: 'en', strength: 2 } });
userSchema.index({ 'linkedAccounts.provider': 1, 'linkedAccounts.providerId': 1 }, { unique: true, sparse: true });
export const User = mongoose.models.User || mongoose.model('User', userSchema);
