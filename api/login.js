import bcrypt from "bcryptjs";
import { route, send, readBody, q, startSession, httpError } from "./_lib.js";

// Simple in-memory throttle per instance (best effort).
const tries = new Map();
function throttle(key) {
  const now = Date.now(), t = tries.get(key) || { n: 0, at: now };
  if (now - t.at > 15 * 60 * 1000) { t.n = 0; t.at = now; }
  t.n++; tries.set(key, t);
  if (t.n > 10) throw httpError(429, "Too many attempts. Wait 15 minutes and try again.");
}

export default route({
  POST: async (req, res) => {
    const b = await readBody(req);
    if (b.role === "admin") {
      throttle("admin");
      const pass = process.env.ADMIN_PASSWORD;
      if (!pass) throw httpError(500, "ADMIN_PASSWORD is not set in Vercel → Settings → Environment Variables.");
      if (String(b.password || "") !== pass) throw httpError(401, "Wrong admin password.");
      await startSession(res, { role: "admin" });
      return send(res, 200, { ok: true, role: "admin" });
    }
    const code = String(b.code || "").trim().toUpperCase();
    throttle("agent:" + code);
    const rows = await q("SELECT id, code, name, pin_hash, active FROM agents WHERE code=$1", [code]);
    const a = rows[0];
    if (!a || !(await bcrypt.compare(String(b.pin || ""), a.pin_hash))) throw httpError(401, "Partner ID or PIN is wrong.");
    if (!a.active) throw httpError(403, "This partner account is not active. Contact MIB Design Studios.");
    await startSession(res, { role: "agent", agentId: a.id, code: a.code });
    send(res, 200, { ok: true, role: "agent" });
  },
});
