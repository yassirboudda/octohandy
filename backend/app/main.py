"""Stockflow hackathon API — binds 127.0.0.1:3000 behind nginx. Do not bind :8080 (OpenShell)."""

from __future__ import annotations

import time
import uuid
from typing import Any, Literal

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from jose import jwk, jwt
from jose.exceptions import JWTError
from pydantic import BaseModel, Field

from .settings import settings

app = FastAPI(title="Stockflow API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory POV store (replace with DB later)
_shops: dict[str, list[dict[str, Any]]] = {}
_stock: dict[str, list[dict[str, Any]]] = {}
_teams: dict[str, dict[str, Any]] = {}  # code -> team
_jwks_cache: dict[str, Any] = {"at": 0.0, "keys": []}


def _default_shops() -> list[dict[str, Any]]:
    return [
        {"id": "s1", "marketplace": "vinted", "displayName": "lola_du75", "status": "connected", "listingCount": 42},
        {"id": "s2", "marketplace": "leboncoin", "displayName": "Leboncoin", "status": "expired", "listingCount": 8},
    ]


def _default_stock(owner: str) -> list[dict[str, Any]]:
    return [
        {"id": "i1", "title": "Masque Halloween", "qty": 3, "price": 12, "marketplace": "vinted", "ownerLabel": owner},
        {"id": "i2", "title": "Veste jean vintage", "qty": 1, "price": 35, "marketplace": "vinted", "ownerLabel": owner},
        {"id": "i3", "title": "Lampe design", "qty": 2, "price": 45, "marketplace": "leboncoin", "ownerLabel": owner},
    ]


async def _jwks() -> list[dict[str, Any]]:
    now = time.time()
    if _jwks_cache["keys"] and now - _jwks_cache["at"] < 3600:
        return _jwks_cache["keys"]
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(settings.clerk_jwks_url)
        r.raise_for_status()
        keys = r.json().get("keys", [])
    _jwks_cache["at"] = now
    _jwks_cache["keys"] = keys
    return keys


async def require_user(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    try:
        header = jwt.get_unverified_header(token)
        keys = await _jwks()
        jwk_dict = next((k for k in keys if k.get("kid") == header.get("kid")), None)
        if not jwk_dict:
            raise HTTPException(401, "Unknown signing key")
        key = jwk.construct(jwk_dict)
        claims = jwt.decode(
            token,
            key.to_pem().decode("utf-8") if hasattr(key, "to_pem") else key,
            algorithms=[header.get("alg", "RS256")],
            options={"verify_aud": False},
        )
    except HTTPException:
        raise
    except JWTError as e:
        raise HTTPException(401, f"Invalid token: {e}") from e
    except Exception as e:
        raise HTTPException(401, f"Invalid token: {e}") from e
    sub = claims.get("sub")
    if not sub:
        raise HTTPException(401, "No subject")
    return {"user_id": sub, "claims": claims}


@app.get("/health")
@app.get("/")
def health():
    return {
        "ok": True,
        "service": "stockflow-api",
        "backend": True,
        "model": settings.nebius_model,
        "hint": "API live on 127.0.0.1:3000 via nginx :80/:8080",
    }


@app.get("/v1/me")
async def me(user: dict[str, Any] = Depends(require_user)):
    return {"userId": user["user_id"]}


@app.get("/v1/shops")
async def list_shops(user: dict[str, Any] = Depends(require_user)):
    uid = user["user_id"]
    if uid not in _shops:
        _shops[uid] = _default_shops()
    return {"shops": _shops[uid]}


class ShopIn(BaseModel):
    marketplace: Literal["vinted", "leboncoin"]
    displayName: str
    status: Literal["connected", "expired"] = "connected"
    listingCount: int = 0


@app.post("/v1/shops")
async def create_shop(body: ShopIn, user: dict[str, Any] = Depends(require_user)):
    uid = user["user_id"]
    shops = _shops.setdefault(uid, _default_shops())
    shop = {"id": f"s-{uuid.uuid4().hex[:8]}", **body.model_dump()}
    shops.append(shop)
    return {"shop": shop}


@app.get("/v1/stock")
async def list_stock(user: dict[str, Any] = Depends(require_user)):
    uid = user["user_id"]
    if uid not in _stock:
        _stock[uid] = _default_stock("toi")
    return {"items": _stock[uid]}


class StockIn(BaseModel):
    title: str
    qty: int = 1
    price: float | None = None
    marketplace: str | None = None
    ownerLabel: str = "toi"


@app.post("/v1/stock")
async def add_stock(body: StockIn, user: dict[str, Any] = Depends(require_user)):
    uid = user["user_id"]
    items = _stock.setdefault(uid, _default_stock("toi"))
    item = {"id": f"i-{uuid.uuid4().hex[:8]}", **body.model_dump()}
    items.append(item)
    return {"item": item}


class TeamCreate(BaseModel):
    name: str
    member: str = "toi"


@app.post("/v1/teams")
async def create_team(body: TeamCreate, user: dict[str, Any] = Depends(require_user)):
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    code = "".join(alphabet[int(uuid.uuid4().int % 32)] for _ in range(6))
    # better random
    import random

    code = "".join(random.choice(alphabet) for _ in range(6))
    team = {
        "code": code,
        "name": body.name,
        "members": [body.member],
        "ownerUserId": user["user_id"],
        "memberUserIds": [user["user_id"]],
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    _teams[code] = team
    return {"team": team}


class TeamJoin(BaseModel):
    code: str
    member: str = "toi"


@app.post("/v1/teams/join")
async def join_team(body: TeamJoin, user: dict[str, Any] = Depends(require_user)):
    code = body.code.strip().upper()
    team = _teams.get(code)
    if not team:
        # POV: create empty shared team bucket if code unknown but valid length
        if len(code) != 6:
            raise HTTPException(404, "Team not found")
        team = {
            "code": code,
            "name": f"Équipe {code}",
            "members": [body.member],
            "ownerUserId": user["user_id"],
            "memberUserIds": [user["user_id"]],
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        _teams[code] = team
    else:
        if body.member not in team["members"]:
            team["members"].append(body.member)
        if user["user_id"] not in team["memberUserIds"]:
            team["memberUserIds"].append(user["user_id"])
            # merge stock into joiner from owner seed POV
            peer_items = _default_stock(body.member)
            mine = _stock.setdefault(user["user_id"], _default_stock("toi"))
            seen = {(i["title"], i["ownerLabel"]) for i in mine}
            for p in peer_items:
                key = (p["title"], p["ownerLabel"])
                if key not in seen:
                    mine.append({**p, "id": f"peer-{uuid.uuid4().hex[:8]}"})
    return {"team": team}


class ChatIn(BaseModel):
    message: str = Field(min_length=1)
    images: list[str] = Field(default_factory=list)


@app.post("/v1/chat")
async def chat(body: ChatIn, user: dict[str, Any] = Depends(require_user)):
    """Chat via Nebius Token Factory (DeepSeek). Falls back to mock if key missing."""
    if not settings.nebius_api_key:
        return {
            "role": "assistant",
            "content": f"(mock) Reçu: {body.message[:200]} — configure NEBIUS_API_KEY pour le vrai modèle.",
            "model": "mock",
        }

    system = (
        "Tu es Stockflow, assistant marketplace (Vinted / Leboncoin). "
        "Réponds en français, concis, utile pour stock, prix, messages clients et workflows."
    )
    user_content: Any = body.message
    if body.images:
        user_content = [
            {"type": "text", "text": body.message},
            *[{"type": "text", "text": f"[image attachée: {u[:80]}]"} for u in body.images[:4]],
        ]

    payload = {
        "model": settings.nebius_model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user_content},
        ],
        "temperature": 0.4,
    }
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(
                f"{settings.nebius_base_url.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {settings.nebius_api_key}"},
                json=payload,
            )
            if r.status_code >= 400:
                raise HTTPException(502, f"Nebius error {r.status_code}: {r.text[:300]}")
            data = r.json()
            content = data["choices"][0]["message"]["content"]
            return {"role": "assistant", "content": content, "model": settings.nebius_model}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Chat failed: {e}") from e


@app.get("/v1/workflows")
async def workflows():
    return {
        "workflows": [
            {
                "id": "vinted-fav-offer",
                "marketplace": "vinted",
                "title": "Favoris → offre discount",
                "steps": [
                    "Client met un article en favoris",
                    "Détection via messagerie / notif",
                    "Envoi d'un message avec proposition de prix (discount)",
                ],
            },
            {
                "id": "vinted-bump",
                "marketplace": "vinted",
                "title": "Annonce dormante → baisse auto",
                "steps": ["Annonce sans vue depuis N jours", "Calcul d'une baisse X%", "Mise à jour prix + message optionnel"],
            },
            {
                "id": "lbc-first-msg",
                "marketplace": "leboncoin",
                "title": "Premier message → réponse type",
                "steps": ["Nouveau message acheteur", "Classement intent", "Réponse template + plancher vendeur"],
            },
            {
                "id": "multi-restock",
                "marketplace": "multi",
                "title": "Stock équipe → republish",
                "steps": ["Article ajouté au stock partagé", "Choix marketplace", "Création / republication"],
            },
        ]
    }
