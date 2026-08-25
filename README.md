---
title: Diet Maker Worker
emoji: 🥗
colorFrom: green
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
---

# 🥗 AI Diet Maker & WhatsApp Automation

An intelligent, full-stack nutrition planning dashboard and automated WhatsApp delivery system. **AI Diet Maker** leverages Google Gemini (`gemini-3.7-flash` with reasoning/thinking support) to generate precise, macro- and micro-balanced daily meal plans, and delivers customized instructions directly to you and your cook via WhatsApp.

---

## 🌟 Key Features

### 🍽️ Dynamic Diet Planner & Builder
- **Global Nutritional Targets**: Set daily calorie goals, total olive oil split percentages, and ideal Sodium-to-Potassium ($Na:K$) balance ranges (0.70–0.80).
- **Custom Meals & Ingredients**: Configure multiple meals with drag-and-drop reordering, per-meal/daily cooking quantity modes, and custom prep methods.
- **Smart Auto-Calculated Ingredients**: Mark ingredients as `[AUTO]` with optional `min` and `max` gram constraints. The AI automatically solves for exact weights to meet your daily caloric and macro targets.
- **Personal-Only Ingredients**: Flag sensitive or personal items (e.g., supplements, whey protein) to keep them in your full nutritional breakdown (Part 1) while automatically omitting them from the cook's preparation instructions (Part 2).
- **Daily Variables & Custom Splits**: Customize day-by-day variations (Monday–Sunday) for vegetables, carbs, and custom seasoning/salt splits.
- **Live System Prompt Preview**: Real-time prompt compiler with side-by-side prompt inspection and custom prompt override capabilities.

### 🧠 Gemini AI Generation & Smart Caching
- **Gemini AI Integration**: Supports Google AI Studio (API Key) and Gemini Enterprise / Vertex AI (API Key, Service Account JSON, or ADC).
- **Thinking Mode Support**: Configurable reasoning budget for Gemini thinking models with live preview of the AI's internal thought process.
- **Structured Dual-Part Output**:
  - **Part 1 (User Plan)**: Complete nutrition tables, macros (protein, carbs, fat, fiber), micro-nutrients (sodium, potassium), and meal schedules.
  - **Part 2 (Cook Instructions)**: Clean, cook-friendly preparation instructions, ingredient weights, and seasoning splits in clear language.
- **Hash-Based MongoDB Caching**: Hashes full configuration state to cache generated plans per day. Unchanged days load instantaneously with zero API latency.
- **Batch 7-Day Generation**: Generate all 7 days of the week in a single batch with live progress tracking.

### 📲 WhatsApp Automation & Daily Scheduler
- **Headless WhatsApp Client**: Built on `whatsapp-web.js` and Puppeteer running in a dedicated background worker.
- **In-Dashboard QR Pairing**: Scan WhatsApp Web QR code directly from the web dashboard.
- **Persistent Remote Session**: WhatsApp session state is stored in MongoDB GridFS, surviving container restarts, deployments, and reboots without re-scanning.
- **Timezone-Aware Auto-Scheduler**: Schedule daily automated dispatches at any time in your local timezone (e.g., `Asia/Kolkata`, `America/New_York`, `UTC`).
- **Dual-Recipient Routing**: Automatically sends Part 1 (Full Diet Plan) to your personal chat and Part 2 (Cook Instructions) directly to your cook or household group.
- **Manual Test Triggers & Diagnostics**: One-click test sending ("Send All", "Send Cook Only", "Send Myself Only") and live worker logs & health checks.

### 🔒 Access Control & Security
- **Password Protection**: Secure dashboard access gated behind an application password (`APP_PASSWORD`) with cookie-based session verification.

---

## 🏗️ Architecture Overview

```mermaid
flowchart TD
    subgraph Web ["Next.js Web Dashboard (Vercel / Node)"]
        UI["React 19 UI / Diet Builder"]
        API["Next.js API Routes (/api/*)"]
        UI <--> API
    end

    subgraph DB ["MongoDB Atlas / Database"]
        ConfigDoc[("Config & Settings")]
        SchedulerDoc[("Scheduler & Logs")]
        CacheDoc[("Cached AI Diet Plans")]
        GridFS[("WhatsApp Remote Session (GridFS)")]
    end

    subgraph AI ["Google Gemini API"]
        GeminiFlash["gemini-3.7-flash (Thinking Mode)"]
    end

    subgraph Worker ["WhatsApp Worker (Docker / VM)"]
        WorkerScript["whatsapp-worker.js"]
        PuppeteerEngine["Headless Chromium / whatsapp-web.js"]
        HealthServer["HTTP Health Server (:7860)"]
    end

    subgraph Recipients ["WhatsApp Recipients"]
        UserPhone["User WhatsApp (Part 1: Full Plan)"]
        CookPhone["Cook / Helper (Part 2: Cook Instructions)"]
    end

    API <--> ConfigDoc & SchedulerDoc & CacheDoc
    API -->|Prompt & Stream| GeminiFlash
    WorkerScript <--> GridFS & ConfigDoc & SchedulerDoc & CacheDoc
    WorkerScript -->|Prompt & Generate| GeminiFlash
    WorkerScript --> PuppeteerEngine
    PuppeteerEngine -->|Daily Scheduled Dispatch| UserPhone & CookPhone
```

---

## 🛠️ Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org/) (App Router, React 19, TypeScript)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Database**: [MongoDB](https://www.mongodb.com/) with [Mongoose](https://mongoosejs.com/)
- **AI & LLM**: Google Gemini API via [`@google/genai`](https://www.npmjs.com/package/@google/genai) & REST API
- **WhatsApp Engine**: [`whatsapp-web.js`](https://wwebjs.dev/) with Puppeteer & [`wwebjs-mongo`](https://www.npmjs.com/package/wwebjs-mongo) (GridFS session storage)
- **Containerization & Deployment**: Docker, GitHub Actions, Oracle Cloud VM, Hugging Face Spaces, GCP VM, Vercel

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: v20 or higher
- **MongoDB**: A running MongoDB instance (e.g., [MongoDB Atlas](https://www.mongodb.com/cloud/atlas))
- **Google Gemini API Key**: Obtainable from [Google AI Studio](https://aistudio.google.com/)

### 1. Clone the Repository

```bash
git clone https://github.com/ganganimaulik/AI-Diet-Maker.git
cd "AI Diet Maker"
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env.local` file in the root directory:

```bash
cp .env.example .env.local
```

Edit `.env.local` with your configuration:

```env
# MongoDB Connection String (Required)
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/diet-maker

# Dashboard Password (Optional - defaults to 'admin123' if not set)
APP_PASSWORD=your_secure_password

# Gemini API Key (Optional - can also be configured in the UI)
GEMINI_API_KEY=your_gemini_api_key_here

# Fireworks.ai API Key (Optional - required only when using the Fireworks provider)
FIREWORKS_API_KEY=your_fireworks_api_key_here

# Port for the WhatsApp worker health check server (Default: 7860)
PORT=7860
```

### 4. Run the Web Dashboard

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. Log in with your configured `APP_PASSWORD`.

### 5. Run the WhatsApp Worker (Optional for Local Testing)

To run the background WhatsApp worker locally:

```bash
node whatsapp-worker.js
```

Once started, navigate to the **Connections** tab in the dashboard to scan the QR code and pair your WhatsApp account.

---

## ⚙️ Environment Variables Reference

| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `MONGODB_URI` | **Yes** | — | MongoDB connection string for configuration, caches, and WhatsApp session storage. |
| `APP_PASSWORD` | No | `admin123` | Master password for web dashboard login. |
| `GEMINI_API_KEY` | No | — | Google AI Studio Gemini API Key (can also be entered directly in the web UI). |
| `FIREWORKS_API_KEY` | No | — | Fireworks.ai API Key, used when the provider is set to Fireworks (can also be entered directly in the web UI). Never falls back to `GEMINI_API_KEY`. |
| `PORT` | No | `7860` | HTTP port for the worker's diagnostic & health check server. |
| `PUPPETEER_EXECUTABLE_PATH` | No | *Auto-detected* | Custom path to Chromium executable if not using Puppeteer's bundled Chrome. |
| `DNS_SERVERS` | No | `1.1.1.1 8.8.8.8 1.0.0.1` | Custom DNS resolvers for the Docker container entrypoint. |

---

## 🚢 Deployment Guide

### 1. Web Dashboard (Vercel)

1. Push your repository to GitHub.
2. Import the project into [Vercel](https://vercel.com).
3. Set the environment variables in Vercel Project Settings:
   - `MONGODB_URI`
   - `APP_PASSWORD`
   - `GEMINI_API_KEY`
   - `FIREWORKS_API_KEY` (only if using the Fireworks provider)
4. Deploy!

### 2. WhatsApp Worker

The WhatsApp worker runs headless Chromium and should be hosted on an always-on container or VM.

#### Option A: Oracle Cloud Always-Free VM (Recommended)
An automated GitHub Actions workflow is provided in `.github/workflows/deploy-oracle.yml`:
1. Provision an Oracle Cloud Always-Free compute instance with Docker installed.
2. Set the following repository secrets in GitHub:
   - `ORACLE_HOST`
   - `ORACLE_USER`
   - `ORACLE_SSH_KEY`
3. Configure `~/worker.env` on the remote VM containing `MONGODB_URI` and `GEMINI_API_KEY` (plus `FIREWORKS_API_KEY` if using the Fireworks provider).
4. Pushing changes to `main` touching worker files automatically builds and redeploys the Docker container.

#### Option B: Hugging Face Spaces (Docker SDK)
The repository includes a `Dockerfile` compatible with Hugging Face Spaces:
1. Create a new Docker Space on Hugging Face.
2. Set repository secrets in GitHub:
   - `HF_TOKEN`
3. Run or enable `.github/workflows/sync-to-hub.yml` to automatically push and build on Hugging Face Spaces.
4. Add `MONGODB_URI` and `GEMINI_API_KEY` (plus `FIREWORKS_API_KEY` if using the Fireworks provider) in the Space's Settings secrets.

#### Option C: Standalone Docker Run
To build and run the worker on any server or local Docker daemon:

```bash
docker build -t diet-worker .

docker run -d \
  --name diet-worker \
  --restart unless-stopped \
  -p 7860:7860 \
  -e MONGODB_URI="your_mongodb_uri" \
  -e GEMINI_API_KEY="your_gemini_api_key" \
  -e FIREWORKS_API_KEY="your_fireworks_api_key" \
  diet-worker
```

---

## 📁 Project Structure

```
.
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/           # Login & session check routes
│   │   │   ├── cache/          # Diet plan response cache endpoints
│   │   │   ├── config/         # Diet configuration load & save endpoints
│   │   │   ├── generate/       # Gemini streaming generation API
│   │   │   └── whatsapp/       # WhatsApp status, contacts, test sends, session reset
│   │   ├── globals.css         # Global dark theme styling
│   │   ├── layout.tsx          # Root layout
│   │   └── page.tsx            # Main application controller & views
│   ├── components/
│   │   ├── AppHeader.tsx       # App navigation header & save triggers
│   │   ├── LoginScreen.tsx     # Authentication modal
│   │   ├── connections/        # WhatsApp, Gemini API, Scheduler, & Hugging Face cards
│   │   └── planner/            # Diet builder, meal editor, daily variables, output panels
│   ├── hooks/
│   │   ├── useConfigActions.ts # Meal & split CRUD operations
│   │   ├── useDietCache.ts     # Diet plan caching & invalidation hooks
│   │   └── useWhatsApp.ts      # WhatsApp status & scheduler management hooks
│   └── lib/
│       ├── auth.ts             # Password authentication & cookie helpers
│       ├── compile-prompt.js   # Dynamic prompt compiler & template engine
│       ├── compute-config-hash.js # Deterministic configuration hash generator
│       ├── db.ts               # Mongoose connection manager
│       ├── gemini.js           # Gemini API client & response parsers
│       ├── markdown.ts         # Markdown formatter & Part 1/Part 2 extractor
│       ├── models.js           # Mongoose schemas (Config, Scheduler, WhatsAppState, etc.)
│       └── types.ts            # TypeScript interfaces & default diet configuration
├── .github/workflows/          # CI/CD deployment workflows (Oracle, GCP, HF Spaces)
├── Dockerfile                  # Worker container definition with Chromium dependencies
├── docker-entrypoint.sh        # Docker startup script with DNS resolver setup
├── package.json                # Project dependencies & scripts
├── whatsapp-worker.js          # Standalone WhatsApp worker & scheduler daemon
└── README.md                   # Project documentation
```

---

## 📄 License

This project is private and proprietary. All rights reserved.
