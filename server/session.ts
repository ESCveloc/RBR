import session from "express-session";
import MemoryStore from "memorystore";
import type { RequestHandler } from "express";

const MemoryStoreSession = MemoryStore(session);

// Create a shared session store instance
export const sessionStore = new MemoryStoreSession({
  checkPeriod: 86400000 // Prune expired entries every 24h
});

// Configure session middleware with secure settings
const sessionMiddleware: RequestHandler = session({
  secret: process.env.SESSION_SECRET || 'battle-royale-secret',
  name: 'battle.sid',
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
});

export default sessionMiddleware;