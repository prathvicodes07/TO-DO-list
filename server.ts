import express, { Request, Response } from "express";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

interface TaskRecord {
  id: string;
  title: string;
  date: string;
  completed: boolean;
  created_at: string;
}

/**
 * Lazily creates a Supabase client using server-side environment variables.
 * Returns null if credentials are not configured yet or if SUPABASE_URL is invalid.
 */
let cachedSupabase: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient | null {
  if (cachedSupabase) {
    return cachedSupabase;
  }

  const rawUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const rawKey = (
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_KEY ||
    ""
  ).trim();

  if (!rawUrl || !rawKey) {
    return null;
  }

  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") {
      console.error("Invalid SUPABASE_URL protocol. Expected https://.");
      return null;
    }
  } catch {
    console.error("Invalid SUPABASE_URL format.");
    return null;
  }

  cachedSupabase = createClient(rawUrl, rawKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cachedSupabase;
}

function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function mapTaskRecord(row: TaskRecord) {
  return {
    id: row.id,
    title: row.title,
    date: row.date,
    completed: Boolean(row.completed),
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  };
}

function requireSupabase(res: Response): SupabaseClient | null {
  const client = getSupabaseClient();
  if (!client) {
    res.status(503).json({
      configured: false,
      error: "Supabase credentials are not configured on the server yet.",
    });
    return null;
  }
  return client;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "16kb" }));

  // =========================================================================
  // Supabase CRUD API Routes (/api/tasks)
  // =========================================================================

  // READ: Fetch all tasks from Supabase ordered newest first
  app.get("/api/tasks", async (_req: Request, res: Response) => {
    const supabase = requireSupabase(res);
    if (!supabase) return;

    try {
      const { data, error } = await supabase
        .from("tasks")
        .select("id, title, date, completed, created_at")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Supabase GET /api/tasks error:", error.message);
        res.status(500).json({ error: "Failed to load tasks from Supabase." });
        return;
      }

      res.json({
        configured: true,
        tasks: (data || []).map((row) => mapTaskRecord(row as TaskRecord)),
      });
    } catch (err) {
      console.error("Unexpected GET /api/tasks error:", err);
      res.status(500).json({ error: "Failed to load tasks from Supabase." });
    }
  });

  // CREATE: Validate and insert a new task into Supabase
  app.post("/api/tasks", async (req: Request, res: Response) => {
    const supabase = requireSupabase(res);
    if (!supabase) return;

    const rawTitle = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const rawDate = typeof req.body?.date === "string" ? req.body.date.trim() : "";

    if (!rawTitle || rawTitle.length > 160) {
      res.status(400).json({
        error: "Task title is required and must be between 1 and 160 characters.",
      });
      return;
    }

    const validDate = rawDate && DATE_REGEX.test(rawDate) ? rawDate : getTodayDateString();

    try {
      const { data, error } = await supabase
        .from("tasks")
        .insert({
          title: rawTitle,
          date: validDate,
          completed: false,
        })
        .select("id, title, date, completed, created_at")
        .single();

      if (error || !data) {
        console.error("Supabase POST /api/tasks error:", error?.message);
        res.status(500).json({ error: "Failed to create task in Supabase." });
        return;
      }

      res.status(201).json({ task: mapTaskRecord(data as TaskRecord) });
    } catch (err) {
      console.error("Unexpected POST /api/tasks error:", err);
      res.status(500).json({ error: "Failed to create task in Supabase." });
    }
  });

  // UPDATE: Modify task title, date, or completion status in Supabase
  app.patch("/api/tasks/:id", async (req: Request, res: Response) => {
    const supabase = requireSupabase(res);
    if (!supabase) return;

    const id = req.params.id;
    if (!UUID_REGEX.test(id)) {
      res.status(400).json({ error: "Invalid task ID format." });
      return;
    }

    const updates: Partial<{ title: string; date: string; completed: boolean }> = {};

    if (req.body?.title !== undefined) {
      if (typeof req.body.title !== "string") {
        res.status(400).json({ error: "Task title must be text." });
        return;
      }
      const trimmed = req.body.title.trim();
      if (!trimmed || trimmed.length > 160) {
        res.status(400).json({
          error: "Task title is required and must be between 1 and 160 characters.",
        });
        return;
      }
      updates.title = trimmed;
    }

    if (req.body?.date !== undefined) {
      if (typeof req.body.date !== "string" || !DATE_REGEX.test(req.body.date.trim())) {
        res.status(400).json({ error: "Invalid date format. Expected YYYY-MM-DD." });
        return;
      }
      updates.date = req.body.date.trim();
    }

    if (req.body?.completed !== undefined) {
      if (typeof req.body.completed !== "boolean") {
        res.status(400).json({ error: "Completed status must be a boolean." });
        return;
      }
      updates.completed = req.body.completed;
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No valid fields provided for update." });
      return;
    }

    try {
      const { data, error } = await supabase
        .from("tasks")
        .update(updates)
        .eq("id", id)
        .select("id, title, date, completed, created_at")
        .maybeSingle();

      if (error) {
        console.error("Supabase PATCH /api/tasks/:id error:", error.message);
        res.status(500).json({ error: "Failed to update task in Supabase." });
        return;
      }

      if (!data) {
        res.status(404).json({ error: "Task not found." });
        return;
      }

      res.json({ task: mapTaskRecord(data as TaskRecord) });
    } catch (err) {
      console.error("Unexpected PATCH /api/tasks/:id error:", err);
      res.status(500).json({ error: "Failed to update task in Supabase." });
    }
  });

  // DELETE (Bulk): Remove all completed tasks from Supabase
  app.delete("/api/tasks/completed", async (_req: Request, res: Response) => {
    const supabase = requireSupabase(res);
    if (!supabase) return;

    try {
      const { data, error } = await supabase
        .from("tasks")
        .delete()
        .eq("completed", true)
        .select("id");

      if (error) {
        console.error("Supabase DELETE /api/tasks/completed error:", error.message);
        res.status(500).json({ error: "Failed to clear completed tasks in Supabase." });
        return;
      }

      res.json({ deletedCount: (data || []).length });
    } catch (err) {
      console.error("Unexpected DELETE /api/tasks/completed error:", err);
      res.status(500).json({ error: "Failed to clear completed tasks in Supabase." });
    }
  });

  // DELETE (Single): Remove one task by ID from Supabase
  app.delete("/api/tasks/:id", async (req: Request, res: Response) => {
    const supabase = requireSupabase(res);
    if (!supabase) return;

    const id = req.params.id;
    if (!UUID_REGEX.test(id)) {
      res.status(400).json({ error: "Invalid task ID format." });
      return;
    }

    try {
      const { data, error } = await supabase
        .from("tasks")
        .delete()
        .eq("id", id)
        .select("id")
        .maybeSingle();

      if (error) {
        console.error("Supabase DELETE /api/tasks/:id error:", error.message);
        res.status(500).json({ error: "Failed to delete task from Supabase." });
        return;
      }

      if (!data) {
        res.status(404).json({ error: "Task not found." });
        return;
      }

      res.json({ deletedId: id });
    } catch (err) {
      console.error("Unexpected DELETE /api/tasks/:id error:", err);
      res.status(500).json({ error: "Failed to delete task from Supabase." });
    }
  });

  // =========================================================================
  // Frontend Asset Serving (Vite Dev Middleware or Production dist/)
  // =========================================================================

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`TaskFlow server listening on http://localhost:${PORT}`);
  });
}

startServer();
