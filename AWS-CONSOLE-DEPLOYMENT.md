# Deploying EduReach to AWS — Console-Only Guide (No AWS CLI)

This guide deploys the project using **only the AWS web console** — no AWS CLI, no local SSH client.

- **Session 1 — Frontend** (`/client`, React 19 + Vite) → **Amazon S3 + Amazon CloudFront**
- **Session 2 — Backend** (`/server`, Node.js 24 + Express 5) → **Amazon EC2** (Node + PM2 + Nginx), wired into the *same* CloudFront distribution under `/api/*`

> Why this design: CloudFront gives you free, valid **HTTPS** on a `*.cloudfront.net` URL. We put the React site on CloudFront, and we add the EC2 backend as a **second origin** on the *same* distribution under the path `/api/*`. The browser only ever talks to CloudFront over HTTPS — so there's **no domain to buy, no certificate to manage, and no CORS problems**. MongoDB Atlas and Google Gemini stay exactly where they are (they're called from the server).

> **Order note (read this):** We deploy the **frontend first**. After Session 1 your website will load over HTTPS, but the **chatbot will not answer yet** — that's expected. The chat starts working at the end of Session 2, once the backend exists and we route `/api/*` to it and clear the CloudFront cache.

---

## Table of contents

- [Deploying EduReach to AWS — Console-Only Guide (No AWS CLI)](#deploying-edureach-to-aws--console-only-guide-no-aws-cli)
  - [Table of contents](#table-of-contents)
  - [0. Before you start](#0-before-you-start)
  - [1. Create your AWS account](#1-create-your-aws-account)
  - [2. One required code change](#2-one-required-code-change)
- [SESSION 1 — Deploy the FRONTEND](#session-1--deploy-the-frontend)
    - [1A. Build the React app locally](#1a-build-the-react-app-locally)
    - [1B. Create a private S3 bucket](#1b-create-a-private-s3-bucket)
    - [1C. Upload the build (drag \& drop)](#1c-upload-the-build-drag--drop)
    - [1D. Create the CloudFront distribution + OAC](#1d-create-the-cloudfront-distribution--oac)
    - [1E. Apply the OAC bucket policy to S3](#1e-apply-the-oac-bucket-policy-to-s3)
    - [1F. Add SPA routing (custom error responses)](#1f-add-spa-routing-custom-error-responses)
    - [1G. Get your URL and test the site loads](#1g-get-your-url-and-test-the-site-loads)
- [SESSION 2 — Deploy the BACKEND](#session-2--deploy-the-backend)
    - [2A. Launch an EC2 instance](#2a-launch-an-ec2-instance)
    - [2B. Connect via EC2 Instance Connect (browser)](#2b-connect-via-ec2-instance-connect-browser)
    - [2C. Install Node 24, git, nginx](#2c-install-node-24-git-nginx)
    - [2D. Get the code onto the server](#2d-get-the-code-onto-the-server)
    - [2E. Create the production .env](#2e-create-the-production-env)
    - [2F. Run the server with PM2](#2f-run-the-server-with-pm2)
    - [2G. Put Nginx in front (port 80 → 5000)](#2g-put-nginx-in-front-port-80--5000)
    - [2H. Allow EC2 to reach MongoDB Atlas](#2h-allow-ec2-to-reach-mongodb-atlas)
    - [2I. Add EC2 as a second CloudFront origin](#2i-add-ec2-as-a-second-cloudfront-origin)
    - [2J. Route /api/\* to EC2 (cache behavior)](#2j-route-api-to-ec2-cache-behavior)
    - [2K. Invalidate the cache and verify everything](#2k-invalidate-the-cache-and-verify-everything)
  - [Optional hardening](#optional-hardening)
  - [Updating later (no CLI)](#updating-later-no-cli)
  - [Cost estimate](#cost-estimate)
  - [Troubleshooting](#troubleshooting)
  - [Sources](#sources)

---

## 0. Before you start

Have these ready:

- A **credit/debit card**, a **phone number**, and an **email address** (AWS requires a card for verification even on the free plan).
- **Node.js 24 + npm** installed on your computer (only to build the frontend once).
- Your **secrets** (they currently live in `server/.env`):
  - `MONGODB_URI` — your MongoDB Atlas connection string
  - `GOOGLE_API_KEY` — your Google Gemini API key
- Pick **one AWS region** and use it for everything — this guide uses **`ap-south-1` (Mumbai)** in examples. Keep S3 and EC2 in the **same region**.
- A **GitHub account** (recommended) — the easy no-CLI way to get the backend code onto EC2 is to push the project to a private GitHub repo and `git clone` it from the in-browser terminal.

> ⚠️ Never commit `.env` or your API keys to Git, and never put them in the frontend build. The keys live only on the EC2 server.

---

## 1. Create your AWS account

> AWS changed its Free Tier on **July 15, 2025**. New accounts now get a **Free Plan**: up to **$200 in credits** ($100 at sign-up + up to $100 more for using key services), valid for **6 months** or until credits run out. New-account EC2 covers `t3.micro` (and a few other small types) within those credits. (Older "12-month / 750-hours" free tier applies only to accounts created before that date.)

1. Go to **https://aws.amazon.com/** → **Create an AWS Account**.
2. Enter your **root user email** and an **AWS account name** → verify the email with the code AWS sends.
3. Create a strong **root password** (8+ chars, upper/lower/number/symbol).
4. Choose **Personal** account type → fill in name, phone, country, address.
5. Add your **payment method** (card) and verify the billing address.
6. **Phone / identity verification** — AWS verifies you via SMS/voice code and/or a document check. **The exact order varies by country and may not appear as a separate step** — in India it's often covered by the card OTP and the Aadhaar/DigiLocker step (next), or it shows up at step 5. If a phone-code screen appears, enter the code; if it doesn't, that's normal — just continue.
7. **Confirm your identity** (a "step 4 of 5" screen titled *Confirm your identity*). For a personal project under your own name and card:
   - **Primary purpose of account registration:** **Personal use** (don't pick Business — that asks for tax/company details you don't need).
   - **Ownership type:** **Individual** (you personally own the account).
   - **India accounts — document verification:** AWS requires identity verification here. Under **India document type**, choose **Aadhaar**. Click the link to the **DigiLocker** portal and complete Aadhaar verification there (on DigiLocker, select **Aadhaar** as the document type and authenticate with your Aadhaar number + OTP).
   - **Name:** pick the name for verification — it **must exactly match the name on your Aadhaar** (e.g. `Mandala Uma Devi`). A mismatch will fail verification.
   - **Tick** the consent box ("I consent to allowing AWS to use and send the information above to a third-party service for identity verification") — it's required to continue; it's a standard identity-verification (KYC) step.
   - The exact wording and document options vary by country — the rule is: the account is *yours, for personal projects, not a company's* → choose the **Personal / Individual** options everywhere, and use a government ID whose name matches the account name.
8. Choose the **Basic support — Free** plan.
9. Activation usually takes a few minutes (up to 24 hours). You'll get a confirmation email.

After sign-in:

- Sign in as **Root user**. In the top-right region selector, choose your region (e.g. **Asia Pacific (Mumbai) `ap-south-1`**) and use it consistently.
- **Recommended — turn on MFA for the root user** (strongly advised, since root can do anything in the account). Steps:
  1. Top-right **account menu** → **Security credentials** → under **Multi-factor authentication (MFA)** → **Assign MFA device**.
  2. **Step 1 – Select MFA device:** give it a **Device name** (e.g. `Shiro`), then choose a device type:
     - **Passkey or security key** — fingerprint/face/screen-lock or a FIDO2 key. AWS recommends this as the most phishing-resistant option.
     - **Authenticator app** — a code-generating app (**Google Authenticator**, **Duo Mobile**, **Authy**, or **Microsoft Authenticator**) on your phone/computer. Easiest if you don't have a hardware key — pick this.
     - **Hardware TOTP token** — a physical code-generating token.
     - Click **Next**.
  3. **Step 2 – Set up device (Authenticator app):**
     - Install one of the apps above on your phone.
     - On the AWS page click **Show QR code**, then in the app scan it (or use **Show secret key** to type it manually).
     - Enter **two consecutive codes** the app generates: type the first code, **wait ~30 seconds** for the app to refresh, then type the second.
     - Click **Add MFA**.
  4. You'll now be asked for a code from this app each time you sign in as root. **Keep the authenticator app safe** — losing it means account-recovery hassle.
- **Recommended:** set a **billing alert** so you're warned before spending: search **Billing and Cost Management** → **Budgets** → create a small monthly cost budget.

---

## 2. One required code change

The frontend currently hardcodes the backend URL to `localhost`. Because the API will live under the **same** CloudFront domain at `/api/*`, change it to a **relative** path so it works in production.

**File: `client/src/services/api.js`**

```diff
- const BASE_URL = "http://localhost:5000/api";
+ // In production the API is served from the same origin under /api (via CloudFront).
+ // In local dev, set VITE_API_BASE_URL=http://localhost:5000/api in client/.env.local
+ const BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";
```

For **local development** (so the app still works on your machine), create `client/.env.local`:

```
VITE_API_BASE_URL=http://localhost:5000/api
```

> Vite only exposes variables prefixed with `VITE_`. `.env.local` is git-ignored by default — good.

Save the change. Now build in Session 1.

---

# SESSION 1 — Deploy the FRONTEND

End state of this session: your React site is live on a `https://xxxx.cloudfront.net` URL. (The chat won't answer until Session 2.)

### 1A. Build the React app locally

On your computer, in a terminal:

```bash
cd "edureach-agentic-colleage-chatbot/client"
npm ci
npm run build      # outputs the finished site to client/dist/
```

You now have a `client/dist/` folder containing `index.html` plus an `assets/` folder. **This folder is what we upload.**

### 1B. Create a private S3 bucket

> We keep the bucket **private** and serve it only through CloudFront. Do **not** turn on "Static website hosting" and do **not** make it public — CloudFront + OAC is the AWS-recommended, secure pattern.

1. Console → search **S3** → **Create bucket**.
2. **Bucket name:** must be globally unique, e.g. `edureach-frontend-prod-12345` (lowercase, no spaces).
3. **Region:** your chosen region (e.g. `ap-south-1`).
4. **Block Public Access:** leave **all four boxes checked (Block all)** — the default. ✅
5. Leave everything else default → **Create bucket**.

### 1C. Upload the build (drag & drop)

1. Click your new bucket → **Upload**.
2. Open `client/dist/` on your computer. **Select the *contents* of `dist/`** — i.e. `index.html` **and** the `assets` folder — and **drag them into the Upload page**. (Drag the *contents*, not the `dist` folder itself, so `index.html` lands at the bucket root.)
   - Use **Add files** for `index.html` and **Add folder** for `assets/` if drag-and-drop is awkward.
3. Click **Upload**. Wait for "Upload succeeded".

Confirm the bucket root now shows `index.html` and `assets/`.

### 1D. Create the CloudFront distribution + OAC (new wizard)

AWS updated the CloudFront console to a guided **"Single website or app"** wizard that creates the OAC **and updates the S3 bucket policy for you automatically** — so there's no manual policy paste anymore. Follow the screens in order:

1. Console → search **CloudFront** → open it → **Create distribution**.
2. **Distribution name:** type something like `edureach`. Click **Next**.
3. Choose **Single website or app** → **Next**. (Then **Next** again if a brief intro screen shows.)
4. **Origin type** page → select **Amazon S3**.
5. **S3 origin** → click **Browse S3** → select your bucket (`edureach-frontend-prod-12345`).
6. **Settings** → choose **Use recommended origin settings**. This automatically sets up **Origin Access Control (OAC)** and the secure, recommended cache settings. Click **Next**.
7. **Enable security protections** page → choose **Do not enable security protections** (AWS WAF adds a monthly cost — you can enable it later). Click **Next**.
8. Review, then click **Create distribution**. **CloudFront updates the S3 bucket policy for you** — you'll see the bucket policy applied automatically.

### 1E. Verify the bucket policy was applied (no manual paste needed)

With the new wizard, CloudFront writes the OAC bucket policy itself. Just confirm it's there:

1. Console → **S3** → your bucket → **Permissions** tab → scroll to **Bucket policy**.
2. You should see a policy granting `cloudfront.amazonaws.com` `s3:GetObject`, restricted to your distribution. It looks like this:

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

3. If for some reason it's **empty** (older console, or you used the classic wizard), add it manually: CloudFront → your distribution → **Origins** → select the S3 origin → **Edit** → under Origin access there's a **Copy policy** button → paste it into S3 → **Bucket policy** → **Edit** → **Save changes**.

### 1E-2. Set the default root object to `index.html`

So that visiting the bare CloudFront URL loads your app:

1. CloudFront → your distribution → **General** tab (or **Settings**) → **Edit**.
2. Set **Default root object** to `index.html` → **Save changes**. (The "Single website or app" preset usually sets this already — confirm it's `index.html`.)

### 1F. Add SPA routing (custom error responses)

A React Router app has client-side routes that don't exist as real files in S3. Without this, a refresh on such a path returns 403/404. Fix it:

1. CloudFront → your distribution → **Error pages** tab → **Create custom error response**. Create **two** entries:

   | HTTP error code | Customize error response | Response page path | HTTP Response code |
   |-----------------|--------------------------|--------------------|--------------------|
   | `403`           | Yes                      | `/index.html`      | `200`              |
   | `404`           | Yes                      | `/index.html`      | `200`              |

This makes CloudFront serve `index.html` (with status 200) for unknown paths, so React Router can handle them.

### 1G. Get your URL and test the site loads

1. CloudFront → your distribution. Wait until **Last modified** shows **Enabled** / deployment finishes (a few minutes).
2. Copy the **Distribution domain name**, e.g. `https://d111111abcdef8.cloudfront.net`.
3. Open it in a browser → **the EduReach site should load over HTTPS.** ✅

> The chatbot will throw a network error if you try it now — that's expected. It comes alive at the end of Session 2. **Keep this CloudFront tab handy** — in Session 2 you add a second origin to *this same distribution*.

---

# SESSION 2 — Deploy the BACKEND

End state: an EC2 server runs the Node API behind Nginx; CloudFront routes `/api/*` to it; the chatbot works on your CloudFront URL.

### 2A. Launch an EC2 instance

1. Console → search **EC2** → **Launch instance**.
2. **Name:** `edureach-backend`.
3. **AMI:** **Amazon Linux 2023** (64-bit x86). *(EC2 Instance Connect works out-of-the-box on this AMI.)*
4. **Instance type:** `t3.micro`.
5. **Key pair (login):** you can select **Proceed without a key pair** — we'll use the browser-based **EC2 Instance Connect** instead. (Creating a key pair is also fine; it's just not required here.)
6. **Network settings → Edit → Create security group** named `edureach-backend-sg` with these inbound rules:

   | Type | Port | Source                                              | Purpose                          |
   |------|------|-----------------------------------------------------|----------------------------------|
   | SSH  | 22   | **EC2 Instance Connect prefix list** (see note)     | Browser SSH (EC2 Instance Connect) |
   | HTTP | 80   | `0.0.0.0/0` (Anywhere-IPv4)                          | CloudFront reaches Nginx → Node  |

   > ⚠️ **Important — the SSH source is NOT "My IP".** Browser-based EC2 Instance Connect connects *from AWS's own service IPs*, not from your laptop, so "My IP" will fail with *"port 22 not authorized"*. For the SSH rule's **Source**, choose **Custom** and start typing `com.amazonaws.` — select the managed prefix list **`com.amazonaws.<your-region>.ec2-instance-connect`** (e.g. `com.amazonaws.ap-south-1.ec2-instance-connect`). That allowlists exactly the EC2 Instance Connect range for your region.
   >
   > Simpler alternative to just get going: set the SSH source to **Anywhere `0.0.0.0/0`** (it includes the Instance Connect range). It's less tight on security — lock it down to the prefix list afterwards.
7. **Configure storage:** 8–16 GB **gp3** is plenty.
8. **Launch instance.** Open the instance, wait for **Instance state = Running** and **Status checks = 2/2**.
9. Note the **Public IPv4 DNS** (e.g. `ec2-3-110-x-x.ap-south-1.compute.amazonaws.com`) — you'll need it for CloudFront in step 2I.

> 💡 **Recommended:** allocate an **Elastic IP** so the address survives reboots: EC2 → **Elastic IPs** → **Allocate Elastic IP address** → select it → **Actions → Associate** → choose your instance. Use the Elastic IP's DNS for CloudFront.

### 2B. Connect via EC2 Instance Connect (browser)

No SSH client or `.pem` file needed:

1. EC2 → **Instances** → select `edureach-backend` → **Connect** (top button).
2. Choose the **EC2 Instance Connect** tab → username stays `ec2-user` → **Connect**.
3. A black terminal opens **in your browser**. You're now on the server.

### 2C. Install Node 24, git, nginx

In the browser terminal:

```bash
# Node.js 24 via NodeSource (gives standard `node` / `npm` commands)
curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo bash -
sudo dnf install -y nodejs git nginx

node -v   # should print v24.x
npm -v
```

> **Alternative (native AL2023 package):** Amazon Linux 2023 also ships Node via `sudo dnf install -y nodejs24 git nginx`. AL2023 namespaces the binaries (`node-24`/`npm-24`), which can confuse tools expecting plain `node`. The NodeSource method above is more predictable for this project — prefer it. If `node -v` doesn't print `v24.x`, re-run the NodeSource step.

### 2D. Get the code onto the server

**Recommended — clone from Git** (push your project to a **private GitHub repo** first, from your laptop):

```bash
cd ~
git clone <YOUR_REPO_URL> edureach
cd edureach/server
npm ci --omit=dev        # install production dependencies only
```

> For a private repo, GitHub will prompt for credentials — use a **Personal Access Token** as the password, or make the repo public temporarily just for the clone.

> **Make sure `server/knowledge-base/` is included in the repo** — the server embeds those files into Atlas on first start.

**Alternative — no Git:** paste files manually. In the browser terminal create the folders and use `nano` to create each file, or zip the `server/` folder locally, upload the zip to your S3 bucket, make that one object temporarily downloadable, `curl` it down, and `unzip`. Git is far simpler — prefer it.

### 2E. Create the production .env

```bash
cd ~/edureach/server
nano .env
```

Paste your **production** values:

```env
PORT=5000
NODE_ENV=production
MONGODB_URI=<your-mongodb-atlas-connection-string>
GOOGLE_API_KEY=<your-gemini-api-key>
# Only matters if you ever split frontend/backend onto different domains:
CLIENT_URL=https://<your-cloudfront-domain>
```

Save in nano: `Ctrl+O`, `Enter`, then `Ctrl+X`. Lock the file down:

```bash
chmod 600 .env
```

### 2F. Run the server with PM2

PM2 keeps the app running and restarts it on reboot:

```bash
sudo npm install -g pm2
cd ~/edureach/server

# package.json "start" runs: node --env-file=.env src/server.js
pm2 start npm --name edureach-api -- start

pm2 save
pm2 startup        # run the exact command it prints back to you
pm2 logs edureach-api
```

On first start the server runs `initializeKnowledgeBase()`, which embeds your knowledge base into Atlas — this can take a minute. Wait for **`Server running on port 5000`**, then press `Ctrl+C` to stop tailing logs (the app keeps running).

Quick check on the box:

```bash
curl -X POST http://localhost:5000/api/chat/message \
  -H "Content-Type: application/json" \
  -d '{"message":"hello"}'
```

You should get a JSON answer.

### 2G. Put Nginx in front (port 80 → 5000)

```bash
sudo nano /etc/nginx/conf.d/edureach.conf
```

Paste:

```nginx
server {
    listen 80 default_server;
    server_name _;

    # Optional hardening (see "Optional hardening"): only allow requests
    # carrying the secret header CloudFront adds. Uncomment after you set it.
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
        proxy_read_timeout 60s;   # RAG + Gemini can be slow
    }
}
```

Save, then:

```bash
sudo nginx -t                        # test config — should say "ok" / "successful"
sudo systemctl enable --now nginx
sudo systemctl restart nginx
```

Test from your laptop browser/terminal (replace with your DNS):

```bash
curl -X POST http://<EC2_PUBLIC_DNS>/api/chat/message \
  -H "Content-Type: application/json" \
  -d '{"message":"What courses are offered?"}'
```

A JSON response = backend is reachable from the internet. ✅

### 2H. Allow EC2 to reach MongoDB Atlas

1. In **MongoDB Atlas** → your cluster → **Network Access** → **Add IP Address**.
2. Add your EC2 instance's **public IP / Elastic IP**. (Avoid `0.0.0.0/0` in production.)
3. If the server logs showed a Mongo timeout earlier, do this, then `pm2 restart edureach-api` on the server.

### 2I. Add EC2 as a second CloudFront origin

Go back to the **same** CloudFront distribution from Session 1.

1. CloudFront → your distribution → **Origins** tab → **Create origin**.
2. **Origin domain:** your EC2 **Public IPv4 DNS** or Elastic IP DNS (e.g. `ec2-3-110-x-x.ap-south-1.compute.amazonaws.com`).
3. **Protocol:** **HTTP only**.
4. **HTTP port:** `80`.
5. *(Optional hardening)* **Add custom header:** name `X-Origin-Verify`, value = a long random secret — used in [Optional hardening](#optional-hardening).
6. **Create origin.**

### 2J. Route /api/* to EC2 (cache behavior)

1. CloudFront → your distribution → **Behaviors** tab → **Create behavior**.
2. **Path pattern:** `/api/*`
3. **Origin and origin groups:** select the **EC2 origin** you just created.
4. **Viewer protocol policy:** **Redirect HTTP to HTTPS**.
5. **Allowed HTTP methods:** **GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE** (the API uses POST).
6. **Cache policy:** **CachingDisabled** (managed) — API responses must never be cached.
7. **Origin request policy:** **AllViewer** (managed) — forwards headers/query/body to the backend.
8. **Create behavior.**

> CloudFront matches the most specific path first: `/api/*` → EC2; everything else falls through to the **Default (`*`)** behavior → S3.

> **If `/api/*` returns `504` later:** RAG/Gemini was slower than the timeout. Edit the **EC2 origin** → raise **Response timeout** to `60`, and confirm Nginx `proxy_read_timeout 60s` (set in 2G).

### 2K. Invalidate the cache and verify everything

Clear CloudFront's cache so browsers fetch the freshly-wired setup (console, no CLI):

1. CloudFront → your distribution → **Invalidations** tab → **Create invalidation**.
2. **Object paths:** type `/*` → **Create invalidation**. Wait until it shows **Completed**.

Now verify on your `https://<your-cloudfront-domain>` URL:

1. The EduReach site loads over HTTPS. ✅
2. Open **DevTools → Network**, send a chat message → you see a `POST` to `/api/chat/message` returning **200** with a JSON answer. ✅
3. Hard-refresh on any sub-route → no 404. ✅
4. No **mixed-content** or **CORS** errors in the console. ✅

🎉 Done — frontend and backend are both live behind one HTTPS URL.

---

## Optional hardening

Right now someone could hit `http://<EC2_DNS>/api/...` directly, bypassing CloudFront. To force all traffic through CloudFront:

1. In step 2I you added header `X-Origin-Verify: <secret>` on the EC2 origin.
2. On the server, edit `/etc/nginx/conf.d/edureach.conf`, **uncomment** the `if ($http_x_origin_verify != "...")` block, set the **same** secret, then `sudo systemctl restart nginx`.

Now requests without the secret header get `403`. For stronger isolation, consider **CloudFront VPC origins** (EC2 in a private subnet).

Also recommended:
- SSH (port 22) restricted to your IP, not `0.0.0.0/0`.
- MongoDB Atlas Network Access allowlists only the EC2 IP.
- S3 **Block Public Access ON**; bucket readable only via the OAC policy.
- Keep the OS p
  
  atched: `sudo dnf update -y` periodically.
- Restrict / rotate your `GOOGLE_API_KEY` in Google Cloud.

---

## Updating later (no CLI)

**Frontend** (after code changes):
1. `cd client && npm run build`.
2. S3 → your bucket → **Upload** → drag in the new contents of `dist/` (overwrites existing) → **Upload**.
3. CloudFront → **Invalidations** → **Create invalidation** → `/*`.

**Backend** (after code changes):
1. EC2 → **Connect** (Instance Connect).
2. `cd ~/edureach/server && git pull && npm ci --omit=dev && pm2 restart edureach-api`.

---

## Cost estimate

Rough monthly cost for low/moderate traffic (use the [AWS Pricing Calculator](https://calculator.aws/) for your region):

| Service        | Notes                                                  | Approx. cost                |
|----------------|--------------------------------------------------------|-----------------------------|
| EC2 `t3.micro` | Always-on backend                                      | ~$7–9/mo (covered by credits early on) |
| Elastic IP     | Free while attached to a running instance              | $0                          |
| S3             | A few MB of static files + requests                    | < $1/mo                     |
| CloudFront     | Generous free allowance; pay per GB + requests after   | ~$0–few $/mo                |
| MongoDB Atlas  | Your existing cluster (M0 free tier works)             | $0+ (external)              |
| Google Gemini  | Per API usage                                          | usage-based (external)      |

> New accounts (post Jul 15, 2025): the **$200 credits / 6 months** Free Plan typically covers all of the above while you build. Set a Budget alert so you're not surprised when credits expire.

---

## Troubleshooting

| Symptom | Likely cause & fix |
|---|---|
| Site `403` when loading | OAC bucket policy not applied ([1E](#1e-apply-the-oac-bucket-policy-to-s3)), or files weren't uploaded to the **bucket root**. |
| `404` / blank page on refresh of a route | Custom error responses ([1F](#1f-add-spa-routing-custom-error-responses)) not configured. |
| Console: *"Mixed Content … http://localhost:5000"* | Frontend was built before the code change in [Step 2](#2-one-required-code-change). Rebuild and re-upload. |
| Chat fails, `POST /api/...` → `403`/`404` from CloudFront | `/api/*` behavior or EC2 origin missing/misconfigured ([2I](#2i-add-ec2-as-a-second-cloudfront-origin)/[2J](#2j-route-api-to-ec2-cache-behavior)); or you forgot the invalidation ([2K](#2k-invalidate-the-cache-and-verify-everything)). |
| `/api/*` → `502`/`503` | Backend not running (`pm2 status`), Nginx down (`systemctl status nginx`), or security-group port 80 closed. |
| `/api/*` → `504` | RAG/Gemini slower than timeout — raise CloudFront origin **Response timeout** to 60s and Nginx `proxy_read_timeout` to 60s ([2J](#2j-route-api-to-ec2-cache-behavior)). |
| Server logs: Mongo connection/timeout | EC2 IP not allowlisted in Atlas ([2H](#2h-allow-ec2-to-reach-mongodb-atlas)) or wrong `MONGODB_URI`. |
| EC2 Instance Connect: *"Failed to connect"* / *"port 22 not authorized"* | The SSH rule isn't open to the Instance Connect service. Set the port-22 **Source** to the prefix list **`com.amazonaws.<region>.ec2-instance-connect`** (or `0.0.0.0/0` to test). **"My IP" does not work** — the connection comes from AWS's IPs, not yours. Also confirm the instance has a **public IP** and status checks are 2/2. |
| Frontend changes not showing | CloudFront cached old files — run an **invalidation** (`/*`). |

---

## Sources

Official AWS documentation and references used:

- [Create and activate an AWS account (AWS re:Post)](https://repost.aws/knowledge-center/create-and-activate-aws-account)
- [AWS Free Tier FAQs (post Jul 15, 2025 model)](https://aws.amazon.com/free/free-tier-faqs/)
- [Track your Free Tier usage for Amazon EC2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-free-tier-usage.html)
- [Connect to a Linux instance using EC2 Instance Connect](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-connect-methods.html)
- [Restrict access to an Amazon S3 origin (Origin Access Control)](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)
- [Configure OAC for CloudFront distributions with Amazon S3 origins (re:Post)](https://repost.aws/knowledge-center/cloudfront-oac-origins)
- [Get started with a CloudFront standard distribution](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/GettingStarted.SimpleDistribution.html)
- [Use various origins with CloudFront distributions (S3, EC2/custom origins)](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistS3AndCustomOrigins.html)
- [Deploy a React-based single-page application to Amazon S3 and CloudFront (AWS Prescriptive Guidance)](https://docs.aws.amazon.com/prescriptive-guidance/latest/patterns/deploy-a-react-based-single-page-application-to-amazon-s3-and-cloudfront.html)
- [Generate custom error responses (SPA routing)](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/GeneratingCustomErrorResponses.html)
- [Specify a default root object](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DefaultRootObject.html)
- [Invalidate files to remove content (CloudFront)](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Invalidation.html)
- [Restrict access with CloudFront VPC origins](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html)
- [Using HTTPS with CloudFront](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-https.html)
