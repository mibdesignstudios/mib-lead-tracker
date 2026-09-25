import { route, send, readBody, getQuery, q, getSession, requireAdmin, httpError, clean, calcFee, phone10, STAGES, STAGE_LABEL } from "./_lib.js";

const LIST_SQL = `SELECT l.*, a.code AS agent_code, a.name AS agent_name,
    (SELECT note FROM mib_lead_updates u WHERE u.lead_id=l.id AND u.note IS NOT NULL ORDER BY u.created_at DESC LIMIT 1) AS last_note
  FROM mib_leads l LEFT JOIN mib_agents a ON a.id=l.agent_id`;

function num(v) { if (v === "" || v === null || v === undefined) return null; const n = Number(String(v).replace(/[^\d.]/g, "")); return isFinite(n) ? n : null; }
function date(v) { return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; }

export default route({
  GET: async (req, res) => {
    await requireAdmin(req);
    const p = getQuery(req);
    if (p.id) {
      const lead = (await q(LIST_SQL + " WHERE l.id=$1", [Number(p.id)]))[0];
      if (!lead) throw httpError(404, "Lead not found.");
      const updates = await q("SELECT * FROM mib_lead_updates WHERE lead_id=$1 ORDER BY created_at DESC", [lead.id]);
      return send(res, 200, { lead, updates });
    }
    const where = [], args = [];
    if (p.status && STAGES.includes(p.status)) { args.push(p.status); where.push(`l.status=$${args.length}`); }
    if (p.agent === "none") where.push("l.agent_id IS NULL");
    else if (p.agent) { args.push(Number(p.agent)); where.push(`l.agent_id=$${args.length}`); }
    if (p.search) { args.push("%" + p.search + "%"); where.push(`(l.client_name ILIKE $${args.length} OR l.client_phone ILIKE $${args.length} OR l.location ILIKE $${args.length} OR a.name ILIKE $${args.length})`); }
    const leads = await q(LIST_SQL + (where.length ? " WHERE " + where.join(" AND ") : "") + " ORDER BY l.updated_at DESC LIMIT 500", args);
    const counts = await q("SELECT status, COUNT(*)::int AS n FROM mib_leads GROUP BY status");
    const due = await q("SELECT COUNT(*)::int AS n FROM mib_leads WHERE status='follow_up' AND follow_up_date <= CURRENT_DATE");
    send(res, 200, { leads, counts: Object.fromEntries(counts.map(c => [c.status, c.n])), followUpsDue: due[0].n });
  },

  POST: async (req, res) => {
    await requireAdmin(req);
    const b = await readBody(req);
    const client = clean(b.client_name, 120);
    if (!client) throw httpError(400, "Add the client's name.");
    const agentId = num(b.agent_id);
    const dup = b.client_phone ? (await q("SELECT id FROM mib_leads WHERE right(regexp_replace(coalesce(client_phone,''),'\\D','','g'),10)=$1 ORDER BY id LIMIT 1", [phone10(b.client_phone)]))[0] : null;
    const rows = await q(`INSERT INTO mib_leads (agent_id, agent_name_raw, agent_phone_raw, client_name, client_phone, property_type, location, budget, timeline, service, notes, source, duplicate_of)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'manual',$12) RETURNING id`,
      [agentId, clean(b.agent_name_raw, 120), clean(b.agent_phone_raw, 20), client, clean(b.client_phone, 20), clean(b.property_type, 60),
       clean(b.location, 120), clean(b.budget, 60), clean(b.timeline, 60), clean(b.service, 80), clean(b.notes, 1000), dup ? dup.id : null]);
    await q("INSERT INTO mib_lead_updates (lead_id, status, note, shared) VALUES ($1,'new',$2,true)", [rows[0].id, "Lead registered"]);
    send(res, 201, { id: rows[0].id, duplicate_of: dup ? dup.id : null });
  },

  PATCH: async (req, res) => {
    await requireAdmin(req);
    const b = await readBody(req);
    const id = Number(b.id);
    const cur = (await q("SELECT * FROM mib_leads WHERE id=$1", [id]))[0];
    if (!cur) throw httpError(404, "Lead not found.");
    const status = b.status && STAGES.includes(b.status) ? b.status : cur.status;
    const f = k => (b[k] !== undefined ? b[k] : cur[k]);
    const projectValue = b.project_value !== undefined ? num(b.project_value) : cur.project_value;
    let fee = cur.fee, feeManual = cur.fee_manual;
    if (b.fee !== undefined && b.fee !== "" && b.fee !== null) { fee = num(b.fee); feeManual = true; }
    if (b.fee_auto) feeManual = false;
    if (!feeManual) fee = projectValue ? calcFee(projectValue) : null;
    await q(`UPDATE mib_leads SET agent_id=$1, client_name=$2, client_phone=$3, property_type=$4, location=$5, budget=$6, timeline=$7, service=$8,
        notes=$9, status=$10, follow_up_date=$11, meet_date=$12, project_value=$13, fee=$14, fee_manual=$15, handed_over=$16, updated_at=now() WHERE id=$17`,
      [b.agent_id !== undefined ? num(b.agent_id) : cur.agent_id, clean(f("client_name"), 120) || cur.client_name, clean(f("client_phone"), 20),
       clean(f("property_type"), 60), clean(f("location"), 120), clean(f("budget"), 60), clean(f("timeline"), 60), clean(f("service"), 80),
       clean(f("notes"), 1000), status,
       b.follow_up_date !== undefined ? date(b.follow_up_date) : cur.follow_up_date,
       b.meet_date !== undefined ? date(b.meet_date) : cur.meet_date,
       projectValue, fee, feeManual, b.handed_over !== undefined ? !!b.handed_over : cur.handed_over, id]);
    const note = clean(b.note, 1000);
    const statusChanged = status !== cur.status;
    const handoverNow = b.handed_over && !cur.handed_over;
    const auto = [statusChanged ? `Moved to ${STAGE_LABEL[status]}` : null, handoverNow ? "Handover done" : null].filter(Boolean).join(" · ");
    const shared = b.note_shared === undefined ? true : !!b.note_shared;
    if (shared && (auto || note)) {
      await q("INSERT INTO mib_lead_updates (lead_id, status, note, shared) VALUES ($1,$2,$3,true)", [id, statusChanged ? status : null, [auto, note].filter(Boolean).join(" — ")]);
    } else {
      // Stage changes are always visible to the partner; an internal note is stored separately.
      if (auto) await q("INSERT INTO mib_lead_updates (lead_id, status, note, shared) VALUES ($1,$2,$3,true)", [id, statusChanged ? status : null, auto]);
      if (note) await q("INSERT INTO mib_lead_updates (lead_id, status, note, shared) VALUES ($1,NULL,$2,false)", [id, note]);
    }
    send(res, 200, { ok: true });
  },

  DELETE: async (req, res) => {
    await requireAdmin(req);
    const id = Number(getQuery(req).id);
    await q("DELETE FROM mib_leads WHERE id=$1", [id]);
    send(res, 200, { ok: true });
  },
});
