import passport from "passport";
import { IVerifyOptions, Strategy as LocalStrategy } from "passport-local";
import { type Express } from "express";
import session from "express-session";
import createMemoryStore from "memorystore";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { users, type User } from "@db/schema";
import { db } from "@db";
import { eq } from "drizzle-orm";

const scryptAsync = promisify(scrypt);

// Extend Express User type
declare global {
  namespace Express {
    interface User extends User {}
  }
}

// Create a single shared session store instance
const MemoryStore = createMemoryStore(session);
export const sessionStore = new MemoryStore({
  checkPeriod: 86400000 // prune expired entries every 24h
});

export function setupAuth(app: Express) {
  const isProduction = app.get("env") === "production";
  const cookieSettings = {
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    secure: isProduction, // Only use secure in production
    httpOnly: true,
    sameSite: isProduction ? 'strict' : 'lax' as const,
    path: '/'
  };

  app.use(session({
    secret: process.env.REPL_ID || "battle-royale-secret",
    resave: false,
    saveUninitialized: false,
    rolling: true, // Refresh cookie on each request
    cookie: cookieSettings,
    store: sessionStore,
    name: 'battle.sid',
    unset: 'destroy'
  }));

  app.use(passport.initialize());
  app.use(passport.session());

  // Add session debug middleware in development
  if (!isProduction) {
    app.use((req, res, next) => {
      console.log('Session Debug:', {
        id: req.sessionID,
        cookie: req.session?.cookie,
        user: req.user?.id,
        isAuthenticated: req.isAuthenticated()
      });
      next();
    });
  }

  passport.use(new LocalStrategy(async (username, password, done) => {
    try {
      console.log(`Attempting login for user: ${username}`);

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.username, username))
        .limit(1);

      if (!user) {
        console.log("User not found");
        return done(null, false, { message: "Invalid username or password" });
      }

      const [hashedPassword, salt] = user.password.split(".");
      if (!hashedPassword || !salt) {
        console.error("Invalid stored password format");
        return done(null, false, { message: "Invalid username or password" });
      }

      const hashedPasswordBuf = Buffer.from(hashedPassword, "hex");
      const suppliedPasswordBuf = (await scryptAsync(password, salt, 64)) as Buffer;

      const isValid = timingSafeEqual(hashedPasswordBuf, suppliedPasswordBuf);
      console.log(`Password validation result: ${isValid}`);

      if (!isValid) {
        return done(null, false, { message: "Invalid username or password" });
      }

      return done(null, user);
    } catch (error) {
      console.error("Login error:", error);
      return done(error);
    }
  }));

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      done(null, user);
    } catch (error) {
      done(error);
    }
  });

  // Auth routes
  app.post("/api/login", (req, res, next) => {
    passport.authenticate("local", (err: Error | null, user: Express.User | false, info: IVerifyOptions) => {
      if (err) {
        console.error("Login error:", err);
        return res.status(500).json({ error: "Login failed" });
      }
      if (!user) {
        console.log("Login failed:", info.message);
        return res.status(401).json({ error: info.message || "Invalid credentials" });
      }

      req.login(user, (err) => {
        if (err) {
          console.error("Session creation error:", err);
          return res.status(500).json({ error: "Login failed" });
        }

        // Ensure cookie is set properly
        if (req.session) {
          req.session.cookie.maxAge = cookieSettings.maxAge;
          req.session.cookie.secure = cookieSettings.secure;
        }

        console.log("Login successful for user:", user.id);
        res.json({
          message: "Login successful",
          user: { id: user.id, username: user.username, role: user.role }
        });
      });
    })(req, res, next);
  });

  app.post("/api/logout", (req, res) => {
    const userId = req.user?.id;
    req.logout(() => {
      req.session?.destroy((err) => {
        if (err) {
          console.error("Logout error:", err);
          return res.status(500).json({ error: "Logout failed" });
        }
        console.log("Logout successful for user:", userId);
        res.json({ message: "Logged out successfully" });
      });
    });
  });

  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated()) {
      console.log("Unauthenticated user access attempt");
      return res.status(401).send("Not authenticated");
    }
    const user = req.user as Express.User;
    console.log("User info requested:", user.id);
    res.json({ id: user.id, username: user.username, role: user.role });
  });
}

// Helper for password hashing
const crypto = {
  hash: async (password: string): Promise<string> => {
    const salt = randomBytes(16).toString("hex");
    const buf = (await scryptAsync(password, salt, 64)) as Buffer;
    return `${buf.toString("hex")}.${salt}`;
  }
};