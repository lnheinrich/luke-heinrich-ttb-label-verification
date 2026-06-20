import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv


load_dotenv()


APP_NAME = "ttb-label-verification"

# Local frontend origins used when CORS_ORIGINS is not configured.
DEFAULT_CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

app = FastAPI(title="TTB Label Verification")

# Comma-separated origins allow local and deployed frontends to coexist.
cors_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "").split(",")
    if origin.strip()
] or DEFAULT_CORS_ORIGINS

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
)


# Lightweight deploy and uptime check endpoint.
@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": APP_NAME}
