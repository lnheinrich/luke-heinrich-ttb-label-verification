# TTB Label Verification

A proof-of-concept web application for checking alcohol beverage label images against structured application data.

The app accepts a label image plus seven application fields, extracts label text with a vision model, compares each field with a deliberate matching strategy, and returns per-field `PASS` / `FAIL` plus an overall `APPROVED` / `NEEDS_REVIEW` verdict.

## Live URLs

- Frontend: https://ttb-label-verification-frontend.vercel.app
- Backend health check: https://ttb-label-verification-backend.onrender.com/health

The backend is hosted on Render's free tier, so the first request after inactivity may have a cold-start delay.

## Features

- Single-label verification flow.
- Batch verification flow with summary counts and per-label drill-down.
- Image preprocessing before model extraction to reduce latency and cost.
- Structured JSON extraction from Google AI.
- Field-by-field comparison with expected-vs-found output.
- Stateless backend with no database or persisted uploads.
- Human-readable errors for invalid files, missing inputs, and provider failures.

## Architecture

```text
React/Vite frontend
  -> multipart/form-data image + JSON application data
FastAPI backend
  -> validation
  -> image preprocess
  -> Google AI vision extraction
  -> comparison engine
  -> VerificationResult / BatchResult
```

Main backend endpoints:

- `GET /health`
- `POST /verify`
- `POST /verify/batch`

## Comparison Strategy

The comparison engine is pure Python logic and is tested without model calls.

| Field | Strategy |
| --- | --- |
| Brand Name | normalized fuzzy/contains match with minimum input length guard |
| Class / Type | normalized fuzzy/contains match, including whiskey/whisky handling |
| Alcohol Content | numeric percent comparison with `+/- 0.1` tolerance |
| Bottle Size | unit normalization to milliliters |
| Producer | normalized fuzzy/contains match |
| Country of Origin | normalized aliases such as `USA`, `U.S.A.`, `America`, `United States` |
| Government Warning | exact case-sensitive comparison after whitespace collapse only |

Any failed field returns `NEEDS_REVIEW`; all fields passing returns `APPROVED`.

## Tech Stack

- Backend: Python 3.12, FastAPI, Pydantic, Pillow, RapidFuzz, Google Gen AI SDK
- Frontend: React, Vite, JavaScript, CSS
- Deployment: Render backend, Vercel frontend
- Dependency managers: `uv` for Python, `npm` for frontend

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

Set backend environment variables:

```text
CORS_ORIGINS=http://localhost:5173
GOOGLEAI_API_KEY=<your Google AI API key>
GOOGLEAI_MODEL=gemini-2.5-flash
```

Set frontend environment variables:

```text
VITE_API_BASE_URL=http://localhost:8000
```

## Run Locally

Start the backend:

```bash
cd backend
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Start the frontend in another terminal:

```bash
cd frontend
npm run dev
```

Local URLs:

- Backend health: http://localhost:8000/health
- Frontend: http://localhost:5173

## Tests And Build

Run backend tests:

```bash
cd backend
uv run pytest
```

If `uv` is not on your shell path but the virtual environment already exists:

```bash
cd backend
./.venv/bin/pytest
```

Run frontend build:

```bash
cd frontend
npm run build
```

## Deployment

### Render Backend

Create a Render Web Service connected to the repo.

Use these settings:

- Runtime: Python
- Root directory: `backend`
- Build command: `pip install uv && uv sync --frozen --no-dev`
- Start command: `.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Health check path: `/health`
- Plan: Free

Required Render environment variables:

```text
PYTHON_VERSION=3.12.13
PYTHONUNBUFFERED=1
CORS_ORIGINS=https://ttb-label-verification-frontend.vercel.app
GOOGLEAI_API_KEY=<set in Render dashboard>
GOOGLEAI_MODEL=gemini-2.5-flash
```

### Vercel Frontend

Create a Vercel project connected to the repo.

Use these settings:

- Framework preset: Vite
- Root directory: repository root
- Install command: `cd frontend && npm ci`
- Build command: `cd frontend && npm run build`
- Output directory: `frontend/dist`

Required Vercel environment variable:

```text
VITE_API_BASE_URL=https://ttb-label-verification-backend.onrender.com
```


## Assumptions And Limitations

- The app is stateless; it does not save uploads, results, or user sessions.
- Vision extraction can vary with image quality, glare, angle, blur, and provider availability.
- Google AI provider latency or rate limiting can cause occasional slow or failed extraction requests.
- Render free tier may cold start after inactivity.
- Government warning matching is intentionally strict and case-sensitive; OCR mistakes should result in `NEEDS_REVIEW` so a human can inspect the extracted text.
- The proof-of-concept is intended for review workflow support, not automatic legal approval.
