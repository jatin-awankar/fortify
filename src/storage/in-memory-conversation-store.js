function buildSessionId(sessionId) {
  if (typeof sessionId === "string" && sessionId.trim()) {
    return sessionId.trim();
  }

  return "default";
}

function normalizeRole(role) {
  if (role === "assistant" || role === "system" || role === "developer") {
    return role;
  }

  return "user";
}

export class InMemoryConversationStore {
  constructor() {
    this.sessions = new Map();
  }

  getOrCreateSession(sessionId = "default") {
    const resolvedSessionId = buildSessionId(sessionId);
    const existingSession = this.sessions.get(resolvedSessionId);

    if (existingSession) {
      return existingSession;
    }

    const nextSession = {
      id: resolvedSessionId,
      createdAt: new Date().toISOString(),
      messages: []
    };

    this.sessions.set(resolvedSessionId, nextSession);
    return nextSession;
  }

  hydrateSession(session) {
    if (!session || typeof session !== "object") {
      return this.getOrCreateSession("default");
    }

    const rawMessages = Array.isArray(session.messages) ? session.messages : [];
    const maxMessages = 400;
    const maxChars = 8000;

    const messages = rawMessages.slice(-maxMessages).map((message) => ({
      role: normalizeRole(message?.role),
      content: (typeof message?.content === "string" ? message.content : String(message?.content ?? "")).slice(0, maxChars),
      createdAt: typeof message?.createdAt === "string" ? message.createdAt : new Date().toISOString()
    }));

    const normalizedSession = {
      id: buildSessionId(session.id),
      createdAt: typeof session.createdAt === "string" ? session.createdAt : new Date().toISOString(),
      messages
    };

    this.sessions.set(normalizedSession.id, normalizedSession);
    return normalizedSession;
  }

  addMessage(sessionId, { role, content } = {}) {
    const session = this.getOrCreateSession(sessionId);
    const maxChars = 8000;
    const maxMessages = 400;
    const normalizedContent = (typeof content === "string" ? content : String(content ?? "")).slice(0, maxChars);

    const message = {
      role: normalizeRole(role),
      content: normalizedContent,
      createdAt: new Date().toISOString()
    };

    session.messages.push(message);
    if (session.messages.length > maxMessages) {
      session.messages.shift();
    }

    return message;
  }

  toResponseInput(sessionId) {
    const session = this.getOrCreateSession(sessionId);
    return session.messages.map((message) => ({
      role: message.role,
      content: message.content
    }));
  }

  getSession(sessionId = "default") {
    return this.getOrCreateSession(sessionId);
  }
}
