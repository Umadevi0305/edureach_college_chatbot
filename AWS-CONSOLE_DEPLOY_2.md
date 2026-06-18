# Deploying EduReach to AWS — Console-Only Guide (No AWS CLI)

This guide deploys the project using **only the AWS web console** — no AWS CLI or SSH client on *your* machine — and then automates redeploys with a CI/CD pipeline. It is split into **three core sessions** you do in order, plus an **optional fourth** if you want a branded domain:

- **Session 1 — Deploy the Frontend** (`/client`, React 19 + Vite) → **Amazon S3 + Amazon CloudFront**
- **Session 2 — Deploy the Backend** (`/server`, Node.js 24 + Express 5) → first **push your code to GitHub**, then run it on **Amazon EC2** (Node + PM2 + Nginx) and wire it into the *same* CloudFront distribution under `/api/*`
- **Session 3 — Set up a CI/CD Pipeline** (GitHub Actions) → auto-build & deploy the frontend to S3/CloudFront and the backend to EC2 on every push
- **Session 4 — (Optional) Add a Custom Domain + HTTPS** → serve everything from a branded address like `https://chatbot.yourcollege.edu`, using your existing domain provider (e.g. **GoDaddy**) or Amazon Route 53

> **How to follow this guide:** Do the sessions **top to bottom, in order**. Each session is self-contained — finish one before starting the next. Don't skip ahead.

> **About "No AWS CLI":** Sessions 1 & 2 are done entirely by clicking in the console. The CI/CD pipeline in Session 3 *does* run AWS CLI commands — but on **GitHub's servers automatically**, never on your computer. So you still never install or run the CLI yourself.

> **Why this design:** CloudFront gives you free, valid **HTTPS** on a `*.cloudfront.net` URL. We put the React site on CloudFront, and we add the EC2 backend as a **second origin** on the *same* distribution under the path `/api/*`. The browser only ever talks to CloudFront over HTTPS — so there's **no domain to buy, no certificate to manage, and no CORS problems**. MongoDB Atlas and Google Gemini stay exactly where they are (they're called from the server).

> **Order note (read this):** We deploy the **frontend first**. After Session 1 your website will load over HTTPS, but the **chatbot will not answer yet** — that's expected. The chat starts working at the end of Session 2, once the backend exists and we route `/api/*` to it and clear the CloudFront cache.

---

## Table of contents

- [Deploying EduReach to AWS — Console-Only Guide (No AWS CLI)](#deploying-edureach-to-aws--console-only-guide-no-aws-cli)
  - [Table of contents](#table-of-contents)
  - [0. Before you start](#0-before-you-start)
    - [How to read this guide (placeholders \& example names)](#how-to-read-this-guide-placeholders--example-names)
  - [1. Create your AWS account](#1-create-your-aws-account)
  - [2. One required code change](#2-one-required-code-change)
- [SESSION 1 — Deploy the FRONTEND](#session-1--deploy-the-frontend)
    - [1A. Build the React app locally](#1a-build-the-react-app-locally)
    - [1B. Create a private S3 bucket](#1b-create-a-private-s3-bucket)
    - [1C. Upload the build (drag \& drop)](#1c-upload-the-build-drag--drop)
    - [1D. Create the CloudFront distribution + OAC](#1d-create-the-cloudfront-distribution--oac)
    - [1E. Verify the bucket policy was applied](#1e-verify-the-bucket-policy-was-applied)
    - [1F. Set the default root object to `index.html`](#1f-set-the-default-root-object-to-indexhtml)
    - [1G. Add SPA routing (custom error responses)](#1g-add-spa-routing-custom-error-responses)
    - [1H. Get your URL and test the site loads](#1h-get-your-url-and-test-the-site-loads)
- [SESSION 2 — Deploy the BACKEND](#session-2--deploy-the-backend)
    - [2A. Push your project to GitHub](#2a-push-your-project-to-github)
    - [2B. Launch an EC2 instance](#2b-launch-an-ec2-instance)
    - [2C. Connect via EC2 Instance Connect (browser)](#2c-connect-via-ec2-instance-connect-browser)
    - [2D. Install Node 24, git, nginx](#2d-install-node-24-git-nginx)
    - [2E. Get the code onto the server](#2e-get-the-code-onto-the-server)
    - [2F. Create the production .env](#2f-create-the-production-env)
    - [2G. Run the server with PM2](#2g-run-the-server-with-pm2)
    - [2H. Put Nginx in front (port 80 → 5000)](#2h-put-nginx-in-front-port-80--5000)
    - [2I. Allow EC2 to reach MongoDB Atlas](#2i-allow-ec2-to-reach-mongodb-atlas)
    - [2J. Add EC2 as a second CloudFront origin](#2j-add-ec2-as-a-second-cloudfront-origin)
    - [2K. Route /api/\* to EC2 (cache behavior)](#2k-route-api-to-ec2-cache-behavior)
    - [2L. Invalidate the cache and verify everything](#2l-invalidate-the-cache-and-verify-everything)
- [SESSION 3 — Set up a CI/CD Pipeline (GitHub Actions)](#session-3--set-up-a-cicd-pipeline-github-actions)
    - [3A. What the pipeline does + prerequisites](#3a-what-the-pipeline-does--prerequisites)
    - [3B. Connect GitHub to AWS securely with OIDC (no stored keys)](#3b-connect-github-to-aws-securely-with-oidc-no-stored-keys)
    - [3C. Frontend pipeline → S3 + CloudFront](#3c-frontend-pipeline--s3--cloudfront)
    - [3D. Prepare EC2 for automated SSH deploys](#3d-prepare-ec2-for-automated-ssh-deploys)
    - [3E. Backend pipeline → EC2](#3e-backend-pipeline--ec2)
    - [3F. Add the GitHub secrets](#3f-add-the-github-secrets)
    - [3G. Run and verify the pipeline](#3g-run-and-verify-the-pipeline)
- [SESSION 4 — (Optional) Add a custom domain + HTTPS](#session-4--optional-add-a-custom-domain--https)
    - [4A. Decide your domain name and where DNS lives](#4a-decide-your-domain-name-and-where-dns-lives)
    - [4B. Get the domain](#4b-get-the-domain)
    - [4C. Request a free TLS certificate in ACM (must be `us-east-1`)](#4c-request-a-free-tls-certificate-in-acm-must-be-us-east-1)
    - [4D. Validate the certificate (prove you own the domain)](#4d-validate-the-certificate-prove-you-own-the-domain)
    - [4E. Attach the domain to your CloudFront distribution](#4e-attach-the-domain-to-your-cloudfront-distribution)
    - [4F. Point your domain at CloudFront (DNS record)](#4f-point-your-domain-at-cloudfront-dns-record)
    - [4G. Verify](#4g-verify)
    - [4H. (Optional) tidy up the backend env](#4h-optional-tidy-up-the-backend-env)
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
- A **GitHub account** — in Session 2 you'll push the project to a private GitHub repo and `git clone` it onto the server.

> ⚠️ Never commit `.env` or your API keys to Git, and never put them in the frontend build. The keys live only on the EC2 server.

### How to read this guide (placeholders & example names)

To keep examples concrete, this guide uses sample values. **Replace them with your own** wherever you see them:

| In the guide you'll see | What it means — replace with |
|--------------------------|------------------------------|
| `<...>` in angle brackets | A value you must fill in. E.g. `<ACCOUNT_ID>` → your 12-digit AWS account ID, `<region>` → your region, `<your-username>` → your GitHub username. |
| `edureach-frontend-prod-12345` | **Example** S3 bucket name. Bucket names are globally unique, so pick your **own** (e.g. add different numbers) in [Step 1B](#1b-create-a-private-s3-bucket), then use **that same name** everywhere this example appears. |
| `d111111abcdef8.cloudfront.net` | Example CloudFront domain — yours will differ. |
| `ec2-3-110-x-x.ap-south-1.compute.amazonaws.com` | Example EC2 address — yours will differ. |
| `ap-south-1` (Mumbai) | The example region. Use whichever region you picked, consistently. |
| `chatbot.yourcollege.edu` | Example custom domain — use your real one. |

> 💡 **Tip:** before you start, write your real values (bucket name, region, distribution ID, EC2 address, domain) in a notes file so you can paste them consistently throughout.

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

Save the change. Now build it in Session 1.

---

# SESSION 1 — Deploy the FRONTEND

**Goal of this session:** get your React site live on a `https://xxxx.cloudfront.net` URL.
**End state:** the website loads over HTTPS. (The chat won't answer until Session 2 — that's expected.)

### 1A. Build the React app locally

> **Why:** Browsers can't run your React/JSX source directly. `npm run build` compiles everything into plain static files (HTML, CSS, JS) that any web host can serve. We build on your machine because S3 just stores finished files — it doesn't build anything itself.

On your computer, in a terminal:

```bash
cd "edureach-agentic-colleage-chatbot/client"
npm ci
npm run build      # outputs the finished site to client/dist/
```

You now have a `client/dist/` folder containing `index.html` plus an `assets/` folder. **This folder is what we upload.**

### 1B. Create a private S3 bucket

> **Why S3:** Amazon S3 is cheap, durable file storage. Your built frontend is just static files, so a storage service is the perfect (and cheapest) home — no server needed to "run" the frontend.
>
> **Why private + CloudFront (not public):** We keep the bucket **private** and serve it only through CloudFront. Do **not** turn on "Static website hosting" and do **not** make it public — CloudFront + OAC is the AWS-recommended, secure pattern. It means users can't reach your files directly on S3 (so you can't be billed by someone hammering the bucket), and you get HTTPS + global caching for free.

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

### 1D. Create the CloudFront distribution + OAC

> **Why CloudFront:** It's AWS's CDN (content delivery network). It gives you (1) **free HTTPS** on a `*.cloudfront.net` URL — essential, because a secure page can't call insecure resources; (2) **global edge caching** so the site loads fast worldwide; and (3) a single front door we'll later use to route `/api/*` to the backend so frontend + API share one origin (no CORS).
>
> **Why OAC (Origin Access Control):** OAC is what lets *only* CloudFront read your private S3 bucket, using signed requests. It's the mechanism that keeps the bucket locked down while still serving the site.

AWS updated the CloudFront console to a guided **"Single website or app"** wizard that creates the OAC **and updates the S3 bucket policy for you automatically** — so there's no manual policy paste anymore. Follow the screens in order:

1. Console → search **CloudFront** → open it → **Create distribution**.
2. **Distribution name:** type something like `edureach`. Click **Next**.
3. Choose **Single website or app** → **Next**. (Then **Next** again if a brief intro screen shows.)
4. **Origin type** page → select **Amazon S3**.
5. **S3 origin** → click **Browse S3** → select your bucket (`edureach-frontend-prod-12345`).
6. **Settings** → choose **Use recommended origin settings**. This automatically sets up **Origin Access Control (OAC)** and the secure, recommended cache settings. Click **Next**.
7. **Enable security protections** page → choose **Do not enable security protections** (AWS WAF adds a monthly cost — you can enable it later). Click **Next**.
8. Review, then click **Create distribution**. **CloudFront updates the S3 bucket policy for you** — you'll see the bucket policy applied automatically.

### 1E. Verify the bucket policy was applied

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

### 1F. Set the default root object to `index.html`

So that visiting the bare CloudFront URL loads your app:

1. CloudFront → your distribution → **General** tab (or **Settings**) → **Edit**.
2. Set **Default root object** to `index.html` → **Save changes**. (The "Single website or app" preset usually sets this already — confirm it's `index.html`.)

### 1G. Add SPA routing (custom error responses)

A React Router app has client-side routes that don't exist as real files in S3. Without this, a refresh on such a path returns 403/404. Fix it:

1. CloudFront → your distribution → **Error pages** tab → **Create custom error response**. Create **two** entries:

   | HTTP error code | Customize error response | Response page path | HTTP Response code |
   |-----------------|--------------------------|--------------------|--------------------|
   | `403`           | Yes                      | `/index.html`      | `200`              |
   | `404`           | Yes                      | `/index.html`      | `200`              |

This makes CloudFront serve `index.html` (with status 200) for unknown paths, so React Router can handle them.

### 1H. Get your URL and test the site loads

1. CloudFront → your distribution. Wait until **Last modified** shows **Enabled** / deployment finishes (a few minutes).
2. Copy the **Distribution domain name**, e.g. `https://d111111abcdef8.cloudfront.net`.
3. Open it in a browser → **the EduReach site should load over HTTPS.** ✅

> The chatbot will throw a network error if you try it now — that's expected. It comes alive at the end of Session 2. **Keep this CloudFront tab handy** — in Session 2 you add a second origin to *this same distribution*.

---

# SESSION 2 — Deploy the BACKEND

**Goal of this session:** put your code on GitHub, run the Node API on an EC2 server behind Nginx, then route `/api/*` from CloudFront to it.
**End state:** the chatbot answers on your CloudFront URL.

Do the steps below in order, top to bottom.

### 2A. Push your project to GitHub

Before launching a server, put your code on GitHub. You'll use it twice:
- **This session (2E):** the backend gets onto EC2 with a simple `git clone`.
- **Session 3 (CI/CD):** the pipeline redeploys automatically every time you `git push`.

> 🛑 **Read this first — don't leak your secrets.** Your project currently has **no proper `.gitignore`**, so a plain `git add .` would upload `server/.env` (your MongoDB URI + Gemini API key) and hundreds of MB of `node_modules`. **Create the `.gitignore` below *before* you commit.**

**Step 1 — Create a root `.gitignore`.** Create a file named `.gitignore` in the **project root** (`edureach-agentic-colleage-chatbot/.gitignore`) with this content:

```gitignore
# Dependencies
node_modules/

# Secrets / environment files
.env
.env.*
!.env.example

# Build output
dist/



```

> 💡 Optional: also create `server/.env.example` listing the variable **names with empty values** (`MONGODB_URI=`, `GOOGLE_API_KEY=`, etc.) so anyone cloning the repo knows what to fill in. The `!.env.example` line above keeps it tracked while real `.env` files stay ignored.

**Step 2 — Know what gets pushed vs. what stays out.**

✅ **Push these (your source code):**

```
edureach-agentic-colleage-chatbot/
├── .gitignore
├── AWS-CONSOLE-DEPLOYMENT.md        # docs (optional, fine to include)
├── DEPLOYMENT.md                    # optional
├── .github/workflows/               # the 2 CI/CD files you add in Session 3
│   ├── deploy-frontend.yml
│   └── deploy-backend.yml
├── client/
│   ├── package.json
│   ├── package-lock.json            # ✅ required — npm ci needs it
│   ├── index.html
│   ├── vite.config.js
│   ├── eslint.config.js
│   ├── .gitignore
│   └── src/                         # all React code
└── server/
    ├── package.json
    ├── package-lock.json            # ✅ required
    ├── src/                         # all backend code
    └── knowledge-base/
        └── edureach-knowledge.txt   # ✅ the chatbot's knowledge — must be pushed
```

🚫 **Never push these:**

| Item | Why |
|------|-----|
| `server/.env` | **Your secrets** (`MONGODB_URI`, `GOOGLE_API_KEY`). Lives only on the EC2 server. |
| `server/node_modules/`, `client/node_modules/` | Huge; rebuilt with `npm ci`. |
| `client/dist/` | Build output; the pipeline rebuilds it. |
| `client/.env.local` | Local-only (matched by `.env.*`). |

> 📌 Two easy-to-forget **must-haves**: both `package-lock.json` files (without them `npm ci` fails) and `server/knowledge-base/` (without it the chatbot has no content to answer from).

**Step 3 — Create the repo and push.**

1. On **github.com** → **New repository** → name it (e.g. `edureach`), keep it **Private**, **don't** add a README/.gitignore (you already have files) → **Create repository**.
2. In a terminal at the project root:

   ```bash
   cd "/home/nxtwave/Videos/college help desk agent documents/edureach-agentic-colleage-chatbot"
   git init
   git add .
   git status      # ⬅️ CHECK: server/.env and node_modules must NOT be listed
   git commit -m "Initial commit: EduReach app"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```

3. **Before the commit, run `git status` and confirm `server/.env` and `node_modules/` are NOT listed.** If they show up, your `.gitignore` isn't in the project root or has a typo — fix it before committing.

> If you accidentally committed `.env` already: remove it from tracking with `git rm --cached server/.env`, commit again, and **rotate those keys** (treat them as exposed) — Git keeps history, so the old values remain in past commits.

### 2B. Launch an EC2 instance

> **Why EC2 (not S3):** Unlike the frontend, the backend is a *running program* — a Node.js/Express server that talks to MongoDB and Gemini and stays on 24/7. S3 only stores files; it can't run code. EC2 gives you a small always-on Linux virtual machine to run that server.
> **Why these choices:** **Amazon Linux 2023** is AWS's maintained, free OS image and supports browser-based connect out of the box. **`t3.micro`** is a small, low-cost size that's covered by your free credits and is plenty for this app.

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
9. Note the **Public IPv4 DNS** (e.g. `ec2-3-110-x-x.ap-south-1.compute.amazonaws.com`) — you'll need it for CloudFront in step 2J.

> 💡 **Recommended:** allocate an **Elastic IP** so the address survives reboots: EC2 → **Elastic IPs** → **Allocate Elastic IP address** → select it → **Actions → Associate** → choose your instance. Use the Elastic IP's DNS for CloudFront.

### 2C. Connect via EC2 Instance Connect (browser)

No SSH client or `.pem` file needed:

1. EC2 → **Instances** → select `edureach-backend` → **Connect** (top button).
2. Choose the **EC2 Instance Connect** tab → username stays `ec2-user` → **Connect**.
3. A black terminal opens **in your browser**. You're now on the server.

### 2D. Install Node 24, git, nginx

> **Why these three:** A fresh EC2 box is bare. We install **Node.js 24** because the backend is written for it (your `package.json` targets Node 24); **git** to pull your code from GitHub; and **nginx** as a lightweight web server that will sit in front of Node (explained in 2H).

In the browser terminal:

```bash
# Node.js 24 via NodeSource (gives standard `node` / `npm` commands)
curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo bash -
sudo dnf install -y nodejs git nginx

node -v   # should print v24.x
npm -v
```

> **Alternative (native AL2023 package):** Amazon Linux 2023 also ships Node via `sudo dnf install -y nodejs24 git nginx`. AL2023 namespaces the binaries (`node-24`/`npm-24`), which can confuse tools expecting plain `node`. The NodeSource method above is more predictable for this project — prefer it. If `node -v` doesn't print `v24.x`, re-run the NodeSource step.

### 2E. Get the code onto the server

> **Why git clone:** The EC2 box needs your backend code. Pulling it from the GitHub repo you created in [2A](#2a-push-your-project-to-github) is the cleanest way — and it means later updates are just `git pull`. We install only production dependencies (`--omit=dev`) because the server doesn't need build/lint tools, keeping it lean.

```bash
cd ~
git clone <YOUR_REPO_URL> edureach
cd edureach/server
npm ci --omit=dev        # install production dependencies only
```

> For a private repo, GitHub will prompt for credentials — use a **Personal Access Token** as the password, or make the repo public temporarily just for the clone.

> **Make sure `server/knowledge-base/` is included in the repo** — the server embeds those files into Atlas on first start.

> **Alternative — no Git:** paste files manually. In the browser terminal create the folders and use `nano` to create each file, or zip the `server/` folder locally, upload the zip to your S3 bucket, make that one object temporarily downloadable, `curl` it down, and `unzip`. Git is far simpler — prefer it.

### 2F. Create the production .env

> **Why create it on the server (and not in Git):** The app reads its secrets (`MONGODB_URI`, `GOOGLE_API_KEY`) from this file at runtime. Because it holds secrets, it must **never** be in GitHub — so it doesn't arrive with `git clone`; you create it directly on the box. `chmod 600` locks it so only your user can read it.

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

### 2G. Run the server with PM2

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

### 2H. Put Nginx in front (port 80 → 5000)

> **Why Nginx in front of Node:** Your Node app listens on port 5000, but web traffic arrives on port 80. Nginx is a **reverse proxy** — it accepts requests on port 80 and forwards them to Node on 5000. This is standard practice: it lets you keep Node on an internal port, sets proper forwarding headers, handles timeouts (important here since RAG + Gemini replies can be slow), and gives you a clean place to add the security-header check later. CloudFront will talk to Nginx on port 80.

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

### 2I. Allow EC2 to reach MongoDB Atlas

> **Why:** MongoDB Atlas blocks all connections by default and only allows IP addresses you explicitly approve. Your backend now runs from the EC2 server's IP, so you must add that IP to Atlas's allowlist — otherwise the app can't reach the database and you'll see connection timeouts. (We use Atlas, not an AWS database, because the app relies on **Atlas Vector Search**, which is Atlas-specific.)

1. In **MongoDB Atlas** → your cluster → **Network Access** → **Add IP Address**.
2. Add your EC2 instance's **public IP / Elastic IP**. (Avoid `0.0.0.0/0` in production.)
3. If the server logs showed a Mongo timeout earlier, do this, then `pm2 restart edureach-api` on the server.

### 2J. Add EC2 as a second CloudFront origin

> **Why:** This is the key trick that makes everything work without a domain. By adding EC2 as a **second origin** on the *same* CloudFront distribution, the browser only ever talks to CloudFront over **HTTPS**, and CloudFront forwards API calls to EC2 over HTTP internally. Result: the backend gets HTTPS for free (no certificate to buy), and because the frontend and API share one origin, there are **no CORS problems**. We use **HTTP only** to the EC2 origin because Nginx there listens on plain port 80 — the public-facing HTTPS is handled by CloudFront.

Go back to the **same** CloudFront distribution you created in Session 1.

1. CloudFront → your distribution → **Origins** tab → **Create origin**.
2. **Origin domain:** your EC2 **Public IPv4 DNS** or Elastic IP DNS (e.g. `ec2-3-110-x-x.ap-south-1.compute.amazonaws.com`).
3. **Protocol:** **HTTP only**.
4. **HTTP port:** `80`.
5. *(Optional hardening)* **Add custom header:** name `X-Origin-Verify`, value = a long random secret — used in [Optional hardening](#optional-hardening).
6. **Create origin.**

### 2K. Route /api/* to EC2 (cache behavior)

> **Why:** A "behavior" is a routing rule. We add one so that any request starting with `/api/` goes to the EC2 backend, while everything else keeps going to the S3 frontend. We set **CachingDisabled** because API responses are dynamic and must never be served stale from cache, and **AllViewer** so the request body/headers (your chat message) are forwarded to the backend intact. We allow **POST** (and others) because the chat API uses POST — the default behavior only allows GET/HEAD.

1. CloudFront → your distribution → **Behaviors** tab → **Create behavior**.
2. **Path pattern:** `/api/*`
3. **Origin and origin groups:** select the **EC2 origin** you just created.
4. **Viewer protocol policy:** **Redirect HTTP to HTTPS**.
5. **Allowed HTTP methods:** **GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE** (the API uses POST).
6. **Cache policy:** **CachingDisabled** (managed) — API responses must never be cached.
7. **Origin request policy:** **AllViewer** (managed) — forwards headers/query/body to the backend.
8. **Create behavior.**

> CloudFront matches the most specific path first: `/api/*` → EC2; everything else falls through to the **Default (`*`)** behavior → S3.

> **If `/api/*` returns `504` later:** RAG/Gemini was slower than the timeout. Edit the **EC2 origin** → raise **Response timeout** to `60`, and confirm Nginx `proxy_read_timeout 60s` (set in 2H).

### 2L. Invalidate the cache and verify everything

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

# SESSION 3 — Set up a CI/CD Pipeline (GitHub Actions)

**Goal of this session:** stop deploying by hand. After this, every `git push` builds and deploys for you automatically.

So far you deploy manually (rebuild → upload → invalidate; or connect → git pull → restart). **CI/CD** automates this. We use **GitHub Actions** because it's free for this size of project and your code is already on GitHub (from Session 2).

### 3A. What the pipeline does + prerequisites

**Two workflows**, both triggered on push to your `main` branch:

| Workflow | When it runs | What it does |
|----------|-------------|--------------|
| **Frontend** | changes under `client/**` | builds the React app on GitHub's server → uploads `dist/` to S3 → invalidates CloudFront |
| **Backend** | changes under `server/**` | SSHes into EC2 → `git pull` → `npm ci --omit=dev` → `pm2 restart` |

**Prerequisites (all done in Sessions 1 & 2):**
- Your project is pushed to a **GitHub repository** (the one you created in [2A](#2a-push-your-project-to-github) and cloned onto EC2 in [2E](#2e-get-the-code-onto-the-server)).
- Sessions 1 & 2 are complete (S3 bucket, CloudFront distribution, EC2 instance all exist).
- You know these values from earlier:
  - **S3 bucket name** (e.g. `edureach-frontend-prod-12345`)
  - **CloudFront distribution ID** (CloudFront console → your distribution → it's the `E...` ID, *not* the domain name)
  - **EC2 public DNS / Elastic IP**
  - Your AWS **region** (e.g. `ap-south-1`) and **account ID** (top-right console menu → 12-digit number)

> ⚠️ **The required code change must be committed.** The frontend build only works in production if `client/src/services/api.js` uses the relative `/api` path (see [Step 2](#2-one-required-code-change)). Make that change, commit, and push *before* relying on the frontend pipeline — otherwise the deployed site will call `localhost` and the chat will fail.

### 3B. Connect GitHub to AWS securely with OIDC (no stored keys)

The frontend pipeline needs permission to write to S3 and invalidate CloudFront. The **secure, AWS-recommended** way is **OIDC**: GitHub proves its identity to AWS and gets short-lived credentials — so you store **no** long-lived AWS keys in GitHub.

**Step 1 — Create the OIDC identity provider (one-time):**
1. AWS Console → **IAM** → left nav **Identity providers** → **Add provider**.
2. **Provider type:** **OpenID Connect**.
3. **Provider URL:** `https://token.actions.githubusercontent.com` → click **Get thumbprint**.
4. **Audience:** `sts.amazonaws.com`.
5. **Add provider.**

**Step 2 — Create an IAM role GitHub can assume:**
1. IAM → **Roles** → **Create role**.
2. **Trusted entity type:** **Web identity**.
3. **Identity provider:** select `token.actions.githubusercontent.com`. **Audience:** `sts.amazonaws.com`.
4. Fill **GitHub organization** (your GitHub username/org), **Repository** (your repo name), **Branch** = `main`. → **Next**.
5. **Permissions:** click **Create policy** (opens a new tab), choose the **JSON** tab, paste the policy below (replace the bucket name, region, account ID, distribution ID), name it `edureach-frontend-deploy` and create it. Back on the role tab, refresh and attach it. → **Next**.

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "S3Deploy",
         "Effect": "Allow",
         "Action": ["s3:ListBucket", "s3:PutObject", "s3:DeleteObject"],
         "Resource": [
           "arn:aws:s3:::edureach-frontend-prod-12345",
           "arn:aws:s3:::edureach-frontend-prod-12345/*"
         ]
       },
       {
         "Sid": "CloudFrontInvalidate",
         "Effect": "Allow",
         "Action": "cloudfront:CreateInvalidation",
         "Resource": "arn:aws:cloudfront::<ACCOUNT_ID>:distribution/<DISTRIBUTION_ID>"
       }
     ]
   }
   ```
6. **Role name:** `github-actions-edureach` → **Create role**.
7. Open the role and **copy its ARN** (looks like `arn:aws:iam::<ACCOUNT_ID>:role/github-actions-edureach`) — you'll add it as a GitHub secret in 3F.

> The role's trust policy (auto-created in step 4) restricts it to **your repo + main branch**, so no other repo can assume it.

### 3C. Frontend pipeline → S3 + CloudFront

In your project, create the file **`.github/workflows/deploy-frontend.yml`**:

```yaml
name: Deploy Frontend

on:
  push:
    branches: [main]
    paths: ["client/**", ".github/workflows/deploy-frontend.yml"]
  workflow_dispatch: {}   # lets you run it manually from the Actions tab

permissions:
  id-token: write   # required for OIDC
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: client
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: client/package-lock.json

      - run: npm ci
      - run: npm run build   # outputs client/dist

      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
          aws-region: ${{ secrets.AWS_REGION }}

      - name: Upload to S3
        run: aws s3 sync dist/ "s3://${{ secrets.S3_BUCKET }}/" --delete

      - name: Invalidate CloudFront
        run: aws cloudfront create-invalidation --distribution-id "${{ secrets.CLOUDFRONT_DISTRIBUTION_ID }}" --paths "/*"
```

> `aws s3 sync --delete` removes stale old files; the CloudFront invalidation forces users to get the new version immediately.

### 3D. Prepare EC2 for automated SSH deploys

The backend pipeline logs into EC2 over SSH. In Session 2 you connected via *EC2 Instance Connect* (no key). For automation you need a dedicated SSH key that GitHub will use.

1. **On your computer**, generate a key pair (no passphrase):
   ```bash
   ssh-keygen -t ed25519 -C "github-actions" -f ~/edureach-deploy-key -N ""
   ```
   This creates `~/edureach-deploy-key` (private) and `~/edureach-deploy-key.pub` (public).
2. **Add the public key to EC2.** Open the EC2 instance via **EC2 Instance Connect** (browser, as in [2C](#2c-connect-via-ec2-instance-connect-browser)) and run — paste the contents of the `.pub` file where shown:
   ```bash
   echo "ssh-ed25519 AAAA...your-public-key... github-actions" >> ~/.ssh/authorized_keys
   chmod 600 ~/.ssh/authorized_keys
   ```
3. **Open port 22 to GitHub's runners.** GitHub-hosted runners use changing IPs, so either:
   - Quick: in the security group, set **SSH (22)** source to `0.0.0.0/0` (simplest, less secure), **or**
   - Better: keep it locked and use **AWS SSM Session Manager** instead of SSH (more setup — see [Optional hardening](#optional-hardening)).
4. You'll paste the **private** key (`~/edureach-deploy-key`) into a GitHub secret in 3F. Keep it secret; never commit it.

### 3E. Backend pipeline → EC2

Create **`.github/workflows/deploy-backend.yml`**:

```yaml
name: Deploy Backend

on:
  push:
    branches: [main]
    paths: ["server/**", ".github/workflows/deploy-backend.yml"]
  workflow_dispatch: {}

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy over SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.EC2_HOST }}
          username: ec2-user
          key: ${{ secrets.EC2_SSH_KEY }}
          script: |
            set -e
            cd ~/edureach/server
            git pull origin main
            npm ci --omit=dev
            pm2 restart edureach-api
            pm2 save
```

> This assumes the repo was cloned to `~/edureach` on the server (as in [2E](#2e-get-the-code-onto-the-server)) and PM2 runs the app as `edureach-api` (as in [2G](#2g-run-the-server-with-pm2)). The server reads secrets from its own `~/edureach/server/.env` on the box — the pipeline never touches `.env`.

### 3F. Add the GitHub secrets

In GitHub: your repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Add each:

| Secret name | Value |
|-------------|-------|
| `AWS_DEPLOY_ROLE_ARN` | the role ARN from [3B](#3b-connect-github-to-aws-securely-with-oidc-no-stored-keys) (`arn:aws:iam::...:role/github-actions-edureach`) |
| `AWS_REGION` | your region, e.g. `ap-south-1` |
| `S3_BUCKET` | your bucket name, e.g. `edureach-frontend-prod-12345` |
| `CLOUDFRONT_DISTRIBUTION_ID` | the `E...` distribution ID |
| `EC2_HOST` | EC2 public DNS or Elastic IP |
| `EC2_SSH_KEY` | the **entire contents** of the private key `~/edureach-deploy-key` (including the `-----BEGIN/END-----` lines) |

### 3G. Run and verify the pipeline

1. Commit the two workflow files (and the required `api.js` change) and **push to `main`**:
   ```bash
   git add .github/workflows/ client/src/services/api.js
   git commit -m "Add CI/CD pipelines"
   git push origin main
   ```
2. GitHub → your repo → **Actions** tab → watch **Deploy Frontend** (and **Deploy Backend** if you changed server files) run. Green check = success.
3. **Test it end-to-end:** make a small visible change in the frontend (e.g. edit some text), commit, push. Within a couple of minutes the Action runs and your CloudFront site shows the change (hard-refresh).
4. To trigger a deploy without code changes, use **Actions → the workflow → Run workflow** (the `workflow_dispatch` button).

> Now the manual "[Updating later](#updating-later-no-cli)" steps below are only a fallback — day-to-day you just `git push`.

🎉 Your three core sessions are done. The app is fully deployed and auto-updates on every push.

---

# SESSION 4 — (Optional) Add a custom domain + HTTPS

> **Do this only if you want a branded address.** Everything already works on the `*.cloudfront.net` URL from Session 1. This optional session swaps that random URL for a clean address like **`https://chatbot.yourcollege.edu`** — using a domain you buy from **GoDaddy** (or another provider), your college's existing domain, or Amazon Route 53.

**Goal of this session:** point your own domain at the CloudFront distribution you already have.

> **Why this works with zero backend changes:** your API is already served from the **same** CloudFront distribution under `/api/*`. So once the domain points at CloudFront, **both the website and the chatbot API automatically use the new domain** — nothing in EC2/S3 changes, and there's still no CORS to worry about.

### 4A. Decide your domain name and where DNS lives

Two decisions:

1. **The name:** an **apex** domain (`yourcollege.edu`) or a **subdomain** (`chatbot.yourcollege.edu`). For a college, a subdomain is the usual, easiest choice — and the college's IT team can add it without touching the main site.
2. **Who manages DNS** (the "phone book" that maps your name → CloudFront):
   - **GoDaddy / Namecheap / your college's existing DNS** — the most common case. If you buy a domain from **GoDaddy**, you add the records right in the GoDaddy DNS panel. For a `.edu`, ask whoever manages it. A **subdomain** via a `CNAME` record is the simplest path here. → follow **Path B** in the steps below.
   - **Amazon Route 53** — AWS's own DNS. Smoothest experience (one-click validation, supports apex domains via "Alias"). Best if you'll **register a brand-new domain inside AWS**. → follow **Path A** in the steps below.

The steps below cover **both paths**. Pick the one that matches your situation and follow it consistently.

### 4B. Get the domain

**Path A — Register a new domain in Route 53:**
1. Console → **Route 53** → **Registered domains** → **Register domains**.
2. Search your desired name, add to cart, complete purchase (cost varies by TLD, e.g. ~$12–15/yr for `.com`). Route 53 automatically creates a **hosted zone** (your DNS records) for it.

**Path B — Use a domain you already own (GoDaddy / Namecheap / college):**
- Nothing to buy if you already own one (or buy one from **GoDaddy** first). You just need access to add **DNS records** in that provider's control panel (the **GoDaddy DNS Management** page, your provider's panel, or whoever manages `yourcollege.edu`). For a college subdomain, ask IT to let you add records for `chatbot.yourcollege.edu`, or to add the two records you'll generate below.

> You do **not** need to move your domain to AWS. Keeping DNS at **GoDaddy** (or your existing provider) is fine — you'll just add a couple of records there.

### 4C. Request a free TLS certificate in ACM (must be `us-east-1`)

HTTPS on your domain needs an SSL/TLS certificate. AWS Certificate Manager (ACM) issues them **free**.

> ⚠️ **Critical:** the certificate **must be created in the `us-east-1` (N. Virginia) region** — CloudFront only accepts certificates from there, no matter where your other resources live. Switch the region (top-right) to **US East (N. Virginia)** before you start.

1. Region selector (top-right) → **US East (N. Virginia) us-east-1**.
2. Console → **Certificate Manager (ACM)** → **Request certificate** → **Request a public certificate** → **Next**.
3. **Fully qualified domain name:** enter your domain exactly as users will type it, e.g. `chatbot.yourcollege.edu` (or `yourcollege.edu`).
   - *(Optional)* click **Add another name** to also cover `www.yourcollege.edu`, etc.
4. **Validation method:** **DNS validation – recommended**.
5. **Key algorithm:** leave **RSA 2048** → **Request**.

### 4D. Validate the certificate (prove you own the domain)

ACM gives you a **CNAME record** to add to your DNS; once it sees it, the certificate becomes **Issued**.

1. ACM → **Certificates** → click your new (Pending validation) certificate. You'll see a **CNAME name** and **CNAME value**.

**If DNS is in Route 53 (Path A):**
- Click **Create records in Route 53** → **Create records**. Done — validation completes automatically in a few minutes.

**If DNS is external (Path B — GoDaddy/Namecheap/college):**
- In your DNS provider (e.g. the **GoDaddy DNS Management** page), add a **CNAME record** using ACM's **CNAME name** and **CNAME value**.
- ⚠️ Many providers (GoDaddy included) auto-append your domain, so **remove the trailing `.yourcollege.edu`** from the *name* field if the panel adds it for you (otherwise you get a doubled name). Paste the value exactly.
- Save. Validation usually passes within ~5–30 minutes.

2. Wait until the certificate status shows **Issued** ✅ before continuing.

> If validation is stuck for a `.edu`, your college DNS may have a **CAA record** that blocks Amazon's CA. Ask IT to add a CAA record allowing `amazon.com`, or to confirm none exists.

### 4E. Attach the domain to your CloudFront distribution

1. Region back to where your distribution is listed (CloudFront is global, so region doesn't matter here). Console → **CloudFront** → your distribution → **General** tab → **Settings** → **Edit**.
2. **Alternate domain names (CNAMEs)** → **Add item** → type your domain, e.g. `chatbot.yourcollege.edu` (add `www...` too if you requested it on the cert).
3. **Custom SSL certificate** → select the ACM certificate you just issued (it appears because it's in `us-east-1`).
4. **Save changes.** Wait for the distribution to finish deploying (**Last modified** stops saying *Deploying*).

### 4F. Point your domain at CloudFront (DNS record)

Now make the name resolve to CloudFront. You need your **distribution domain name** (e.g. `d111111abcdef8.cloudfront.net`) from the distribution's General tab.

**If DNS is in Route 53 (Path A):**
1. Route 53 → **Hosted zones** → your domain → **Create record**.
2. **Record name:** leave blank for apex (`yourcollege.edu`), or type the subdomain (`chatbot`).
3. **Record type:** **A**.
4. Toggle **Alias** **ON** → **Route traffic to** → **Alias to CloudFront distribution** → select your distribution.
5. **Create records.** (Alias works for both apex and subdomains, and Route 53 doesn't charge for these queries.)

**If DNS is external (Path B — GoDaddy etc.):**
- **Subdomain (recommended), e.g. `chatbot.yourcollege.edu`:** in the GoDaddy DNS panel, add a **CNAME** record:
  - **Name/Host:** `chatbot`
  - **Value/Points to:** your CloudFront domain `d111111abcdef8.cloudfront.net`
- **Apex domain (`yourcollege.edu`):** a plain `CNAME` is **not allowed** at the apex. Either use a subdomain instead, use your provider's **ALIAS/ANAME/CNAME-flattening** feature if it has one (GoDaddy calls this "Forwarding/ANAME" — check current support), or move DNS to Route 53 (Path A) and use an Alias record.

### 4G. Verify

1. Wait for DNS to propagate (minutes to ~1 hour).
2. Open **`https://chatbot.yourcollege.edu`** → the EduReach site loads with a valid padlock 🔒 (no certificate warning). ✅
3. Send a chat message → it works, calling `/api/...` on your new domain. ✅
4. The old `*.cloudfront.net` URL keeps working too — both point to the same distribution.

### 4H. (Optional) tidy up the backend env

Nothing is required, because frontend and API share the same origin. But for cleanliness you can set the backend's `CLIENT_URL` to your new domain (it's only used by CORS if you ever split them onto different domains):

1. EC2 → connect → `nano ~/edureach/server/.env` → set `CLIENT_URL=https://chatbot.yourcollege.edu` → save.
2. `pm2 restart edureach-api`.

---

## Optional hardening

Right now someone could hit `http://<EC2_DNS>/api/...` directly, bypassing CloudFront. To force all traffic through CloudFront:

1. In step 2J you added header `X-Origin-Verify: <secret>` on the EC2 origin.
2. On the server, edit `/etc/nginx/conf.d/edureach.conf`, **uncomment** the `if ($http_x_origin_verify != "...")` block, set the **same** secret, then `sudo systemctl restart nginx`.

Now requests without the secret header get `403`. For stronger isolation, consider **CloudFront VPC origins** (EC2 in a private subnet).

Also recommended:
- SSH (port 22) restricted to your IP, not `0.0.0.0/0`.
- MongoDB Atlas Network Access allowlists only the EC2 IP.
- S3 **Block Public Access ON**; bucket readable only via the OAC policy.
- Keep the OS patched: `sudo dnf update -y` periodically.
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

> Once [Session 3 (CI/CD)](#session-3--set-up-a-cicd-pipeline-github-actions) is set up, you don't do any of this manually — just `git push` and the pipeline redeploys. Keep these steps only as a fallback.

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
| Domain (optional) | Domain registration (GoDaddy/Route 53); ACM cert is free; Route 53 hosted zone $0.50/mo if used | ~$12–15/yr + $0–0.50/mo |

> New accounts (post Jul 15, 2025): the **$200 credits / 6 months** Free Plan typically covers all of the above while you build. Set a Budget alert so you're not surprised when credits expire.

---

## Troubleshooting

| Symptom | Likely cause & fix |
|---|---|
| Site `403` when loading | OAC bucket policy not applied ([1E](#1e-verify-the-bucket-policy-was-applied)), or files weren't uploaded to the **bucket root**. |
| `404` / blank page on refresh of a route | Custom error responses ([1G](#1g-add-spa-routing-custom-error-responses)) not configured. |
| Console: *"Mixed Content … http://localhost:5000"* | Frontend was built before the code change in [Step 2](#2-one-required-code-change). Rebuild and re-upload. |
| Chat fails, `POST /api/...` → `403`/`404` from CloudFront | `/api/*` behavior or EC2 origin missing/misconfigured ([2J](#2j-add-ec2-as-a-second-cloudfront-origin)/[2K](#2k-route-api-to-ec2-cache-behavior)); or you forgot the invalidation ([2L](#2l-invalidate-the-cache-and-verify-everything)). |
| `/api/*` → `502`/`503` | Backend not running (`pm2 status`), Nginx down (`systemctl status nginx`), or security-group port 80 closed. |
| `/api/*` → `504` | RAG/Gemini slower than timeout — raise CloudFront origin **Response timeout** to 60s and Nginx `proxy_read_timeout` to 60s ([2K](#2k-route-api-to-ec2-cache-behavior)). |
| Server logs: Mongo connection/timeout | EC2 IP not allowlisted in Atlas ([2I](#2i-allow-ec2-to-reach-mongodb-atlas)) or wrong `MONGODB_URI`. |
| EC2 Instance Connect: *"Failed to connect"* / *"port 22 not authorized"* | The SSH rule isn't open to the Instance Connect service. Set the port-22 **Source** to the prefix list **`com.amazonaws.<region>.ec2-instance-connect`** (or `0.0.0.0/0` to test). **"My IP" does not work** — the connection comes from AWS's IPs, not yours. Also confirm the instance has a **public IP** and status checks are 2/2. |
| Frontend changes not showing | CloudFront cached old files — run an **invalidation** (`/*`). |
| CI/CD: frontend Action fails at "Configure AWS credentials" | OIDC misconfigured — check the IAM role's trust policy matches your **org/repo/branch**, the `id-token: write` permission is in the workflow, and `AWS_DEPLOY_ROLE_ARN`/`AWS_REGION` secrets are correct ([3B](#3b-connect-github-to-aws-securely-with-oidc-no-stored-keys)). |
| CI/CD: frontend Action fails at S3/CloudFront step | IAM role policy missing the bucket ARN or distribution ARN, or wrong `S3_BUCKET`/`CLOUDFRONT_DISTRIBUTION_ID` secret. |
| CI/CD: backend SSH step times out / "permission denied" | Port 22 not open to GitHub runners (set source `0.0.0.0/0` or use SSM), public key not in EC2 `~/.ssh/authorized_keys`, or `EC2_SSH_KEY` secret isn't the full private key incl. BEGIN/END lines ([3D](#3d-prepare-ec2-for-automated-ssh-deploys)). |
| Custom domain: ACM cert not selectable in CloudFront | The certificate wasn't created in **`us-east-1`**. CloudFront only accepts certs from N. Virginia — re-request it there ([4C](#4c-request-a-free-tls-certificate-in-acm-must-be-us-east-1)). |
| Custom domain: ACM stuck on "Pending validation" | The DNS CNAME wasn't added correctly (or your provider doubled the name — remove the trailing domain), or a `CAA` record blocks Amazon's CA ([4D](#4d-validate-the-certificate-prove-you-own-the-domain)). |
| Custom domain: browser shows certificate/`CNAMEMismatch` error | The domain isn't listed under **Alternate domain names** on the distribution, or it doesn't match the cert ([4E](#4e-attach-the-domain-to-your-cloudfront-distribution)). |
| Custom domain: site doesn't resolve | DNS record missing/not propagated, or a plain CNAME was used at an **apex** domain (use Route 53 Alias or a subdomain) ([4F](#4f-point-your-domain-at-cloudfront-dns-record)). |

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

Custom domain (Route 53 / ACM):

- [Use custom URLs by adding alternate domain names (CNAMEs)](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/CNAMEs.html)
- [Add an alternate domain name](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/CreatingCNAME.html)
- [Requesting a public certificate (ACM) — DNS validation](https://docs.aws.amazon.com/acm/latest/userguide/dns-validation.html)
- [Routing traffic to a CloudFront distribution (Route 53 alias)](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-to-cloudfront-distribution.html)

CI/CD (GitHub Actions):

- [Use IAM roles to connect GitHub Actions to AWS (AWS Security Blog)](https://aws.amazon.com/blogs/security/use-iam-roles-to-connect-github-actions-to-actions-in-aws/)
- [GitHub Docs — Configuring OpenID Connect in Amazon Web Services](https://docs.github.com/actions/security-for-github-actions/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)
- [aws-actions/configure-aws-credentials (GitHub)](https://github.com/aws-actions/configure-aws-credentials)
- [appleboy/ssh-action (GitHub Marketplace)](https://github.com/appleboy/ssh-action)
