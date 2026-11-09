function removePrivateReasoning(messages = []) {
  return (Array.isArray(messages) ? messages : []).map((message) => {
    const { reasoning, ...safe } = message || {};
    if (Array.isArray(safe.versions)) {
      safe.versions = safe.versions.map((version) => {
        const { reasoning: hiddenReasoning, ...visibleVersion } = version || {};
        return visibleVersion;
      });
    }
    return safe;
  });
}

export function sanitizeRetrievedChat(chat) {
  if (!chat) return chat;
  const safe = { ...chat, messages: removePrivateReasoning(chat.messages) };
  if (Array.isArray(chat.branches)) {
    safe.branches = chat.branches.map((branch) => ({
      ...branch,
      messages: removePrivateReasoning(branch.messages),
    }));
  }
  return safe;
}

