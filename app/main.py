from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.core.config import settings
from app.db.database import SessionLocal
from app.routers.auth import router as auth_router
from app.routers.ticket import router as ticket_router
from app.routers.admin import router as admin_router


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description=(
        "SupportFlow AI — role-based support tickets with ResolveIQ "
        "(grounded analysis + customer chat + human approval)."
    ),
)


@app.get("/")
def home():
    return {
        "message": "Welcome to SupportFlow AI",
        "docs": "/docs",
        "health": "/health",
        "diagnostics": "/diagnostics",
    }


@app.get("/health")
def health():
    return {
        "application_name": settings.app_name,
        "status": "running",
        "version": settings.app_version,
    }


@app.get("/diagnostics")
def diagnostics():

    db_ok = False
    db_error = None

    try:
        db = SessionLocal()

        try:
            db.execute(text("SELECT 1"))
            db_ok = True
        finally:
            db.close()

    except Exception as exc:
        db_error = str(exc)[:200]

    redis_ok = False
    redis_error = None

    try:
        import redis

        client = redis.Redis.from_url(
            settings.redis_url,
            socket_connect_timeout=1.5,
            socket_timeout=1.5,
        )

        redis_ok = bool(client.ping())

    except Exception as exc:
        redis_error = str(exc)[:200]

    gemini_configured = bool(
        (settings.gemini_api_key or "").strip()
    )

    return {
        "status": "ok" if db_ok else "degraded",
        "app": settings.app_name,
        "version": settings.app_version,
        "environment": settings.environment,
        "checks": {
            "database": {
                "ok": db_ok,
                "error": db_error,
            },
            "redis": {
                "ok": redis_ok,
                "error": redis_error,
            },
            "gemini_api_key_configured": gemini_configured,
            "gemini_model": settings.gemini_model,
        },
    }


app.include_router(auth_router)
app.include_router(ticket_router)
app.include_router(admin_router)


# Frontend URLs allowed to communicate with the API.
allowed_origins = [
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
]

if settings.frontend_url:
    allowed_origins.append(
        settings.frontend_url.rstrip("/")
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)