# BIZINFO — Business information directory MVP

A starter full-stack website for selling access to company profiles. Includes responsive UI, company search/filter, customer signup/login, admin-protected company creation/deletion API, SQLite storage, and Razorpay order + signature verification flow.

## Requirements
- Node.js 18+
- npm
- Razorpay account and API keys for live/test checkout

## Run locally
1. Extract the ZIP.
2. In this folder run `npm install`.
3. Copy `.env.example` to `.env`.
4. Change `SESSION_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`.
5. Add Razorpay test keys to `.env` to test checkout. Until configured, checkout returns a clear setup message.
6. Run `npm start`.
7. Open `http://localhost:3000`.

The server creates `bizinfo.sqlite` automatically and seeds three clearly labelled demo company records. Replace them with accurate, authorized data.

## Admin
The first admin user is created from `ADMIN_EMAIL` and `ADMIN_PASSWORD` on startup. Admin API endpoints:
- `GET /api/admin/stats`
- `GET /api/admin/companies`
- `POST /api/admin/companies` JSON: `{ "name", "address", "website", "industry", "description" }`
- `DELETE /api/admin/companies/:id`

This starter provides the protected admin API, not a finished visual admin dashboard yet.

## Important before launch
- Set a strong unique session secret and use HTTPS.
- Use a persistent session store (not Express MemoryStore) in production.
- Add CSRF protection, rate limiting, email verification, password reset, audit logs, backups, and monitoring.
- Configure Razorpay webhooks and reconcile payments server-side before production.
- Keep Razorpay secret keys only on the server. Never expose them in frontend code.
- Review applicable privacy, consumer protection, tax, and data-protection requirements.
- Publish only lawfully obtained company information. Avoid personal contact data unless you have a lawful basis and appropriate permissions.
- Demo company names and records are placeholders, not real verified listings.
