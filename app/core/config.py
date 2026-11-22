
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    
    app_name: str = "SupportFlow AI"
    app_version: str = "0.1.0"
    debug: bool = False
    environment: str = "development"

    
    database_url: str

    direct_database_url: str | None = None

    frontend_url:str | None=None
    secret_key: str
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30

    
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-3.8-flash"

    
    redis_url: str = "redis://localhost:6380/0"

    
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str | None = None
    smtp_use_tls: bool = True

    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
