// Shared helpers for the MIB Lead Tracker API (files starting with "_" are not routes on Vercel).
import pg from "pg";
import { SignJWT, jwtVerify } from "jose";

// Keep DATE columns as plain "YYYY-MM-DD" strings (no timezone shifting).
pg.types.setTypeParser(1082, v => v);

export const STAGES = ["new", "follow_up", "meet", "quote", "onboard", "lost"];
export const STAGE_LABEL = {
  new: "New", follow_up: "Follow up", meet: "Meet initiated",
  quote: "Quote shared", onboard: "Onboard", lost: "Lost",
};

/* ---------- database ---------- */
let pool;
function getPool() {
  if (!pool) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw httpError(500, "Database is not connected. Add a Neon database to this Vercel project.");
    const local = /localhost|127\.0\.0\.1|\/var\/run/.test(url);
    pool = new pg.Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 3 });
  }
  return pool;
}
export async function q(text, params = []) {
  await ensureSchema();
  const r = await getPool().query(text, params);
  return r.rows;
}

let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = getPool().query(`
      CREATE TABLE IF NOT EXISTS agents (
        id SERIAL PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        phone TEXT,
        firm TEXT,
        pin_hash TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS leads (
        id SERIAL PRIMARY KEY,
        agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
        agent_name_raw TEXT,
        agent_phone_raw TEXT,
        client_name TEXT NOT NULL,
        client_phone TEXT,
        property_type TEXT,
        location TEXT,
        budget TEXT,
        timeline TEXT,
        service TEXT,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'new',
        follow_up_date DATE,
        meet_date DATE,
        project_value NUMERIC,
        fee NUMERIC,
        fee_manual BOOLEAN NOT NULL DEFAULT FALSE,
        handed_over BOOLEAN NOT NULL DEFAULT FALSE,
        duplicate_of INTEGER,
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS lead_updates (
        id SERIAL PRIMARY KEY,
        lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        status TEXT,
        note TEXT,
        shared BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
        amount NUMERIC NOT NULL,
        paid_on DATE NOT NULL DEFAULT CURRENT_DATE,
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS leads_agent_idx ON leads(agent_id);
      CREATE INDEX IF NOT EXISTS leads_status_idx ON leads(status);
      CREATE INDEX IF NOT EXISTS updates_lead_idx ON lead_updates(lead_id);
    `).catch(e => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

/* ---------- referral fee (same slabs as the partner page) ---------- */
// value in rupees -> fee in rupees
export function calcFee(value) {
  const v = Number(value) / 100000; // lakh
  if (!v || v < 10) return 0;
  if (v >= 50) return Math.min(Math.round(v * 100000 * 0.03), 250000);
  const slabs = [[10, 15, 50000], [15, 22, 65000], [22, 30, 85000], [30, 40, 110000], [40, 50, 135000]];
  const s = slabs.find(([a, b]) => v >= a && v < b);
  return s ? s[2] : 0;
}

/* ---------- http helpers ---------- */
export function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

export function send(res, status, data, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(data));
}

export async function readBody(req) {
  if (req.body !== undefined && req.body !== null && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  let raw = typeof req.body === "string" ? req.body : Buffer.isBuffer(req.body) ? req.body.toString("utf8") : null;
  if (raw === null) {
    raw = await new Promise((resolve, reject) => {
      let d = ""; req.on("data", c => { d += c; if (d.length > 1e6) reject(httpError(413, "Too much data")); });
      req.on("end", () => resolve(d)); req.on("error", reject);
    });
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw httpError(400, "Invalid request"); }
}

export function getQuery(req) {
  if (req.query) return req.query;
  return Object.fromEntries(new URL(req.url, "http://x").searchParams);
}

// Wrap a handler with error handling and method routing.
export function route(methods) {
  return async (req, res) => {
    try {
      if (req.method === "OPTIONS" && methods.OPTIONS) return methods.OPTIONS(req, res);
      const h = methods[req.method];
      if (!h) return send(res, 405, { error: "Method not allowed" });
      await h(req, res);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(e);
      send(res, status, { error: status >= 500 && !e.status ? "Something went wrong on the server. Try again." : e.message });
    }
  };
}

/* ---------- sessions ---------- */
const COOKIE = "mib_session";
function secret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) throw httpError(500, "JWT_SECRET is missing. Add it in Vercel → Settings → Environment Variables.");
  return new TextEncoder().encode(s);
}
export async function startSession(res, payload) {
  const token = await new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("30d").sign(secret());
  const secure = process.env.NODE_ENV === "development" ? "" : " Secure;";
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`);
}
export function endSession(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}
export async function getSession(req) {
  const m = (req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  try { const { payload } = await jwtVerify(m[1], secret()); return payload; } catch { return null; }
}
export async function requireAdmin(req) {
  const s = await getSession(req);
  if (!s || s.role !== "admin") throw httpError(401, "Please log in as admin.");
  return s;
}
export async function requireAgent(req) {
  const s = await getSession(req);
  if (!s || s.role !== "agent") throw httpError(401, "Please log in.");
  const rows = await q("SELECT id, active FROM agents WHERE id=$1", [s.agentId]);
  if (!rows[0] || !rows[0].active) throw httpError(401, "This partner account is not active. Contact MIB Design Studios.");
  return s;
}

/* ---------- misc ---------- */
export function phone10(p) { const d = String(p || "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : d; }
export function clean(v, max = 300) { if (v === undefined || v === null) return null; const s = String(v).trim().slice(0, max); return s || null; }
export function randomPin() { return String(Math.floor(100000 + Math.random() * 900000)); }

// Money summary per agent: earned = fee on onboard leads; due now = 50% at onboard + 50% after handover.
export const AGENT_MONEY_SQL = `
  SELECT a.id,
    COALESCE(SUM(l.fee) FILTER (WHERE l.status='onboard'),0) AS earned,
    COALESCE(SUM(CASE WHEN l.status='onboard' THEN (CASE WHEN l.handed_over THEN l.fee ELSE l.fee/2 END) ELSE 0 END),0) AS due_to_date,
    COUNT(l.id) AS leads,
    COUNT(l.id) FILTER (WHERE l.status='onboard') AS onboard,
    COUNT(l.id) FILTER (WHERE l.status NOT IN ('onboard','lost')) AS active_leads,
    (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.agent_id=a.id) AS paid
  FROM agents a LEFT JOIN leads l ON l.agent_id=a.id`;
