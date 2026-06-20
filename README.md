# TTB Label Verification

Phase 0 scaffold for the TTB Label Verification proof-of-concept.

## Local Setup

Install backend dependencies:

```bash
cd backend
uv sync
```

Install frontend dependencies:

```bash
cd frontend
npm install
```

Create local environment files:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Run tests:

```bash
cd backend
uv run pytest
```

Run the frontend build:

```bash
cd frontend
npm run build
```

Run the backend locally:

```bash
cd backend
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Run the frontend locally in a second terminal:

```bash
cd frontend
npm run dev
```

Verify:

- API health: http://localhost:8000/health
- Frontend: http://localhost:5173/

## Deploy Backend To Render

Create a Render Web Service connected to this repo.

Use these settings:

- Environment: Python
- Root directory: `backend`
- Build command: `pip install uv && uv sync --frozen --no-dev`
- Start command: `.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Plan: Free
- Health check path: `/health`
- Environment variable: `PYTHON_VERSION=3.12.13`

Set this environment variable after the frontend has a deployed URL:

```text
CORS_ORIGINS=https://<your-frontend-domain>
```

After deploy, verify:

- `https://<your-service>.onrender.com/health`

## Deploy Frontend To Vercel

Create a Vercel project connected to this repo.

Use these settings:

- Framework preset: Vite
- Build command: `cd frontend && npm ci && npm run build`
- Output directory: `frontend/dist`
- Install command: `cd frontend && npm ci`

Set this environment variable:

```text
VITE_API_BASE_URL=https://<your-render-backend>.onrender.com
```

After deploy, visit the Vercel URL. The frontend should show the backend `/health` response.

## Secrets

Use `backend/.env.example`, and `frontend/.env.example` as the lists of required variables. Put real values only in local `.env` files or host environment variable dashboards.
