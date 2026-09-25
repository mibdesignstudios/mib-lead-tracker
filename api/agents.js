import bcrypt from "bcryptjs";
import { route, send, readBody, q, requireAdmin, httpError, clean, randomPin, phone10, AGENT_MONEY_SQL } from "./_lib.js";

export default route({
  GET: async (req, res) => {
    await requireAdmin(req);
    const agents = await q(`SELECT a.id, a.code, a.name, a.phone, a.firm, a.active, a.created_at,
        m.leads, m.onboard, m.active_leads, m.earned, m.due_to_date, m.paid
      FROM agents a JOIN (${AGENT_MONEY_SQL} GROUP BY a.id) m ON m.id=a.id
      ORDER BY a.active DESC, a.name`);
    const un = await q("SELECT COUNT(*)::int AS n FROM leads WHERE agent_id IS NULL");
    send(res, 200, { agents, unassigned: un[0].n });
  },
  POST: async (req, res) => {
    await requireAdmin(req);
    const b = await readBody(req);
    const name = clean(b.name, 120);
    if (!name) throw httpError(400, "Add the partner's name.");
    const phone = clean(b.phone, 20);
    if (phone) {
      const dup = await q("SELECT code, name FROM agents WHERE right(regexp_replace(coalesce(phone,''),'\\D','','g'),10)=$1", [phone10(phone)]);
      if (dup[0]) throw httpError(409, `This phone number already belongs to ${dup[0].name} (${dup[0].code}).`);
    }
    const next = await q("SELECT COALESCE(MAX(id),0)+1 AS n FROM agents");
    let code = "MIB-A" + String(next[0].n).padStart(3, "0");
    const taken = await q("SELECT 1 FROM agents WHERE code=$1", [code]);
    if (taken[0]) code = "MIB-A" + String(Date.now()).slice(-5);
    const pin = randomPin();
    const hash = await bcrypt.hash(pin, 10);
    const rows = await q("INSERT INTO agents (code, name, phone, firm, pin_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id, code, name, phone, firm",
      [code, name, phone, clean(b.firm, 120), hash]);
    // Link any unassigned leads that came from this phone number.
    if (phone) await q("UPDATE leads SET agent_id=$1 WHERE agent_id IS NULL AND right(regexp_replace(coalesce(agent_phone_raw,''),'\\D','','g'),10)=$2", [rows[0].id, phone10(phone)]);
    send(res, 201, { agent: rows[0], pin });
  },
  PATCH: async (req, res) => {
    await requireAdmin(req);
    const b = await readBody(req);
    const id = Number(b.id);
    if (!id) throw httpError(400, "Missing partner.");
    const cur = (await q("SELECT * FROM agents WHERE id=$1", [id]))[0];
    if (!cur) throw httpError(404, "Partner not found.");
    let pin = null;
    if (b.resetPin) {
      pin = randomPin();
      await q("UPDATE agents SET pin_hash=$1 WHERE id=$2", [await bcrypt.hash(pin, 10), id]);
    }
    await q("UPDATE agents SET name=$1, phone=$2, firm=$3, active=$4 WHERE id=$5", [
      b.name !== undefined ? (clean(b.name, 120) || cur.name) : cur.name,
      b.phone !== undefined ? clean(b.phone, 20) : cur.phone,
      b.firm !== undefined ? clean(b.firm, 120) : cur.firm,
      b.active !== undefined ? !!b.active : cur.active, id]);
    send(res, 200, { ok: true, pin });
  },
});
