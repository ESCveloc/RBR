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

// Add verify function for WebSocket authentication
export async function verify(sessionId: string): Promise<User | null> {
  try {
    // Parse session ID from cookie format
    const sid = sessionId.replace('s:', '').split('.')[0];

    return new Promise((resolve) => {
      sessionStore.get(sid, async (err: any, session: any) => {
        if (err || !session?.passport?.user) {
          console.log("Session verification failed:", err || "No user in session");
          resolve(null);
          return;
        }

        try {
          const [user] = await db
            .select()
            .from(users)
            .where(eq(users.id, session.passport.user))
            .limit(1);

          if (!user) {
            console.log("User not found for session");
            resolve(null);
            return;
          }

          resolve(user);
        } catch (dbError) {
          console.error("Database error during session verification:", dbError);
          resolve(null);
        }
      });
    });
  } catch (error) {
    console.error("Session verification error:", error);
    return null;
  }
}

export function setupAuth(app: Express) {
  app.use(session({
    secret: process.env.REPL_ID || "battle-royale-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { 
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      secure: false, // Allow non-HTTPS in development
      httpOnly: true,
      sameSite: 'lax'
    },
    store: sessionStore,
    name: 'battle.sid' // Custom session name
  }));

  app.use(passport.initialize());
  app.use(passport.session());

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

  app.post("/api/login", (req, res, next) => {
    passport.authenticate("local", (err: Error | null, user: Express.User | false, info: IVerifyOptions) => {
      if (err) {
        console.error("Authentication error:", err);
        return res.status(500).json({ error: "Login failed" });
      }
      if (!user) {
        return res.status(401).json({ error: info.message || "Invalid credentials" });
      }
      req.login(user, (err) => {
        if (err) {
          console.error("Login session error:", err);
          return res.status(500).json({ error: "Login failed" });
        }
        res.json({
          message: "Login successful",
          user: {
            id: user.id,
            username: user.username,
            role: user.role
          }
        });
      });
    })(req, res, next);
  });

  app.post("/api/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).send("Logout failed");
      }
      res.json({ message: "Logged out successfully" });
    });
  });

  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send("Not authenticated");
    }
    const user = req.user as Express.User;
    res.json({
      id: user.id,
      username: user.username,
      role: user.role
    });
  });
}

// Crypto implementation with proper error handling
const crypto = {
  hash: async (password: string): Promise<string> => {
    const salt = randomBytes(16).toString("hex");
    const buf = (await scryptAsync(password, salt, 64)) as Buffer;
    return `${buf.toString("hex")}.${salt}`;
  }
};