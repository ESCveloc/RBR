import session from "express-session";
import MemoryStore from "memorystore";
import type { RequestHandler } from "express";

const MemoryStoreSession = MemoryStore(session);

// Create a shared session store instance
export const sessionStore = new MemoryStoreSession({
  checkPeriod: 86400000, // Prune expired entries every 24h
  debug: true // Enable debug logging
});

// Configure session middleware with secure settings
const sessionMiddleware: RequestHandler = session({
  secret: process.env.SESSION_SECRET || 'battle-royale-secret',
  name: 'connect.sid', // Use standard connect.sid name for consistency
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

// Wrap the session middleware to add debug logging
const debugSessionMiddleware: RequestHandler = (req, res, next) => {
  console.log('[Session] Incoming request session cookie:', req.headers.cookie);
  sessionMiddleware(req, res, () => {
    console.log('[Session] Session after middleware:', 
      req.session ? `ID: ${req.session.id}, User: ${req.session.user?.id}` : 'No session');
    next();
  });
};

export default debugSessionMiddleware;