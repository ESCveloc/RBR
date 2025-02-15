import session from "express-session";
import MemoryStore from "memorystore";
import type { RequestHandler } from "express";

const MemoryStoreSession = MemoryStore(session);

// Configure session middleware with secure settings
const sessionMiddleware: RequestHandler = session({
  secret: process.env.SESSION_SECRET || 'battle-royale-secret',
  name: 'battle.sid',
  resave: false,
  saveUninitialized: false,
  store: new MemoryStoreSession({
    checkPeriod: 86400000 // Prune expired entries every 24h
  }),
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
});

export default sessionMiddleware;