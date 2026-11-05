import mongoose from 'mongoose';

const memorySchema = new mongoose.Schema({
  text: { type: String, required: true, maxlength: 2000 },
  source: { type: String, default: 'user' },
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

const userSchema = new mongoose.Schema({
  provider: { type: String, required: true },
  providerId: { type: String, required: true },
  name: { type: String, default: 'User' },
  email: { type: String, default: '' },
  avatar: { type: String, default: '' },
  preferences: {
    baseStyle: { type: String, default: 'friendly' },
    tone: { type: String, default: 'balanced' },
    warmth: { type: Number, default: 3, min: 1, max: 5 },
    enthusiasm: { type: Number, default: 3, min: 1, max: 5 },
    emoji: { type: String, default: 'moderate' },
    visualAnswers: { type: Boolean, default: true },
    headers: { type: Boolean, default: true },
    lists: { type: Boolean, default: true }
  },
  memories: { type: [memorySchema], default: [] },
  createdAt: { type: Date, default: Date.now },
  lastLoginAt: { type: Date, default: Date.now }
}, { timestamps: true });
userSchema.index({ provider: 1, providerId: 1 }, { unique: true });
export const User = mongoose.models.User || mongoose.model('User', userSchema);
