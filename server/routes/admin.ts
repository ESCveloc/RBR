import { Router } from "express";
import { db } from "../db";
import { settings } from "@db/schema";
import { eq } from "drizzle-orm";
import fs from "fs/promises";
import path from "path";
import { z } from "zod";

// Validation schemas
const themeSchema = z.object({
  primary: z.string(),
  variant: z.enum(["professional", "tint", "vibrant"]),
  appearance: z.enum(["light", "dark", "system"]),
  radius: z.number().min(0).max(2),
});

const zoneConfigSchema = z.object({
  durationMinutes: z.number().min(5).max(60),
  radiusMultiplier: z.number().min(0.1).max(1),
  intervalMinutes: z.number().min(5).max(60),
});

const settingsSchema = z.object({
  defaultCenter: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  defaultRadiusMiles: z.number().min(0.1).max(10),
  zoneConfigs: z.array(zoneConfigSchema).min(1),
  theme: themeSchema,
});

const router = Router();

router.get("/settings", async (req, res) => {
  try {
    const [adminSettings] = await db.select().from(settings).limit(1);
    if (!adminSettings) {
      return res.status(404).json({ error: "Settings not found" });
    }

    // Read current theme.json
    const themeFilePath = path.join(process.cwd(), "theme.json");
    const themeData = JSON.parse(await fs.readFile(themeFilePath, 'utf8'));

    // Merge theme data with admin settings
    const fullSettings = {
      ...adminSettings,
      theme: themeData
    };

    return res.json(fullSettings);
  } catch (error) {
    console.error("Failed to fetch settings:", error);
    return res.status(500).json({ error: "Failed to fetch settings" });
  }
});

router.put("/settings", async (req, res) => {
  try {
    console.log('Received settings update:', req.body);

    // Validate the incoming data
    const validatedData = settingsSchema.parse(req.body);
    const { theme, defaultCenter, defaultRadiusMiles, zoneConfigs } = validatedData;

    // Start a transaction to ensure atomic updates
    await db.transaction(async (tx) => {
      // Update settings in database
      await tx
        .update(settings)
        .set({
          defaultCenter,
          defaultRadiusMiles,
          zoneConfigs,
          updatedAt: new Date(),
        })
        .where(eq(settings.id, 1));

      // Update theme.json
      const themeFilePath = path.join(process.cwd(), "theme.json");
      await fs.writeFile(themeFilePath, JSON.stringify(theme, null, 2));
    });

    return res.json({ 
      message: "Settings updated successfully",
      settings: {
        defaultCenter,
        defaultRadiusMiles,
        zoneConfigs,
        theme
      }
    });
  } catch (error) {
    console.error("Failed to update settings:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: "Invalid settings data", 
        details: error.errors 
      });
    }
    return res.status(500).json({ error: "Failed to update settings" });
  }
});

export default router;