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
      const [hashedPassword, salt] = storedPassword.split(".");
      console.log('Password comparison:', {
        suppliedPassword,
        hashedPassword,
        salt
      });

      if (!hashedPassword || !salt) {
        console.error('Invalid stored password format');
        return false;
      }

      const hashedPasswordBuf = Buffer.from(hashedPassword, "hex");
      const suppliedPasswordBuf = (await scryptAsync(
        suppliedPassword,
        salt,
        64
      )) as Buffer;

      console.log('Password buffers:', {
        hashedPasswordLength: hashedPasswordBuf.length,
        suppliedPasswordLength: suppliedPasswordBuf.length,
      });

      return timingSafeEqual(hashedPasswordBuf, suppliedPasswordBuf);
    } catch (error) {
      console.error('Password comparison error:', error);
      return false;
    }
  },
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
      console.log(`Login attempt for username: ${username}`);

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.username, username))
        .limit(1);

      if (!user) {
        console.log('User not found:', username);
        return done(null, false, { message: "Invalid username or password" });
      }

      console.log('Found user:', { id: user.id, username: user.username });
      console.log('Stored password hash:', user.password);

      const isMatch = await crypto.compare(password, user.password);
      console.log('Password match result:', isMatch);

      if (!isMatch) {
        return done(null, false, { message: "Invalid username or password" });
      }

      return done(null, user);
    } catch (err) {
      console.error('Login error:', err);
      return done(err);
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
    } catch (err) {
      done(err);
    }
  });

  // Authentication routes
  app.post("/api/register", async (req, res, next) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).send("Username and password are required");
      }

      // Check if user already exists
      const [existingUser] = await db
        .select()
        .from(users)
        .where(eq(users.username, username))
        .limit(1);

      if (existingUser) {
        return res.status(400).send("Username already exists");
      }

      // Hash the password
      const hashedPassword = await crypto.hash(password);

      // Create the new user
      const [newUser] = await db
        .insert(users)
        .values({
          username,
          password: hashedPassword,
          role: "user",
        })
        .returning();

      // Log the user in after registration
      req.login(newUser, (err) => {
        if (err) {
          return next(err);
        }
        return res.json({
          message: "Registration successful",
          user: { id: newUser.id, username: newUser.username, role: newUser.role },
        });
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/login", (req, res, next) => {
    passport.authenticate("local", (err: any, user: Express.User | false, info: IVerifyOptions) => {
      if (err) {
        console.error('Login error:', err);
        return res.status(500).json({ error: "Login failed" });
      }

      if (!user) {
        return res.status(401).json({ error: info.message || "Invalid credentials" });
      }

      req.logIn(user, (err) => {
        if (err) {
          return next(err);
        }

        return res.json({
          message: "Login successful",
          user: {
            id: user.id,
            username: user.username,
            role: user.role,
          },
        });
      });
    })(req, res, next);
  });

  app.post("/api/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).send("Logout failed");
      }

      res.json({ message: "Logout successful" });
    });
  });

  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send("Not logged in");
    }
    const { id, username, role } = req.user;
    return res.json({ id, username, role });
  });

  // Middleware to check admin role
  app.use("/api/admin/*", (req, res, next) => {
    if (!req.isAuthenticated() || req.user.role !== "admin") {
      return res.status(403).send("Forbidden");
    }
    next();
  });
}