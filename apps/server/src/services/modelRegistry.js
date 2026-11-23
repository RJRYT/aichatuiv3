export const MODEL_REGISTRY = Object.freeze({
  bolt: {
    alias: 'bolt', name: 'Bolt', id: 'nvidia/nemotron-3.5-bolt-e4b',
    description: 'Fast lightweight text responses and Auto routing',
    capabilities: ['text', 'fast'], tier: 'light', supportsTools: false, supportsVision: false, supportsAudio: false, temperature: 0.4, maxOutputTokens: 4096,
  },
  vision: {
    alias: 'vision', name: 'Vision', id: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
    description: 'Image and video understanding with agentic reasoning',
    capabilities: ['text', 'image', 'video', 'tools', 'reasoning'], tier: 'advanced', supportsTools: true, supportsVision: true, supportsAudio: false, temperature: 0.6, maxOutputTokens: 8192,
  },
  surge: {
    alias: 'surge', name: 'Surge', id: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    description: 'General-purpose agent workhorse and long-running tasks',
    capabilities: ['text', 'coding', 'tools', 'reasoning', 'fast'], tier: 'balanced', supportsTools: true, supportsVision: false, supportsAudio: false, temperature: 1.0, maxOutputTokens: 16384,
  },
  titan: {
    alias: 'titan', name: 'Titan', id: 'nvidia/nemotron-3-ultra-550b-a55b',
    description: 'Complex reasoning, architecture, coding and long-context analysis',
    capabilities: ['text', 'coding', 'tools', 'reasoning', 'long-context'], tier: 'frontier', supportsTools: true, supportsVision: false, supportsAudio: false, temperature: 1.0, maxOutputTokens: 16384,
  },
  omni: {
    alias: 'omni', name: 'Omni', id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
    description: 'Audio, video, image and multimodal reasoning',
    capabilities: ['text', 'image', 'video', 'audio', 'tools', 'reasoning'], tier: 'multimodal', supportsTools: true, supportsVision: true, supportsAudio: true, temperature: 0.6, maxOutputTokens: 16384,
  },
});

export const DEFAULT_MODEL_ALIAS = 'surge';
export function getModel(alias) {
  return MODEL_REGISTRY[String(alias || '').toLowerCase()] || MODEL_REGISTRY[DEFAULT_MODEL_ALIAS];
}
export function publicModelCatalog() {
  return Object.values(MODEL_REGISTRY).map(({ alias, name, id, description, capabilities, tier }) => ({ alias, name, id, description, capabilities, tier }));
}
