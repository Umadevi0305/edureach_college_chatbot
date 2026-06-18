# Deploying EduReach to AWS

A complete, step-by-step guide to deploy this project on AWS:

- **Frontend** (`/client`, React 19 + Vite) → **Amazon S3 + Amazon CloudFront**
- **Backend** (`/server`, Node.js 24 + Express 5) → **Amazon EC2** (Node + PM2 + Nginx)

Every step below is based on current official AWS documentation (links in [Sources](#sources)). Read the [Architecture](#1-architecture--why-this-design) section first — it explains *why* the backend is placed behind CloudFront, which is what makes the whole thing work without buying a domain.

---

## Table of contents

1. [Architecture & why this design](#1-architecture--why-this-design)
2. [Prerequisites](#2-prerequisites)
3. [Required code changes before you deploy](#3-required-code-changes-before-you-deploy)
4. [Part A — Deploy the backend on EC2](#part-a--deploy-the-backend-on-ec2)
5. [Part B — Deploy the frontend to S3](#part-b--deploy-the-frontend-to-s3)
6. [Part C — Create the CloudFront distribution (the glue)](#part-c--create-the-cloudfront-distribution-the-glue)
7. [Part D — (Optional) Custom domain + HTTPS](#part-d--optional-custom-domain--https)
8. [Part E — Verify the deployment](#part-e--verify-the-deployment)
9. [Updating / redeploying later](#updating--redeploying-later)
10. [Cost estimate](#cost-estimate)
11. [Security hardening checklist](#security-hardening-checklist)
12. [Troubleshooting](#troubleshooting)
13. [Sources](#sources)

---

## 1. Architecture & why this design

```
                                  ┌──────────────────────────────────────┐
                                  │            Amazon CloudFront           │
   Browser  ──── HTTPS ───────▶   │  (single distribution, *.cloudfront.net)│
   (your users)                   │                                        │
                                  │   Default behavior  "/*"   ──────────┐ │
                                  │   API behavior      "/api/*" ──────┐ │ │
                                  └────────────────────────────────────┼─┼─┘
                                                                        │ │
                            ┌───────────────────────────────────────┐  │ │
                            │  Origin 2: EC2 backend (HTTP, port 80) │◀─┘ │   /api/* → Express
                            │  Node 24 + Express + PM2 + Nginx       │    │
                            └───────────────────────────────────────┘    │
                                                                          │
                            ┌───────────────────────────────────────┐    │
                            │  Origin 1: S3 bucket (private, OAC)    │◀───┘   /*  → React static files
                            │  React build output (dist/)            │
                            └───────────────────────────────────────┘

   Backend also calls out to:  ▸ MongoDB Atlas (Vector Search)   ▸ Google Gemini API
```

**Why route the API through CloudFront instead of giving the backend its own public URL?**

- CloudFront serves your site over **HTTPS**. A browser on an HTTPS page is **not allowed to call a plain `http://` API** ("mixed content" — the request is silently blocked). So the backend *must* be reachable over HTTPS.
- Getting HTTPS directly on EC2 normally means: buy a domain → request an ACM/Let's Encrypt certificate → put a load balancer in front. That's a lot of extra cost and setup.
- Instead, we add the EC2 backend as a **second origin** on the same CloudFront distribution under the path `/api/*`. The browser only ever talks to **CloudFront (HTTPS)**; CloudFront forwards `/api/*` requests to EC2 over HTTP internally. Result:
  - ✅ Backend is reachable over HTTPS with **no domain and no certificate to manage**.
  - ✅ Frontend and API share the **same origin**, so **CORS disappears** entirely.
  - ✅ One URL for everything.

> **Note on MongoDB & Gemini:** These stay exactly where they are. MongoDB **Atlas Vector Search is Atlas-specific** (it cannot be replaced by AWS DocumentDB), so keep using your existing Atlas cluster. The Gemini API is called server-side with your `GOOGLE_API_KEY`. Neither needs to move to AWS.

**Alternatives** (not used here, mentioned for completeness): AWS Elastic Beanstalk or Amazon ECS (Express Mode) for the backend. Both are heavier and, to get HTTPS, still effectively need a custom domain + ACM certificate. They're worth revisiting only when you outgrow a single EC2 instance — see [Sources](#sources).

---

## 2. Prerequisites

- An **AWS account** with administrator (or sufficient) IAM permissions.
- **AWS CLI v2** installed and configured locally (`aws configure`) — used for S3 upload and CloudFront invalidation. [Install guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
- **Node.js 24** and **npm** locally (to build the frontend).
- An **SSH key pair** in the AWS region you'll use (created in Part A, or beforehand in EC2 → Key Pairs).
- Your **secrets ready** (currently in `server/.env`):
  - `MONGODB_URI` — your MongoDB Atlas connection string
  - `GOOGLE_API_KEY` — your Google Gemini API key
- A decision on **AWS region** — this guide uses `ap-south-1` (Mumbai) in examples. Use whichever is closest to your users; keep S3 and EC2 in the **same region**.

> ⚠️ **Never commit `.env` or your keys to Git or bake them into the frontend build.** They live only on the EC2 server.

---

## 3. Required code changes before you deploy

There is exactly **one** code change you must make, plus one tiny robustness tweak. Do these locally and commit them.

### 3.1 Point the frontend at a relative `/api` path (required)

The frontend currently hardcodes the backend URL to `localhost`. Because the API will live under the same CloudFront domain (`/api/*`), change it to a **relative** path.

**File: `client/src/services/api.js`**

```diff
- const BASE_URL = "http://localhost:5000/api";
+ // In production the API is served from the same origin under /api (via CloudFront).
+ // In local dev, set VITE_API_BASE_URL=http://localhost:5000/api in client/.env.local
+ const BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";
```

For **local development**, create `client/.env.local`:

```
VITE_API_BASE_URL=http://localhost:5000/api
```

(Vite only exposes variables prefixed with `VITE_`. `.env.local` is git-ignored by default.)

### 3.2 Make the server listen on all interfaces (recommended)

**File: `server/src/server.js`** — bind to `0.0.0.0` so Nginx/CloudFront can reach it:

```diff
- app.listen(PORT, () => {
+ app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
```

> CORS: with the unified-CloudFront design the frontend and API share an origin, so CORS is not strictly needed. You can leave the existing `cors()` config as-is (harmless). If you later split them onto separate domains, set `CLIENT_URL` to the frontend URL.

---

## Part A — Deploy the backend on EC2

### A1. Launch an EC2 instance

1. AWS Console → **EC2** → **Launch instance**.
2. **Name:** `edureach-backend`.
3. **AMI:** *Amazon Linux 2023* (64-bit x86).
4. **Instance type:** `t3.micro` (or `t2.micro` if free-tier eligible).
5. **Key pair:** create/select an SSH key pair and download the `.pem` file. Keep it safe.
6. **Network settings → Security group** — create a new one named `edureach-backend-sg` with these inbound rules:
   | Type   | Port | Source              | Purpose                          |
   |--------|------|---------------------|----------------------------------|
   | SSH    | 22   | **My IP**           | Your admin access only           |
   | HTTP   | 80   | `0.0.0.0/0`         | CloudFront reaches Nginx → Node  |

   > We lock down direct access to the backend later via a secret header check in Nginx (see [A6](#a6-restrict-direct-access-optional-but-recommended)). For now, port 80 open is fine to get running.
7. **Storage:** 8–16 GB gp3 is plenty.
8. Click **Launch instance**. When it's running, note its **Public IPv4 DNS** (e.g. `ec2-3-110-x-x.ap-south-1.compute.amazonaws.com`) — you'll need it for CloudFront.

> 💡 **Recommended:** allocate an **Elastic IP** (EC2 → Elastic IPs → Allocate → Associate to the instance) so the public DNS doesn't change on reboot.

### A2. Connect and install the runtime

SSH in (adjust path/host):

```bash
chmod 400 edureach-key.pem
ssh -i edureach-key.pem ec2-user@<EC2_PUBLIC_DNS>
```

On the instance, install Node.js 24, git, and nginx:

```bash
# Node.js 24 via NodeSource
curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo bash -
sudo dnf install -y nodejs git nginx

node -v   # should print v24.x
```

### A3. Get the code onto the server

**Option 1 — clone from Git** (if this project is in a repo):

```bash
cd ~
git clone <YOUR_REPO_URL> edureach
cd edureach/server
```

**Option 2 — copy from your machine** (run this *locally*, not on EC2):

```bash
# from the project root on your laptop
rsync -avz -e "ssh -i edureach-key.pem" \
  --exclude node_modules \
  "edureach-agentic-colleage-chatbot/server/" \
  ec2-user@<EC2_PUBLIC_DNS>:/home/ec2-user/edureach/server/
```

Then on the server install production dependencies:

```bash
cd ~/edureach/server
npm ci --omit=dev   # or: npm install --omit=dev
```

### A4. Create the production `.env` on the server

Create `~/edureach/server/.env` (use `nano .env`) with **production** values:

```env
PORT=5000
NODE_ENV=production
MONGODB_URI=<your-mongodb-atlas-connection-string>
GOOGLE_API_KEY=<your-gemini-api-key>
# CLIENT_URL only matters if you later split frontend/backend onto different domains.
CLIENT_URL=https://<your-cloudfront-domain>
```

> Lock the file down: `chmod 600 .env`.

### A5. Run the server with PM2 (keeps it alive + auto-restart on reboot)

```bash
sudo npm install -g pm2
cd ~/edureach/server

# package.json "start" already runs: node --env-file=.env src/server.js
pm2 start npm --name edureach-api -- start

pm2 save
pm2 startup           # run the command it prints (sets up systemd autostart)
pm2 logs edureach-api # watch startup; first run builds the vector index in Atlas
```

The first startup runs `initializeKnowledgeBase()`, which embeds your knowledge base into Atlas — this can take a minute. Wait for `Server running on port 5000`.

Quick local check on the box:

```bash
curl -X POST http://localhost:5000/api/chat/message \
  -H "Content-Type: application/json" \
  -d '{"message":"hello"}'
```

### A6. Put Nginx in front (port 80 → Node 5000)

Create `/etc/nginx/conf.d/edureach.conf`:

```nginx
server {
    listen 80 default_server;
    server_name _;

    # Optional hardening: only allow requests that carry the secret header
    # that CloudFront will add (see Part C, step C8). Uncomment after setting it.
    # if ($http_x_origin_verify != "REPLACE_WITH_LONG_RANDOM_SECRET") {
    #     return 403;
    # }

    location / {
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;   # allow time for RAG/Gemini responses
    }
}
```

Enable and start:

```bash
sudo nginx -t            # test config
sudo systemctl enable --now nginx
sudo systemctl restart nginx
```

### A7. Allow EC2 to reach MongoDB Atlas

In the **MongoDB Atlas** console → your cluster → **Network Access** → **Add IP Address**, add your EC2 instance's **public IP / Elastic IP**. (Avoid `0.0.0.0/0` in production.)

### A8. Verify the backend from the internet

From your laptop:

```bash
curl -X POST http://<EC2_PUBLIC_DNS>/api/chat/message \
  -H "Content-Type: application/json" \
  -d '{"message":"What courses are offered?"}'
```

You should get a JSON response. ✅ Backend is live. Keep `<EC2_PUBLIC_DNS>` handy for Part C.

---

## Part B — Deploy the frontend to S3

### B1. Build the React app locally

```bash
cd "edureach-agentic-colleage-chatbot/client"
npm ci
npm run build      # outputs to client/dist/
```

This produces `client/dist/` containing `index.html` and hashed assets.

### B2. Create a private S3 bucket

> We keep the bucket **private** and serve it only through CloudFront with OAC. This is the AWS-recommended pattern — do **not** enable S3 "static website hosting" / public access.

1. AWS Console → **S3** → **Create bucket**.
2. **Bucket name:** globally unique, e.g. `edureach-frontend-prod-12345` (DNS-compliant).
3. **Region:** same region family as the rest (e.g. `ap-south-1`).
4. **Block Public Access:** leave **ALL blocked ON** (default). ✅
5. Leave other defaults → **Create bucket**.

### B3. Upload the build

Using the CLI (recommended):

```bash
aws s3 sync "edureach-agentic-colleage-chatbot/client/dist/" \
  s3://edureach-frontend-prod-12345/ --delete
```

Or drag-and-drop the **contents of `dist/`** (not the folder itself) into the bucket via the console **Upload** button.

> The CloudFront **bucket policy** that grants read access is added automatically in Part C when you attach OAC — don't add a public bucket policy here.

---

## Part C — Create the CloudFront distribution (the glue)

This is where the frontend (S3) and backend (EC2) are combined under one HTTPS domain.

### C1. Create the distribution with the S3 origin

1. AWS Console → **CloudFront** → **Create distribution**.
2. **Origin domain:** select your S3 bucket (`edureach-frontend-prod-12345.s3.<region>.amazonaws.com`).
   - Pick the bucket from the dropdown; **do not** use the `s3-website` endpoint.
3. **Origin access:** choose **Origin access control settings (recommended)**.
   - Click **Create control setting** → keep defaults (Sign requests) → **Create**.
   - CloudFront will show a banner: *"You must update the S3 bucket policy."* Copy the generated policy — you'll paste it in C2.
4. **Web Application Firewall:** enable AWS WAF if you want (optional, costs extra).
5. **Default root object:** `index.html`
6. **Viewer protocol policy:** **Redirect HTTP to HTTPS**.
7. Leave the rest as defaults for now → **Create distribution**.

### C2. Apply the OAC bucket policy to S3

1. Go to **S3** → your bucket → **Permissions** → **Bucket policy** → **Edit**.
2. Paste the policy CloudFront generated in C1. It looks like this (values filled in for you by CloudFront):

```json
{
  "Version": "2008-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontServicePrincipal",
      "Effect": "Allow",
      "Principal": { "Service": "cloudfront.amazonaws.com" },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::edureach-frontend-prod-12345/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::<ACCOUNT_ID>:distribution/<DISTRIBUTION_ID>"
        }
      }
    }
  ]
}
```

3. **Save changes.** Now only this CloudFront distribution can read the bucket.

### C3. Add SPA routing (custom error responses)

A React Router SPA has client-side routes (e.g. `/chat`) that don't exist as S3 objects. Without this step, refreshing such a route returns 403/404. Fix it:

1. CloudFront → your distribution → **Error pages** tab → **Create custom error response**.
2. Create **two** entries:

   | HTTP error code | Customize error response | Response page path | HTTP Response code |
   |-----------------|--------------------------|--------------------|--------------------|
   | `403`           | Yes                      | `/index.html`      | `200`              |
   | `404`           | Yes                      | `/index.html`      | `200`              |

This makes CloudFront return `index.html` (with a 200) for unknown paths, letting React Router handle them.

### C4. Add the backend (EC2) as a second origin

1. CloudFront → your distribution → **Origins** tab → **Create origin**.
2. **Origin domain:** your EC2 public DNS or Elastic IP DNS, e.g. `ec2-3-110-x-x.ap-south-1.compute.amazonaws.com`.
3. **Protocol:** **HTTP only**.
4. **HTTP port:** `80`.
5. (Optional hardening) **Add custom header:** `X-Origin-Verify` = `<a long random secret>` — used in C8.
6. **Create origin.**

### C5. Add a cache behavior that routes `/api/*` to EC2

1. CloudFront → your distribution → **Behaviors** tab → **Create behavior**.
2. **Path pattern:** `/api/*`
3. **Origin:** select the **EC2 origin** from C4.
4. **Viewer protocol policy:** **Redirect HTTP to HTTPS**.
5. **Allowed HTTP methods:** **GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE** (your API uses POST).
6. **Cache policy:** **CachingDisabled** (managed policy) — API responses must never be cached.
7. **Origin request policy:** **AllViewer** (managed policy) — forwards all headers/query/body to the backend.
8. **Create behavior.**

> Precedence: CloudFront matches the most specific path first. `/api/*` → EC2; everything else falls through to the **Default (`*`)** behavior → S3.

### C6. (If responses are slow) raise the origin timeout

RAG + Gemini can occasionally take a while. CloudFront's default **origin response timeout is 30s** (max 60s for the standard setting). If you see `504` errors:

- Edit the **EC2 origin** → increase **Response timeout** to `60`.
- Also ensure Nginx `proxy_read_timeout` is `60s` (set in A6).

### C7. Wait for deployment & grab your URL

The distribution status goes from **Deploying** to **Enabled** (a few minutes). Your public URL is the **Distribution domain name**, e.g. `https://d111111abcdef8.cloudfront.net`.

### C8. (Optional) Lock the backend so users can't bypass CloudFront

Right now someone could hit `http://<EC2_DNS>/api/...` directly. To force all traffic through CloudFront:

1. In C4 you added header `X-Origin-Verify: <secret>`.
2. On EC2, uncomment the `if ($http_x_origin_verify != "...")` block in `/etc/nginx/conf.d/edureach.conf`, set the same secret, and `sudo systemctl restart nginx`.

Now requests without the secret header get `403`. (For stronger isolation, consider **CloudFront VPC origins** so EC2 lives in a private subnet — see [Sources](#sources).)

---

## Part D — (Optional) Custom domain + HTTPS

You do **not** need this — the `*.cloudfront.net` URL already has valid HTTPS. Do this only if you want `app.yourcollege.edu`.

1. **Request a certificate in ACM** — in region **`us-east-1`** (CloudFront only uses certs from N. Virginia), for your domain (e.g. `app.yourcollege.edu`). Validate via DNS.
2. **CloudFront** → distribution → **General** → **Edit** → add the domain under **Alternate domain names (CNAME)** and select the ACM certificate.
3. **DNS** → in Route 53 (or your DNS provider), create a record (Route 53: an **A / Alias** record) pointing your domain to the CloudFront distribution domain name.
4. Wait for DNS propagation, then browse to your domain.

---

## Part E — Verify the deployment

1. Open `https://<your-cloudfront-domain>` in a browser → the EduReach UI loads over HTTPS. ✅
2. Open DevTools → **Network**. Send a chat message. You should see a `POST` to `/api/chat/message` returning `200` with a JSON answer. ✅
3. Hard-refresh on a sub-route (if any) → no 404. ✅
4. Confirm **no mixed-content or CORS errors** in the console. ✅

---

## Updating / redeploying later

**Frontend** (after code changes):

```bash
cd client && npm run build
aws s3 sync dist/ s3://edureach-frontend-prod-12345/ --delete

# Invalidate the CloudFront cache so users get the new files immediately:
aws cloudfront create-invalidation \
  --distribution-id <DISTRIBUTION_ID> --paths "/*"
```

**Backend** (after code changes):

```bash
ssh -i edureach-key.pem ec2-user@<EC2_PUBLIC_DNS>
cd ~/edureach/server
git pull                 # or rsync again from your laptop
npm ci --omit=dev
pm2 restart edureach-api
```

---

## Cost estimate

Rough monthly cost for low/moderate traffic (prices vary by region — check the [AWS Pricing Calculator](https://calculator.aws/)):

| Service          | Notes                                              | Approx. cost            |
|------------------|----------------------------------------------------|-------------------------|
| EC2 `t3.micro`   | Always-on backend                                  | ~$7–9/mo (free 1st yr*) |
| Elastic IP       | Free while attached to a running instance          | $0                      |
| S3               | A few MB of static files + requests                | < $1/mo                 |
| CloudFront       | Generous free tier; pay per GB + requests after    | ~$0–few $/mo            |
| MongoDB Atlas    | Your existing cluster (M0 free tier works)         | $0+ (external)          |
| Google Gemini    | Per API usage                                      | usage-based (external)  |

\* Free tier covers 750 hrs/month of `t2.micro`/`t3.micro` for the first 12 months on new accounts.

---

## Security hardening checklist

- [ ] SSH (port 22) restricted to **your IP**, not `0.0.0.0/0`.
- [ ] `.env` is `chmod 600`, never committed, never in the frontend bundle.
- [ ] MongoDB Atlas Network Access allowlists **only** the EC2 IP (not `0.0.0.0/0`).
- [ ] Backend locked behind the CloudFront secret header (C8), or behind a VPC origin.
- [ ] S3 bucket has **Block Public Access ON** and is readable only via the OAC bucket policy.
- [ ] Consider attaching **AWS WAF** to CloudFront for rate-limiting / bot protection.
- [ ] Rotate `GOOGLE_API_KEY` if it was ever committed; restrict the key in Google Cloud.
- [ ] Keep the OS patched: `sudo dnf update -y` periodically.

---

## Troubleshooting

| Symptom | Likely cause & fix |
|---|---|
| Console: *"Mixed Content: ... was loaded over HTTPS but requested an insecure resource http://localhost:5000"* | The frontend was built before the code change in [§3.1](#31-point-the-frontend-at-a-relative-api-path-required). Rebuild and re-sync to S3. |
| `403` when loading the site | OAC bucket policy not applied ([C2](#c2-apply-the-oac-bucket-policy-to-s3)), or build files weren't uploaded to the **bucket root**. |
| `404` / blank page on refreshing a route | Custom error responses ([C3](#c3-add-spa-routing-custom-error-responses)) not configured. |
| `POST /api/...` returns `403` | The CloudFront secret-header check (C8) is on but the header/secret doesn't match, or you're hitting EC2 directly. |
| `/api/*` returns `502`/`503` | Backend not running (`pm2 status`), Nginx down (`systemctl status nginx`), or security group port 80 closed. |
| `/api/*` returns `504` | RAG/Gemini slower than the timeout. Raise CloudFront origin **Response timeout** to 60s and Nginx `proxy_read_timeout` to 60s ([C6](#c6-if-responses-are-slow-raise-the-origin-timeout)). |
| Backend logs: Mongo connection/timeout | EC2 IP not allowlisted in Atlas Network Access ([A7](#a7-allow-ec2-to-reach-mongodb-atlas)), or wrong `MONGODB_URI`. |
| Frontend changes not showing | CloudFront cached old files — run a cache **invalidation** (see [Updating](#updating--redeploying-later)). |

---

## Sources

Official AWS documentation used for this guide:

- [Restrict access to an Amazon S3 origin (Origin Access Control)](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)
- [Get started with a CloudFront standard distribution](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/GettingStarted.SimpleDistribution.html)
- [Use various origins with CloudFront distributions (S3, EC2/custom origins, ALB)](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistS3AndCustomOrigins.html)
- [Deploy a React-based single-page application to Amazon S3 and CloudFront (AWS Prescriptive Guidance)](https://docs.aws.amazon.com/prescriptive-guidance/latest/patterns/deploy-a-react-based-single-page-application-to-amazon-s3-and-cloudfront.html)
- [Generate custom error responses (SPA routing)](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/GeneratingCustomErrorResponses.html)
- [Specify a default root object](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DefaultRootObject.html)
- [Restrict access with CloudFront VPC origins](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html)
- [Using HTTPS with CloudFront](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-https.html)
- [AWS CLI install guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)

Backend alternatives (for when you outgrow a single EC2 instance):

- [Deploying a Node.js Express application to Elastic Beanstalk](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/create_deploy_nodejs_express.html)
- [Configuring HTTPS for your Elastic Beanstalk environment](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/configuring-https.html)
- [AWS App Runner availability change (closed to new customers → use Amazon ECS Express Mode)](https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html)
