# Sawt AI

**Call every lead in seconds. Close more without dialing.**

Sawt AI's voice agents phone your new leads the moment they sign up, qualify them in natural Arabic or English, and book the meeting — 24/7, at any volume.

<p align="center">
  <a href="https://sawtai.vercel.app">
    <img src="https://img.shields.io/badge/▶_Try_Sawt_AI-sawtai.vercel.app-2563eb?style=for-the-badge" alt="Try Sawt AI">
  </a>
  &nbsp;
  <a href="#-run-it-locally">
    <img src="https://img.shields.io/badge/⚙️_Run_locally-Dev_setup-111827?style=for-the-badge" alt="Run locally">
  </a>
</p>

## Why Sawt AI

Speed wins the deal, but most leads never get a fast call:

- Leads go cold while they wait hours for a callback
- Your team burns the day dialing numbers that never pick up
- After-hours and weekend enquiries simply get lost

Sawt AI is an AI caller that works every lead the moment it lands.

## ✨ Features

- **Call every lead in seconds** — the moment someone submits your ad form, Sawt dials them while your brand is still on their mind.
- **Speaks like your customers** — natural Arabic and English that follows the caller's dialect and switches language mid-sentence when they do.
- **Qualifies and books** — asks your qualifying questions, handles objections, and drops the meeting straight into your calendar.
- **Design calls visually** — build the conversation flow on a drag-and-drop canvas. No code, no scripts to babysit.
- **Follow-up that never forgets** — automatic retries and multi-step sequences reach the people who missed the first call.
- **Every call, measured** — recordings, transcripts, and outcomes for every conversation, so you know exactly what converts.

## 🔌 Lead sources

Sawt plugs into the lead sources you already run:

- Meta Lead Ads (Facebook instant forms)
- Instagram lead generation
- Google Ads lead forms
- LinkedIn Lead Gen Forms
- Your own web forms
- Any tool, via a generic webhook

## 🏢 Built for

| | |
|---|---|
| **Real estate** | Call every property enquiry instantly, confirm budget and area, and book the viewing before a competitor phones back. |
| **Clinics & services** | Answer and return calls around the clock, collect patient details, and fill your schedule without extra staff. |
| **Sales teams** | Let Sawt do the first touch and the qualifying, so your closers spend their day with buyers who are ready. |

## 💳 Pricing

Pay for conversations, not seats. Buy call credits and top up as you grow — you only pay for the minutes your agents talk. See [sawtai.vercel.app](https://sawtai.vercel.app/#pricing) for plans.

## 🧱 Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS (`ui/`) |
| Backend | Python, FastAPI (`api/`) |
| Voice pipeline | [Pipecat](https://github.com/pipecat-ai/pipecat) (`pipecat/`, git submodule) |
| Database | PostgreSQL (async SQLAlchemy) |
| Cache / queue | Redis with ARQ background workers |
| Storage | MinIO / S3-compatible storage for call recordings |
| Telephony | Twilio, plus WebRTC for in-browser test calls |

## 🚀 Run it locally

You need Git, Docker (e.g. Docker Desktop), and VS Code with the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers).

1. Clone the repo and open it in VS Code, then run **Dev Containers: Reopen in Container**. The first build starts Postgres, Redis, and MinIO, creates the `.env` files, and installs dependencies.

2. Start the backend from a terminal inside the container:

   ```bash
   bash scripts/start_services_dev.sh
   ```

3. Start the UI from a second terminal:

   ```bash
   cd ui && npm run dev -- --hostname 0.0.0.0
   ```

4. Open [http://localhost:3000](http://localhost:3000).

Configuration lives in `api/.env` (backend), `api/.env.test` (tests), and `ui/.env` (frontend). For the full guide, see [docs/contribution/setup.mdx](docs/contribution/setup.mdx).

## 📁 Repository layout

```text
api/        FastAPI backend
ui/         Next.js frontend
pipecat/    Pipecat voice framework (git submodule)
scripts/    Local development helpers
docs/       Documentation
```

## 📄 License & credits

Sawt AI is built on the open-source [Dograh](https://github.com/dograh-hq/dograh) voice AI platform and is distributed under the [BSD 2-Clause License](LICENSE), which retains the original copyright notice.
