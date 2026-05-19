import express from "express";
import cors from "cors";
import multer from "multer";
import { Pool } from "pg";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.SERVER_PORT || process.env.PORT || 5174);
const databaseUrl = process.env.DATABASE_URL;
const imgbbKey = process.env.IMGBB_API_KEY;

if (!databaseUrl) {
  console.error("Missing DATABASE_URL environment variable.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS routes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      shift TEXT NOT NULL,
      color TEXT,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS route_notes (
      id TEXT PRIMARY KEY,
      route_id TEXT NOT NULL,
      type TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS route_notes_route_id_idx ON route_notes(route_id);

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const ensureColumn = async (table, column, definition, fillNullSql = null) => {
    const exists = await pool.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      [table, column],
    );
    if (exists.rowCount === 0) {
      await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
    if (fillNullSql) {
      await pool.query(fillNullSql);
    }
  };

  await ensureColumn("routes", "color", "TEXT");
  await ensureColumn("routes", "data", "JSONB NOT NULL DEFAULT '{}'::jsonb", "UPDATE routes SET data = '{}'::jsonb WHERE data IS NULL");
  await ensureColumn("routes", "created_at", "TIMESTAMPTZ NOT NULL DEFAULT now()", "UPDATE routes SET created_at = now() WHERE created_at IS NULL");
  await ensureColumn("routes", "updated_at", "TIMESTAMPTZ NOT NULL DEFAULT now()", "UPDATE routes SET updated_at = now() WHERE updated_at IS NULL");

  await ensureColumn("route_notes", "route_id", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("route_notes", "type", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("route_notes", "text", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("route_notes", "created_at", "TIMESTAMPTZ NOT NULL DEFAULT now()");

  await ensureColumn("app_state", "value", "JSONB NOT NULL DEFAULT '{}'::jsonb", "UPDATE app_state SET value = '{}'::jsonb WHERE value IS NULL");
  await ensureColumn("app_state", "updated_at", "TIMESTAMPTZ NOT NULL DEFAULT now()", "UPDATE app_state SET updated_at = now() WHERE updated_at IS NULL");
}

async function getAppState(key) {
  const result = await pool.query("SELECT value FROM app_state WHERE key = $1", [key]);
  return result.rows[0]?.value ?? null;
}

async function setAppState(key, value) {
  await pool.query(
    `INSERT INTO app_state(key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value],
  );
}

async function queryRoutes() {
  const result = await pool.query("SELECT data FROM routes ORDER BY created_at ASC");
  return result.rows.map(row => row.data);
}

app.get("/api/routes", async (req, res) => {
  try {
    const routes = await queryRoutes();
    res.json({ success: true, data: routes });
  } catch (error) {
    console.error("GET /api/routes", error);
    res.status(500).json({ success: false, error: "Failed to load routes" });
  }
});

app.post("/api/routes", async (req, res) => {
  try {
    const routes = Array.isArray(req.body.routes) ? req.body.routes : req.body;
    if (!Array.isArray(routes)) {
      return res.status(400).json({ success: false, error: "Routes payload must be an array" });
    }

    const queryText = `
      INSERT INTO routes(id, name, code, shift, color, data, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, now())
      ON CONFLICT (id)
      DO UPDATE SET name = EXCLUDED.name,
                    code = EXCLUDED.code,
                    shift = EXCLUDED.shift,
                    color = EXCLUDED.color,
                    data = EXCLUDED.data,
                    updated_at = now()`;

    for (const route of routes) {
      if (!route?.id || !route?.name || !route?.code || !route?.shift) continue;
      await pool.query(queryText, [
        route.id,
        route.name,
        route.code,
        route.shift,
        route.color ?? null,
        route,
      ]);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("POST /api/routes", error);
    res.status(500).json({ success: false, error: "Failed to save routes" });
  }
});

app.patch("/api/routes", async (req, res) => {
  try {
    const { id, color } = req.body;
    if (!id) {
      return res.status(400).json({ success: false, error: "Route id is required" });
    }
    const current = await pool.query("SELECT data FROM routes WHERE id = $1", [id]);
    if (current.rowCount === 0) {
      return res.status(404).json({ success: false, error: "Route not found" });
    }
    await pool.query(
      `UPDATE routes
       SET color = $2,
           data = jsonb_set(data, '{color}', to_jsonb($2::text), true),
           updated_at = now()
       WHERE id = $1`,
      [id, color ?? null],
    );
    res.json({ success: true });
  } catch (error) {
    console.error("PATCH /api/routes", error);
    res.status(500).json({ success: false, error: "Failed to update route" });
  }
});

app.get("/api/route-notes", async (req, res) => {
  try {
    const routeId = String(req.query.routeId ?? "");
    const type = req.query.type ? String(req.query.type) : null;
    if (!routeId) {
      return res.status(400).json({ success: false, error: "routeId is required" });
    }
    const values = [routeId];
    let queryText = "SELECT id, route_id, type, text, created_at FROM route_notes WHERE route_id = $1";
    if (type) {
      queryText += " AND type = $2";
      values.push(type);
    }
    queryText += " ORDER BY created_at DESC";
    const result = await pool.query(queryText, values);
    res.json({ success: true, changelog: result.rows });
  } catch (error) {
    console.error("GET /api/route-notes", error);
    res.status(500).json({ success: false, error: "Failed to load route notes" });
  }
});

app.post("/api/route-notes", async (req, res) => {
  try {
    const { id, routeId, type, text } = req.body;
    if (!id || !routeId || !type || !text) {
      return res.status(400).json({ success: false, error: "id, routeId, type, and text are required" });
    }
    await pool.query(
      `INSERT INTO route_notes(id, route_id, type, text, created_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (id)
       DO UPDATE SET route_id = EXCLUDED.route_id,
                     type = EXCLUDED.type,
                     text = EXCLUDED.text`,
      [id, routeId, type, text],
    );
    res.json({ success: true });
  } catch (error) {
    console.error("POST /api/route-notes", error);
    res.status(500).json({ success: false, error: "Failed to save route note" });
  }
});

app.delete("/api/route-notes", async (req, res) => {
  try {
    const routeId = String(req.query.routeId ?? "");
    const type = String(req.query.type ?? "");
    if (!routeId || !type) {
      return res.status(400).json({ success: false, error: "routeId and type are required" });
    }
    await pool.query("DELETE FROM route_notes WHERE route_id = $1 AND type = $2", [routeId, type]);
    res.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/route-notes", error);
    res.status(500).json({ success: false, error: "Failed to delete route notes" });
  }
});

app.get("/api/rooster", async (req, res) => {
  try {
    const state = await getAppState("rooster");
    const resources = Array.isArray(state?.resources) ? state.resources : [];
    const shifts = Array.isArray(state?.shifts) ? state.shifts : [];
    res.json({ success: true, resources, shifts });
  } catch (error) {
    console.error("GET /api/rooster", error);
    res.status(500).json({ success: false, error: "Failed to load rooster data" });
  }
});

app.post("/api/rooster", async (req, res) => {
  try {
    const { type } = req.body;
    if (type !== "resource" && type !== "shift") {
      return res.status(400).json({ success: false, error: "type must be 'resource' or 'shift'" });
    }

    const state = await getAppState("rooster") || { resources: [], shifts: [] };
    if (type === "resource") {
      const { id, name, role, color } = req.body;
      if (!id || !name || !role) {
        return res.status(400).json({ success: false, error: "id, name, and role are required" });
      }
      const existingIndex = state.resources.findIndex((item) => item.id === id);
      const resource = { id, name, role, color: color ?? "" };
      if (existingIndex >= 0) state.resources[existingIndex] = resource;
      else state.resources.push(resource);
    } else {
      const { id, resource_id, title, shift_date, start_hour, end_hour, color } = req.body;
      if (!id || !resource_id || !title || !shift_date) {
        return res.status(400).json({ success: false, error: "id, resource_id, title, and shift_date are required" });
      }
      const existingIndex = state.shifts.findIndex((item) => item.id === id);
      const shift = {
        id,
        resource_id,
        title,
        shift_date,
        start_hour: Number(start_hour) || 0,
        end_hour: Number(end_hour) || 0,
        color: color ?? "",
      };
      if (existingIndex >= 0) state.shifts[existingIndex] = shift;
      else state.shifts.push(shift);
    }

    await setAppState("rooster", state);
    res.json({ success: true });
  } catch (error) {
    console.error("POST /api/rooster", error);
    res.status(500).json({ success: false, error: "Failed to save rooster data" });
  }
});

app.delete("/api/rooster", async (req, res) => {
  try {
    const type = String(req.query.type ?? "");
    const id = String(req.query.id ?? "");
    if (!id || (type !== "resource" && type !== "shift")) {
      return res.status(400).json({ success: false, error: "type and id are required" });
    }

    const state = await getAppState("rooster") || { resources: [], shifts: [] };
    if (type === "resource") {
      state.resources = state.resources.filter((item) => item.id !== id);
    } else {
      state.shifts = state.shifts.filter((item) => item.id !== id);
    }

    await setAppState("rooster", state);
    res.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/rooster", error);
    res.status(500).json({ success: false, error: "Failed to delete rooster data" });
  }
});

app.get("/api/plano", async (req, res) => {
  try {
    const state = await getAppState("plano");
    const pages = Array.isArray(state?.pages) ? state.pages : [];
    res.json({ success: true, data: pages });
  } catch (error) {
    console.error("GET /api/plano", error);
    res.status(500).json({ success: false, error: "Failed to load plano data" });
  }
});

app.post("/api/plano", async (req, res) => {
  try {
    const pages = Array.isArray(req.body.pages) ? req.body.pages : [];
    await setAppState("plano", { pages });
    res.json({ success: true });
  } catch (error) {
    console.error("POST /api/plano", error);
    res.status(500).json({ success: false, error: "Failed to save plano data" });
  }
});

app.post("/api/upload", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "Image file is required" });
    }
    if (!imgbbKey) {
      return res.status(500).json({ success: false, error: "ImgBB API key is not configured" });
    }

    const formPayload = new URLSearchParams();
    formPayload.append("key", imgbbKey);
    formPayload.append("image", req.file.buffer.toString("base64"));

    const response = await fetch(`https://api.imgbb.com/1/upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: formPayload.toString(),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) {
      return res.status(response.status || 500).json({ success: false, error: payload?.error?.message || payload?.error || "ImgBB upload failed" });
    }

    return res.json(payload);
  } catch (error) {
    console.error("POST /api/upload", error);
    res.status(500).json({ success: false, error: "Failed to upload image" });
  }
});

function haversine([lng1, lat1], [lng2, lat2]) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c;
}

app.post("/api/road-distance", async (req, res) => {
  try {
    const { coordinates, source, destinations } = req.body;
    if (Array.isArray(coordinates) && coordinates.length >= 2) {
      const segments = [];
      let totalKm = 0;
      for (let i = 0; i < coordinates.length - 1; i += 1) {
        const distance = haversine(coordinates[i], coordinates[i + 1]);
        segments.push(Math.round(distance * 1000) / 1000);
        totalKm += distance;
      }
      return res.json({ mode: "sequence", segments, totalKm: Math.round(totalKm * 1000) / 1000 });
    }

    if (Array.isArray(source) && Array.isArray(destinations)) {
      const distances = destinations.map((destination) => {
        if (!Array.isArray(destination) || destination.length !== 2) return null;
        return Math.round(haversine(source, destination) * 1000) / 1000;
      });
      const durations = distances.map((distance) => distance === null ? null : Math.round((distance / 40) * 60));
      return res.json({ mode: "matrix", distances, durations });
    }

    return res.status(400).json({ success: false, error: "Invalid road-distance payload" });
  } catch (error) {
    console.error("POST /api/road-distance", error);
    res.status(500).json({ success: false, error: "Failed to compute road distance" });
  }
});

const staticDir = path.resolve(__dirname, "../dist/public");
app.use(express.static(staticDir, { index: false }));

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ success: false, error: "API route not found" });
  }
  return res.sendFile(path.join(staticDir, "index.html"));
});

initDb()
  .then(() => {
    app.listen(port, () => {
      console.log(`Backend server started on http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize database", error);
    process.exit(1);
  });
