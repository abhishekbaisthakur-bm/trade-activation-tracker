# Trade Activation Tracker

PAN-India trade activation tracking for the Thyrocare Pregnancy Kit launch. Field staff log
collateral installed at each pharmacy with photo proof and a GPS fix; managers see execution
against plan.

- **Frontend** React 18 + Vite + Tailwind (`/web`)
- **Backend** Node 20 + Express + PostgreSQL 16 (`/server`)
- **Photos** your disk or any S3-compatible bucket, never a third-party service
- **Auth** JWT with bcrypt password hashing, three roles: admin, manager and field

For the recommended production architecture using Vercel, Render PostgreSQL and
Cloudflare R2, follow [DEPLOYMENT.md](DEPLOYMENT.md).

---

## 1. Quick start with Docker

Needs Docker and Docker Compose on the server.

```bash
cp server/.env.example server/.env
# Edit server/.env: set JWT_SECRET, BOOTSTRAP_ADMIN_PASSWORD, POSTGRES_PASSWORD
nano server/.env

# build the frontend into the API's public folder
cd web && npm install && npm run build && cp -r dist/* ../server/public/ && cd ..

docker compose up -d --build
docker compose exec api npm run migrate
docker compose exec api npm run seed          # add --demo for sample users and targets
```

Open `http://your-server:4000` and log in with the bootstrap admin.

## 2. Manual install (no Docker)

```bash
# PostgreSQL 16
sudo -u postgres psql -c "CREATE USER tat WITH PASSWORD 'strong_password';"
sudo -u postgres psql -c "CREATE DATABASE tat OWNER tat;"

cd server
cp .env.example .env && nano .env
npm install
npm run migrate
npm run seed
npm start                    # or run under pm2 / systemd

cd ../web
npm install
npm run build
cp -r dist/* ../server/public/
```

Put Nginx or Caddy in front for TLS. **HTTPS is not optional**: browsers block the camera and
GPS on plain HTTP, so the field app will not work without a certificate.

Minimum Nginx block:

```nginx
server {
  server_name activation.yourcompany.in;
  client_max_body_size 10M;          # photo uploads
  location / { proxy_pass http://127.0.0.1:4000; }
}
```

Then `certbot --nginx -d activation.yourcompany.in`.

---

## 3. Environment variables

Everything lives in `server/.env`. The ones that matter:

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. Set `PGSSLMODE=require` for managed databases (RDS, Neon, Azure). |
| `JWT_SECRET` | Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. Changing it logs everyone out. |
| `STORAGE_DRIVER` | `local` or `s3`. |
| `UPLOAD_DIR` | Where photos are written in `local` mode. Back this up. |
| `S3_*` | Bucket, region, credentials. `S3_ENDPOINT` + `S3_FORCE_PATH_STYLE=true` for MinIO or Spaces. |
| `BOOTSTRAP_ADMIN_*` | The first manager account, created by `npm run seed`. Change the password after first login. |
| `CORS_ORIGIN` | Only needed if the frontend is on a different domain. |

### Switching photo storage to S3 later

Set the `S3_*` variables, change `STORAGE_DRIVER=s3`, copy existing files to the bucket keeping
the same paths (`aws s3 sync /var/lib/tat/uploads s3://your-bucket/`), and restart. The
`photos.storage_key` values stay valid. Photos are always served through the API, so the bucket
should stay private.

---

## 4. Getting started as a manager

1. Log in with the bootstrap admin.
2. **Plan vs actual → Template** to download the target CSV, fill in one row per area with
   planned shops and planned quantity per asset, then **Upload targets**. The state, city and
   area dropdowns everywhere in the app are built from this file, so upload it first.
3. **Data → Add user** for each salesman. They log in with employee ID, mobile or email.
4. Field staff start submitting. Managers open a salesperson from their team dashboard to review
   each entry with its photos, location and GPS accuracy, then approve, reject or mark it pending.

---

## 5. What the server enforces

Client-side checks can be bypassed by anyone with the browser console, so these are also
enforced in the API and the database:

- At least one asset per activation, quantity of one or more.
- Photo proof required for every *installed* asset. Brown Envelope is a distributed item and
  does not require a photo.
- A valid GPS coordinate is mandatory. `gps_source` records whether it came from the device or
  was typed in manually, so an unverified entry can never look like a real fix.
- One activation per salesman per shop per day, enforced by a partial unique index. A genuine
  repeat visit requires an explicit override and is flagged in the record.
- The employee ID stored on an activation always comes from the auth token, never from the
  request body.
- Photos are private. Every read goes through the API and checks the caller's role; field staff
  can only open their own records.
- Users are deactivated, never deleted, so activation history stays auditable.
- Field users may enter new shop or geography values freely. Values outside the master list are
  stored with the activation and queued for their manager to approve before becoming suggestions.
- Login is rate limited to 20 attempts per 10 minutes per IP.
- `audit_log` records logins, user changes, plan imports and every status change.

---

## 6. API reference

All routes need `Authorization: Bearer <token>` except health and login.

| Method | Path | Role | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | - | Database and storage health |
| POST | `/api/auth/login` | - | Returns token and user |
| GET | `/api/auth/me` | any | Current user |
| POST | `/api/auth/change-password` | any | Self-service password change |
| POST | `/api/activations` | any | Multipart submission (`payload` JSON + `photo_<asset>` files) |
| GET | `/api/activations` | any | Filtered, paginated list. Field users see only their own |
| GET | `/api/activations/:id` | any | Full record with assets and photo IDs |
| GET | `/api/activations/:id/photo/:asset` | any | The image itself |
| PATCH | `/api/activations/:id/status` | manager | Approve, reject or mark pending for an assigned field user |
| GET | `/api/admin/users` | admin | List |
| POST/PATCH/DELETE | `/api/admin/users[/:id]` | admin | Create, update, deactivate |
| GET | `/api/admin/pharmacies` | any | Shop lookup for the field form |
| GET | `/api/admin/plans` | any | Planned targets (also drives the geography dropdowns) |
| GET | `/api/requests/master-data` | manager | New shop/geography values submitted by assigned field users |
| POST | `/api/requests/master-data/:id/approve` | manager | Promote reviewed values into the pharmacy/geography master |
| POST | `/api/requests/master-data/:id/reject` | manager | Reject a proposed master-data addition without rejecting its activation |
| GET/POST | `/api/requests/master-pharmacies` | manager | Search the territory master or add a verified shop |
| PATCH/DELETE | `/api/requests/master-pharmacies/:id` | manager | Edit or soft-deactivate a territory shop |
| POST | `/api/requests/master-pharmacies/import` | manager | Bulk import verified shops from CSV |
| POST | `/api/requests/master-pharmacies/:id/merge` | manager | Merge a duplicate into another territory shop |
| PUT | `/api/admin/plans` | admin | Replace targets as JSON |
| POST | `/api/admin/plans/import` | admin | Replace targets from CSV |
| GET | `/api/analytics/summary` | admin | All dashboard aggregates, computed in Postgres |
| GET | `/api/analytics/me` | any | Personal totals for the field dashboard |
| GET | `/api/analytics/export/activations.csv` | admin | Row per activation-asset with photo keys |
| GET | `/api/analytics/export/plan-vs-actual.csv` | admin | City level plan vs actual |

Filter parameters accepted by list, summary and export: `from`, `to`, `state`, `city`, `area`,
`userId`, `asset`, `status`, `search`, `limit`, `offset`.

---

## 7. Database

Tables: `users`, `pharmacies`, `planned_targets`, `planned_assets`, `activations`,
`activation_assets`, `photos`, `audit_log`. Full definition in `server/db/schema.sql`.

Aggregation happens in SQL, so the dashboard stays fast as records accumulate; the browser never
downloads the activation table.

### Backups

Two things must be backed up together, or photo proof becomes unverifiable:

```bash
pg_dump "$DATABASE_URL" | gzip > tat-$(date +%F).sql.gz
tar czf tat-photos-$(date +%F).tar.gz /var/lib/tat/uploads     # skip if using S3
```

---

## 8. Known gaps before a 200-person rollout

Deliberately not built yet, in rough priority order:

1. **Offline capture.** Pharmacy back rooms have poor signal. Right now a submission needs
   connectivity; if it fails the user must retry. A service worker with an IndexedDB queue is
   the single highest-value addition.
2. **Server-side image processing.** Photos are compressed in the browser before upload. Adding
   `sharp` to re-encode and strip EXIF on the server would cut storage and remove a trust
   assumption.
3. **Password reset by OTP.** Managers currently reset passwords manually from the Data tab.
4. **Refresh tokens.** Sessions last 12 hours and then require a fresh login.
5. **Photo authenticity.** A camera capture can still be a photo of a photo. If this matters for
   incentive payouts, compare submission GPS against the pharmacy master coordinates and flag
   entries beyond a distance threshold.
6. **Rate of duplicate shop names.** Matching is on lowercased name plus city. A shop entered
   with a different spelling counts as a new outlet and inflates penetration.
