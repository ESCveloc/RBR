import passport from "passport";
import { IVerifyOptions, Strategy as LocalStrategy } from "passport-local";
import { type Express } from "express";
import session from "express-session";
import createMemoryStore from "memorystore";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { users, type SelectUser } from "@db/schema";
import { db } from "@db";
import { eq } from "drizzle-orm";

const scryptAsync = promisify(scrypt);

// Extend Express User type
declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

// Simplified crypto implementation
const crypto = {
  hash: async (password: string): Promise<string> => {
    const salt = randomBytes(16).toString("hex");
    const buf = (await scryptAsync(password, salt, 64)) as Buffer;
    return `${buf.toString("hex")}.${salt}`;
  },
  compare: async (suppliedPassword: string, storedPassword: string): Promise<boolean> => {
    try {
      const [hash, salt] = storedPassword.split(".");
      if (!hash || !salt) return false;

      const hashBuffer = Buffer.from(hash, "hex");
      const suppliedBuffer = (await scryptAsync(suppliedPassword, salt, 64)) as Buffer;

      return timingSafeEqual(hashBuffer, suppliedBuffer);
    } catch (error) {
      console.error("Password comparison failed:", error);
      return false;
    }
  }
};

export function setupAuth(app: Express) {
  const MemoryStore = createMemoryStore(session);

  app.use(session({
    secret: process.env.REPL_ID || "battle-royale-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }, // 24 hours
    store: new MemoryStore({ checkPeriod: 86400000 })
  }));

  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(new LocalStrategy(async (username, password, done) => {
    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.username, username))
        .limit(1);

      if (!user) {
        return done(null, false, { message: "Invalid username or password" });
      }

      const isValid = await crypto.compare(password, user.password);

      if (!isValid) {
        return done(null, false, { message: "Invalid username or password" });
      }

      return done(null, user);
    } catch (error) {
      return done(error);
    }
  }));

  passport.serializeUser((user: Express.User, done) => {
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

  app.post("/api/register", async (req, res) => {
    try {
      const { username, password } = req.body;

      // Check existing user
      const [existingUser] = await db
        .select()
        .from(users)
        .where(eq(users.username, username))
        .limit(1);

      if (existingUser) {
        return res.status(400).json({ error: "Username already exists" });
      }

      // Create user
      const hashedPassword = await crypto.hash(password);
      const [user] = await db
        .insert(users)
        .values({
          username,
          password: hashedPassword,
          role: "user",
        })
        .returning();

      // Auto login
      req.login(user, (err) => {
        if (err) {
          return res.status(500).json({ error: "Login failed after registration" });
        }
        res.json({ 
          message: "Registration successful",
          user: {
            id: user.id,
            username: user.username,
            role: user.role
          }
        });
      });
    } catch (error) {
      res.status(500).json({ error: "Registration failed" });
    }
  });

  app.post("/api/login", (req, res, next) => {
    passport.authenticate("local", (err: Error | null, user: Express.User | false, info: IVerifyOptions) => {
      if (err) {
        return res.status(500).json({ error: "Login failed" });
      }
      if (!user) {
        return res.status(401).json({ error: info.message || "Invalid credentials" });
      }
      req.login(user, (err) => {
        if (err) {
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
        return res.status(500).json({ error: "Logout failed" });
      }
      res.json({ message: "Logged out successfully" });
    });
  });

  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const user = req.user as Express.User;
    res.json({
      id: user.id,
      username: user.username,
      role: user.role
    });
  });

  app.use("/api/admin/*", (req, res, next) => {
    const user = req.user as Express.User;
    if (!req.isAuthenticated() || user.role !== "admin") {
      return res.status(403).send("Forbidden");
    }
    next();
  });
}