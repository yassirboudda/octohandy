from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    host: str = "127.0.0.1"
    port: int = 3000
    cors_origins: str = (
        "https://stockflow.amirelay.com,"
        "https://stockflow-nine-ashy.vercel.app,"
        "http://localhost:3000"
    )
    clerk_secret_key: str = ""
    clerk_publishable_key: str = ""
    clerk_jwks_url: str = "https://clerk.amirelay.com/.well-known/jwks.json"
    nebius_api_key: str = ""
    nebius_base_url: str = "https://api.tokenfactory.nebius.com/v1"
    nebius_model: str = "deepseek-ai/DeepSeek-V4.1-Flash"
    hermes_gateway_url: str = "http://127.0.0.1:18789"
    hermes_api_url: str = "http://127.0.0.1:8642/v1"
    hermes_api_key: str = ""
    hermes_model: str = "hermes-agent"
    hermes_timeout: float = 120

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
