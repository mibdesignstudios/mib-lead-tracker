import { route, send, getSession, q } from "./_lib.js";
export default route({
  GET: async (req, res) => {
    const s = await getSession(req);
    if (!s) return send(res, 200, { role: null });
    if (s.role === "agent") {
      const r = await q("SELECT id, code, name FROM agents WHERE id=$1 AND active", [s.agentId]);
      if (!r[0]) return send(res, 200, { role: null });
      return send(res, 200, { role: "agent", agent: r[0] });
    }
    send(res, 200, { role: s.role });
  },
});
