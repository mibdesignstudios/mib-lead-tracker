import { route, send, endSession } from "./_lib.js";
export default route({ POST: async (req, res) => { endSession(res); send(res, 200, { ok: true }); } });
