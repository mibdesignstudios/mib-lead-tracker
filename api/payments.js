import { route, send, readBody, getQuery, q, requireAdmin, httpError, clean } from "./_lib.js";
export default route({
  GET: async (req, res) => {
    await requireAdmin(req);
    const p = getQuery(req);
    const args = [], where = [];
    if (p.agent) { args.push(Number(p.agent)); where.push(`p.agent_id=$${args.length}`); }
    const rows = await q(`SELECT p.*, a.name AS agent_name, a.code AS agent_code, l.client_name
      FROM mib_payments p JOIN mib_agents a ON a.id=p.agent_id LEFT JOIN mib_leads l ON l.id=p.lead_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY p.paid_on DESC, p.id DESC LIMIT 500`, args);
    send(res, 200, { payments: rows });
  },
  POST: async (req, res) => {
    await requireAdmin(req);
    const b = await readBody(req);
    const amount = Number(String(b.amount || "").replace(/[^\d.]/g, ""));
    if (!b.agent_id) throw httpError(400, "Choose the partner.");
    if (!amount || amount <= 0) throw httpError(400, "Enter the amount paid.");
    const date = /^\d{4}-\d{2}-\d{2}$/.test(b.paid_on || "") ? b.paid_on : null;
    await q("INSERT INTO mib_payments (agent_id, lead_id, amount, paid_on, note) VALUES ($1,$2,$3,COALESCE($4::date,CURRENT_DATE),$5)",
      [Number(b.agent_id), b.lead_id ? Number(b.lead_id) : null, amount, date, clean(b.note, 300)]);
    send(res, 201, { ok: true });
  },
  DELETE: async (req, res) => {
    await requireAdmin(req);
    await q("DELETE FROM mib_payments WHERE id=$1", [Number(getQuery(req).id)]);
    send(res, 200, { ok: true });
  },
});
