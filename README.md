# MIB Lead Tracker

Tracks partner (real estate agent) referrals for MIB Design Studios.

- `/` – login (Partner ID + PIN, or MIB team password)
- `/admin` – MIB team: leads by stage, partners, payments
- `/portal` – partner's own leads, status and money owed
- `/api/referral` – public endpoint the referral page posts new leads to

## Vercel settings
- Storage: Neon Postgres connected to the project (provides `DATABASE_URL`)
- Environment variables: `ADMIN_PASSWORD`, `JWT_SECRET` (long random text)
- Tables (mib_agents, mib_leads, mib_lead_updates, mib_payments) are created automatically on first use, so the database can be shared with another app.

## Referral fee slabs (must match the partner page)
< ₹10 L: none · 10–15 L: ₹50,000 · 15–22 L: ₹65,000 · 22–30 L: ₹85,000 · 30–40 L: ₹1,10,000 · 40–50 L: ₹1,35,000 · 50 L+: 3% capped at ₹2,50,000.
Paid 50% at first client milestone (stage "Onboard"), 50% after handover.
