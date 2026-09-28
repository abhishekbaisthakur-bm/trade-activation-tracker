# Production deployment: Vercel + Render + Cloudflare R2

This deployment keeps the React site on Vercel, the Express API and PostgreSQL
on Render, and private activation photos in Cloudflare R2.

## 1. Create private photo storage

1. In Cloudflare, open **Storage & databases → R2**.
2. Create a private bucket named `trade-activation-photos`.
3. Open **Manage R2 API Tokens** and create a token with **Object Read & Write**
   access restricted to this bucket.
4. Save the Access Key ID, Secret Access Key and S3 endpoint securely. The
   endpoint is `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.

Do not make the bucket public and do not commit credentials to GitHub. Photos
are served through the authenticated API.

## 2. Create the Render API and database

1. In Render, choose **New → Blueprint**.
2. Connect `abhishekbaisthakur-bm/trade-activation-tracker`.
3. Render detects `render.yaml` and proposes one web service and one PostgreSQL
   database in Singapore.
4. Choose paid production plans for the API and database before applying the
   Blueprint.
5. Enter these prompted environment variables in the Render dashboard:

| Key | Value |
| --- | --- |
| `CORS_ORIGIN` | Initially `https://<VERCEL_PROJECT>.vercel.app`; replace with the custom frontend domain later. |
| `BOOTSTRAP_ADMIN_NAME` | Initial administrator's name. |
| `BOOTSTRAP_ADMIN_EMPLOYEE_ID` | Initial administrator's login ID. |
| `BOOTSTRAP_ADMIN_EMAIL` | Initial administrator's email. |
| `BOOTSTRAP_ADMIN_PASSWORD` | A unique temporary password of at least 8 characters. |
| `S3_BUCKET` | `trade-activation-photos` |
| `S3_ENDPOINT` | Cloudflare R2 S3 endpoint. |
| `S3_ACCESS_KEY_ID` | R2 Access Key ID. |
| `S3_SECRET_ACCESS_KEY` | R2 Secret Access Key. |

`JWT_SECRET` is generated automatically by Render. `DATABASE_URL` is connected
to the private Render PostgreSQL database automatically. Every deployment runs
the schema migration; the initial deployment seeds only the first administrator.

After deployment, open:

```text
https://<RENDER_SERVICE>.onrender.com/api/health
```

The response must show `ok: true`, `database: "up"`, `storage: "s3"`, and
`storageWritable: true`.

## 3. Deploy the React site on Vercel

1. In Vercel, choose **Add New → Project** and import the same GitHub repository.
2. Set **Root Directory** to `web`.
3. Vercel should detect Vite. Confirm:

   - Build command: `npm run build`
   - Output directory: `dist`
   - Install command: `npm install`

4. Add the production environment variable:

```text
VITE_API_URL=https://<RENDER_SERVICE>.onrender.com/api
```

5. Deploy. `web/vercel.json` provides SPA deep-link routing.
6. Copy the final `*.vercel.app` URL into Render's `CORS_ORIGIN` and redeploy
   the API if the value used during Blueprint creation was temporary.

## 4. Add custom domains

Recommended layout:

```text
activation.example.com       → Vercel frontend
api-activation.example.com   → Render API
```

1. Add the frontend domain in **Vercel → Project → Settings → Domains** and
   configure the DNS record Vercel provides.
2. Add the API domain in **Render → API service → Settings → Custom Domains**
   and configure its DNS record.
3. Change Vercel's production variable to:

```text
VITE_API_URL=https://api-activation.example.com/api
```

4. Change Render's variable to:

```text
CORS_ORIGIN=https://activation.example.com
```

5. Redeploy both services. Vercel and Render provision HTTPS certificates.

## 5. Production acceptance test

1. Confirm `/api/health` is fully healthy.
2. Log in as the bootstrap administrator.
3. Reset the temporary administrator password from **Data → Edit**.
4. Upload the production target CSV.
5. Create one manager and let that manager create one field user.
6. On a real phone over mobile data, submit an activation with an installed
   asset, camera photo and device GPS.
7. Confirm the assigned manager can review it and the admin sees it read-only.
8. Confirm the photo opens after signing out and back in.

## 6. Backups and operations

- Use a paid Render PostgreSQL plan with point-in-time recovery.
- Export a logical database backup at least weekly for longer retention.
- Keep the R2 bucket private and restrict its API token to this one bucket.
- Rotate database, JWT and R2 credentials when access changes.
- Configure uptime monitoring against `/api/health`.
- Test restoring the database and a sample photo at least quarterly.

## Clean production data

Start with the newly seeded production database. Do not copy the local database
or `server/uploads`; the local environment contains QA users and test records.
