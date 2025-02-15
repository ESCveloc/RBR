import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { db } from "@db";
import { setupAuth } from "./auth";
import sessionMiddleware from "./session";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Add session middleware before any routes
app.use(sessionMiddleware);

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

let server: any = null;

async function startServer() {
  try {
    log("Starting server initialization...");

    // Verify database connection first
    log("Verifying database connection...");
    try {
      await db.query.users.findFirst();
      log("Database connection successful");
    } catch (error) {
      log("Database connection failed, retrying in 5 seconds...");
      await new Promise(resolve => setTimeout(resolve, 5000));
      throw error; // Re-throw to trigger retry
    }

    // Setup authentication after database is confirmed working
    log("Setting up authentication...");
    setupAuth(app);

    // Register routes
    log("Registering routes...");
    server = registerRoutes(app);

    // Global error handler
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      log(`Error: ${status} - ${message}`);
      res.status(status).json({ message });
    });

    // Setup Vite or static serving
    if (app.get("env") === "development") {
      log("Setting up Vite development server...");
      await setupVite(app, server);
    } else {
      log("Setting up static file serving...");
      serveStatic(app);
    }

    // Start listening
    const PORT = 5000;
    server.listen(PORT, "0.0.0.0", () => {
      log(`Server successfully started and listening on port ${PORT}`);
    });

    // Handle graceful shutdown
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (error) {
    log(`Server initialization failed: ${error}`);
    // Wait 5 seconds and try again
    await new Promise(resolve => setTimeout(resolve, 5000));
    return startServer();
  }
}

// Graceful shutdown handler
async function shutdown() {
  log("Shutting down server...");
  if (server) {
    server.close(() => {
      log("Server closed");
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

// Start the server with retries
startServer().catch((error) => {
  log(`Fatal error, could not start server: ${error}`);
  process.exit(1);
});