// Everything a logged-in partner can see about their own leads and money.
import { route, send, q, requireAgent, AGENT_MONEY_SQL } from "./_lib.js";
export default route({
  GET: async (req, res) => {
    const s = await requireAgent(req);
    const agent = (await q("SELECT id, code, name, firm FROM mib_agents WHERE id=$1", [s.agentId]))[0];
    const money = (await q(AGENT_MONEY_SQL + " WHERE a.id=$1 GROUP BY a.id", [s.agentId]))[0];
    const leads = await q(`SELECT id, client_name, property_type, location, service, status, follow_up_date, meet_date,
        project_value, fee, handed_over, created_at, updated_at
      FROM mib_leads WHERE agent_id=$1 ORDER BY created_at DESC`, [s.agentId]);
    const ids = leads.map(l => l.id);
    const updates = ids.length ? await q("SELECT lead_id, status, note, created_at FROM mib_lead_updates WHERE shared AND lead_id = ANY($1) ORDER BY created_at DESC", [ids]) : [];
    for (const l of leads) {
      l.updates = updates.filter(u => u.lead_id === l.id).slice(0, 5);
      if (l.status !== "onboard") { l.project_value = null; l.fee = null; }
    }
    const payments = await q("SELECT p.amount, p.paid_on, p.note, l.client_name FROM mib_payments p LEFT JOIN mib_leads l ON l.id=p.lead_id WHERE p.agent_id=$1 ORDER BY p.paid_on DESC", [s.agentId]);
    send(res, 200, { agent, money, leads, payments });
  },
});
