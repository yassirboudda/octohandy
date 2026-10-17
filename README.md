# Stockflow (hackathon)

Front Next.js + backend FastAPI for a hackathon team. Inspired by [Comie](https://comie.amirelay.com).

## Live

- Front: https://stockflow.amirelay.com (primary)
- Fallback: https://stockflow-nine-ashy.vercel.app
- Repo: https://github.com/yassirboudda/hackathon
- API (Hetzner): http://178.104.100.35/health (also `:8080/health`)
- Browser calls API via same-origin `/backend/*` (Next rewrite → VPS)

## Features

- **Clerk** login (same instance as Comie)
- **Chat** + image upload → Nebius DeepSeek via backend
- **Boutique** / **Stock** (team invite code) / **Workflows** templates

## Security

**Never commit secrets** to this public repo. Put keys only in:

- VPS `/home/deploy/apps/stockflow-api/.env`
- Hermes `~/.config/hackathon/nebius.env`
- Vercel project env vars
- Private team handoff markdown (not in git)

`backend/.env.example` is a template only.

## Dev (front)

```bash
cp .env.example .env.local
# fill Clerk keys (from team handoff / Vercel)
npm install
npm run dev
```

## Backend (VPS)

Code: `backend/` in this repo. Deploy path on server: `/home/deploy/apps/stockflow-api`.

```bash
rsync -az -e "ssh -i ~/.ssh/hackathon_ed25519" \
  --exclude '.venv' --exclude '.env' --exclude '__pycache__' \
  ./backend/ deploy@178.104.100.35:/home/deploy/apps/stockflow-api/
ssh -i ~/.ssh/hackathon_ed25519 deploy@178.104.100.35 \
  'sudo systemctl restart stockflow-api && curl -sS http://127.0.0.1:3000/health'
```

Do not bind the app to `:8080` (reserved for NemoClaw OpenShell).

## Deploy front

```bash
git push origin main
# Vercel auto-deploys from GitHub
```
