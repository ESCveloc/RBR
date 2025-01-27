import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { db } from "@db";
import { setupAuth } from "./auth";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

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

(async () => {
  try {
    log("Starting server initialization...");

    // Verify database connection first
    try {
      log("Verifying database connection...");
      await db.query.users.findFirst();
      log("Database connection verified successfully");
    } catch (dbError) {
      log(`Database connection error: ${dbError}`);
      throw dbError;
    }

    // Setup authentication before routes
    try {
      log("Setting up authentication...");
      setupAuth(app);
      log("Authentication setup completed");
    } catch (authError) {
      log(`Authentication setup error: ${authError}`);
      throw authError;
    }

    // Register routes
    try {
      log("Registering routes...");
      const server = registerRoutes(app);
      log("Routes registered successfully");

      // Global error handler
      app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
        const status = err.status || err.statusCode || 500;
        const message = err.message || "Internal Server Error";
        log(`Error: ${message}`);
        res.status(status).json({ message });
      });

      if (app.get("env") === "development") {
        log("Setting up Vite development server...");
        await setupVite(app, server);
        log("Vite setup completed");
      } else {
        log("Setting up static file serving...");
        serveStatic(app);
        log("Static file serving setup completed");
      }

      const PORT = 5000;
      const HOST = "0.0.0.0";

      server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          log(`Error: Port ${PORT} is already in use`);
          process.exit(1);
        } else {
          log(`Server error: ${error.message}`);
          throw error;
        }
      });

      server.listen(PORT, HOST, () => {
        log(`Server running at http://${HOST}:${PORT}`);
      });
    } catch (routeError) {
      log(`Route setup error: ${routeError}`);
      throw routeError;
    }
  } catch (error) {
    log(`Failed to start server: ${error}`);
    process.exit(1);
  }
})();