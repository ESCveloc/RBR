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
    return res.json(adminSettings);
  } catch (error) {
    console.error("Failed to fetch settings:", error);
    return res.status(500).json({ error: "Failed to fetch settings" });
  }
});

router.put("/settings", async (req, res) => {
  try {
    const { theme, ...otherSettings } = req.body;
    
    // Update settings in database
    await db
      .update(settings)
      .set({ ...req.body })
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
