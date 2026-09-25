// Shared helpers for the tracker pages.
const REFERRAL_URL = "https://mib-partner-programme.vercel.app";
const STAGES = [
  ["new", "New"], ["follow_up", "Follow up"], ["meet", "Meet initiated"],
  ["quote", "Quote shared"], ["onboard", "Onboard"], ["lost", "Lost"],
];
const STAGE_LABEL = Object.fromEntries(STAGES);

async function api(path, opts = {}) {
  const init = { method: opts.method || "GET", headers: {}, credentials: "same-origin" };
  if (opts.body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opts.body); }
  const r = await fetch(path, init);
  let data = {};
  try { data = await r.json(); } catch {}
  if (r.status === 401 && !opts.noRedirect) { location.href = "/"; throw new Error("Please log in."); }
  if (!r.ok) throw new Error(data.error || "Something went wrong. Try again.");
  return data;
}

const inr = n => (n === null || n === undefined || n === "") ? "—" : "₹" + Math.round(Number(n)).toLocaleString("en-IN");
const lakh = n => (n === null || n === undefined || n === "") ? "—" : "₹" + (Number(n) / 100000).toLocaleString("en-IN", { maximumFractionDigits: 2 }) + " L";
function fdate(d, withYear) {
  if (!d) return "";
  const x = new Date(String(d).length === 10 ? d + "T00:00:00" : d);
  return x.toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
}
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const isoDate = d => d ? String(d).slice(0, 10) : "";
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function pill(status) { return `<span class="pill" style="--c:var(--st-${status})">${esc(STAGE_LABEL[status] || status)}</span>`; }
function waLink(phone, text) {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.length === 10) d = "91" + d;
  return "https://wa.me/" + d + (text ? "?text=" + encodeURIComponent(text) : "");
}
function telLink(phone) { return "tel:" + String(phone || "").replace(/[^\d+]/g, ""); }

let toastTimer;
function toast(msg) {
  let t = document.querySelector(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 2800);
}
async function logout() { try { await api("/api/logout", { method: "POST", noRedirect: true }); } catch {} location.href = "/"; }
