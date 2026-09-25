// Public endpoint used by the partner referral page. Saves the lead, then the page opens WhatsApp as before.
import { route, send, readBody, q, httpError, clean, phone10 } from "./_lib.js";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const recent = new Map();

export default route({
  OPTIONS: async (req, res) => { res.statusCode = 204; for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v); res.end(); },
  POST: async (req, res) => {
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
    const b = await readBody(req);
    if (b.website) return send(res, 200, { ok: true }); // honeypot
    const client = clean(b.client, 120), clientPhone = clean(b.clientPh, 20);
    if (!client || !clientPhone) throw httpError(400, "Client name and phone are required.");
    // Ignore the exact same lead sent twice within 10 minutes (double taps).
    const key = phone10(clientPhone) + "|" + phone10(b.agentPh);
    const now = Date.now();
    if (recent.get(key) > now - 10 * 60 * 1000) return send(res, 200, { ok: true, repeat: true });
    recent.set(key, now);

    let agentId = null;
    const code = clean(b.partnerId, 20);
    if (code) agentId = (await q("SELECT id FROM agents WHERE code=$1 AND active", [code.toUpperCase()]))[0]?.id || null;
    if (!agentId && b.agentPh) agentId = (await q("SELECT id FROM agents WHERE active AND right(regexp_replace(coalesce(phone,''),'\\D','','g'),10)=$1", [phone10(b.agentPh)]))[0]?.id || null;
    const dup = (await q("SELECT id FROM leads WHERE right(regexp_replace(coalesce(client_phone,''),'\\D','','g'),10)=$1 ORDER BY id LIMIT 1", [phone10(clientPhone)]))[0];

    const r = await q(`INSERT INTO leads (agent_id, agent_name_raw, agent_phone_raw, client_name, client_phone, property_type, location, budget, timeline, service, notes, source, duplicate_of)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'form',$12) RETURNING id`,
      [agentId, clean(b.agent, 120), clean(b.agentPh, 20), client, clientPhone, clean(b.ptype, 60), clean(b.loc, 120),
       clean(b.budget, 60), clean(b.when, 60), clean(b.service, 80), clean(b.notes, 1000), dup ? dup.id : null]);
    await q("INSERT INTO lead_updates (lead_id, status, note, shared) VALUES ($1,'new','Lead received from referral form',true)", [r[0].id]);
    send(res, 201, { ok: true });
  },
});
