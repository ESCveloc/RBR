import { Router } from "express";
import { db } from "../db";
import { settings } from "@db/schema";
import { eq } from "drizzle-orm";
import fs from "fs/promises";
import path from "path";

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
    const { theme, ...otherSettings } = req.body;

    // Update settings in database
    await db
      .update(settings)
      .set(otherSettings)
      .where(eq(settings.id, 1));

    // Update theme.json
    const themeFilePath = path.join(process.cwd(), "theme.json");
    await fs.writeFile(themeFilePath, JSON.stringify(theme, null, 2));

    return res.json({ message: "Settings updated successfully" });
  } catch (error) {
    console.error("Failed to update settings:", error);
    return res.status(500).json({ error: "Failed to update settings" });
  }
});

export default router;