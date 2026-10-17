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
_listings: dict[str, list[dict[str, Any]]] = {}
_stock: dict[str, list[dict[str, Any]]] = {}
_teams: dict[str, dict[str, Any]] = {}  # code -> team
_ext_tokens: dict[str, dict[str, Any]] = {}  # sfx_… -> {user_id, name, createdAt}
_jwks_cache: dict[str, Any] = {"at": 0.0, "keys": []}


def _default_shops() -> list[dict[str, Any]]:
    return [
        {"id": "s1", "marketplace": "vinted", "displayName": "lola_du75", "status": "connected", "listingCount": 6},
        {"id": "s2", "marketplace": "leboncoin", "displayName": "Leboncoin", "status": "connected", "listingCount": 4},
    ]


def _default_listings() -> list[dict[str, Any]]:
    def day(n: int) -> str:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - n * 86400))

    return [
        {"id": "l1", "shopId": "s1", "marketplace": "vinted", "title": "Masque Halloween LED", "price": 12, "status": "active", "views": 48, "favorites": 6, "updatedAt": day(0), "url": "https://www.vinted.fr"},
        {"id": "l2", "shopId": "s1", "marketplace": "vinted", "title": "Veste jean vintage", "price": 35, "status": "active", "views": 120, "favorites": 18, "updatedAt": day(1), "url": "https://www.vinted.fr"},
        {"id": "l3", "shopId": "s1", "marketplace": "vinted", "title": "Sneakers blanches 40", "price": 28, "status": "reserved", "views": 90, "favorites": 11, "updatedAt": day(2), "url": "https://www.vinted.fr"},
        {"id": "l4", "shopId": "s1", "marketplace": "vinted", "title": "Sac bandoulière cuir", "price": 42, "status": "active", "views": 33, "favorites": 4, "updatedAt": day(3), "url": "https://www.vinted.fr"},
        {"id": "l5", "shopId": "s1", "marketplace": "vinted", "title": "Pull oversize beige", "price": 18, "status": "sold", "views": 210, "favorites": 27, "updatedAt": day(5), "url": "https://www.vinted.fr"},
        {"id": "l6", "shopId": "s1", "marketplace": "vinted", "title": "Montre minimaliste", "price": 55, "status": "active", "views": 67, "favorites": 9, "updatedAt": day(4), "url": "https://www.vinted.fr"},
        {"id": "l7", "shopId": "s2", "marketplace": "leboncoin", "title": "Lampe design scandinave", "price": 45, "status": "active", "views": 22, "favorites": 3, "updatedAt": day(0), "url": "https://www.leboncoin.fr"},
        {"id": "l8", "shopId": "s2", "marketplace": "leboncoin", "title": "Fauteuil velours vert", "price": 120, "status": "active", "views": 41, "favorites": 7, "updatedAt": day(2), "url": "https://www.leboncoin.fr"},
        {"id": "l9", "shopId": "s2", "marketplace": "leboncoin", "title": "Lot déco Halloween", "price": 25, "status": "reserved", "views": 15, "favorites": 2, "updatedAt": day(1), "url": "https://www.leboncoin.fr"},
        {"id": "l10", "shopId": "s2", "marketplace": "leboncoin", "title": "Console TV bois", "price": 90, "status": "active", "views": 58, "favorites": 5, "updatedAt": day(6), "url": "https://www.leboncoin.fr"},
    ]


def _default_stock(owner: str) -> list[dict[str, Any]]:
    return [
        {"id": "i1", "title": "Masque Halloween", "qty": 3, "price": 12, "marketplace": "vinted", "ownerLabel": owner},
        {"id": "i2", "title": "Veste jean vintage", "qty": 1, "price": 35, "marketplace": "vinted", "ownerLabel": owner},
        {"id": "i3", "title": "Lampe design", "qty": 2, "price": 45, "marketplace": "leboncoin", "ownerLabel": owner},
    ]


def _sync_listing_counts(uid: str) -> None:
    shops = _shops.setdefault(uid, _default_shops())
    listings = _listings.setdefault(uid, _default_listings())
    for shop in shops:
        shop["listingCount"] = sum(1 for l in listings if l.get("shopId") == shop["id"])


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

    # Extension long-lived token (sfx_…)
    if token.startswith("sfx_"):
        meta = _ext_tokens.get(token)
        if not meta:
            raise HTTPException(401, "Unknown extension token")
        return {"user_id": meta["user_id"], "via": "extension", "claims": {}}

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
    return {"user_id": sub, "via": "clerk", "claims": claims}


@app.get("/health")
@app.get("/")
def health():
    return {
        "ok": True,
        "service": "stockflow-api",
        "backend": True,
        "model": settings.nebius_model,
        "hermes": bool(settings.hermes_api_key),
        "hermesUrl": settings.hermes_api_url,
        "hint": "API live on 127.0.0.1:3000 via nginx :80/:8080",
    }


@app.get("/v1/me")
async def me(user: dict[str, Any] = Depends(require_user)):
    return {"userId": user["user_id"]}


@app.get("/v1/shops")
async def list_shops(user: dict[str, Any] = Depends(require_user)):
    uid = user["user_id"]
    _sync_listing_counts(uid)
    return {"shops": _shops[uid]}


@app.get("/v1/listings")
async def list_listings(shopId: str | None = None, user: dict[str, Any] = Depends(require_user)):
    uid = user["user_id"]
    listings = _listings.setdefault(uid, _default_listings())
    if shopId:
        listings = [l for l in listings if l.get("shopId") == shopId]
    return {"listings": listings}


@app.get("/v1/shops/{shop_id}/listings")
async def shop_listings(shop_id: str, user: dict[str, Any] = Depends(require_user)):
    uid = user["user_id"]
    listings = _listings.setdefault(uid, _default_listings())
    return {"listings": [l for l in listings if l.get("shopId") == shop_id]}


class ExtPairIn(BaseModel):
    name: str = "Chrome"


@app.post("/v1/extension/pair")
async def extension_pair(body: ExtPairIn, user: dict[str, Any] = Depends(require_user)):
    if user.get("via") == "extension":
        raise HTTPException(400, "Already an extension token")
    token = f"sfx_{uuid.uuid4().hex}"
    _ext_tokens[token] = {
        "user_id": user["user_id"],
        "name": body.name,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    return {"token": token}


@app.get("/v1/extension/me")
async def extension_me(user: dict[str, Any] = Depends(require_user)):
    return {"userId": user["user_id"], "via": user.get("via", "clerk")}


class ExtSessionIn(BaseModel):
    marketplace: Literal["vinted", "leboncoin"]
    displayName: str
    cookies: str
    cookieNames: list[str] = Field(default_factory=list)
    bearer: str | None = None
    csrf: str | None = None
    meta: dict[str, Any] = Field(default_factory=dict)


@app.post("/v1/extension/session")
async def extension_session(body: ExtSessionIn, user: dict[str, Any] = Depends(require_user)):
    """Receive marketplace cookies from the Chrome extension (stored in memory for POV)."""
    uid = user["user_id"]
    shops = _shops.setdefault(uid, _default_shops())
    _listings.setdefault(uid, _default_listings())

    if not body.cookies.strip():
        raise HTTPException(400, "cookies empty")

    existing = next((s for s in shops if s.get("marketplace") == body.marketplace), None)
    # Do not echo full cookies back to clients; keep server-side only.
    creds = {
        "cookies": body.cookies,
        "cookieNames": body.cookieNames,
        "bearer": body.bearer,
        "csrf": body.csrf,
        "meta": {**body.meta, "receivedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
    }
    if existing:
        existing["displayName"] = body.displayName or existing["displayName"]
        existing["status"] = "connected"
        existing["credentials"] = creds
        shop = existing
    else:
        shop = {
            "id": f"s-{uuid.uuid4().hex[:8]}",
            "marketplace": body.marketplace,
            "displayName": body.displayName,
            "status": "connected",
            "listingCount": 0,
            "credentials": creds,
        }
        shops.append(shop)
    _sync_listing_counts(uid)
    # Return shop without secrets
    safe = {k: v for k, v in shop.items() if k != "credentials"}
    safe["hasCredentials"] = True
    return {"ok": True, "shop": safe}


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
    """Chat via Hermes, then Nebius Token Factory (DeepSeek), or a mock response."""
    system = (
        "Tu es Stockflow, assistant marketplace (Vinted / Leboncoin). "
        "Réponds en français, concis, utile pour stock, prix, messages clients et workflows."
    )
    hermes_user_content: Any = body.message
    if body.images:
        hermes_user_content = [
            {"type": "text", "text": body.message},
            *[
                {"type": "image_url", "image_url": {"url": image_url}}
                for image_url in body.images[:4]
            ],
        ]
    hermes_messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": hermes_user_content},
    ]
    hermes_error = None

    if settings.hermes_api_key:
        try:
            async with httpx.AsyncClient(timeout=settings.hermes_timeout) as client:
                response = await client.post(
                    f"{settings.hermes_api_url.rstrip('/')}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {settings.hermes_api_key}",
                        "X-Hermes-Session-Key": f"stockflow-{user['user_id']}",
                    },
                    json={
                        "model": settings.hermes_model,
                        "messages": hermes_messages,
                        "stream": False,
                    },
                )
            if response.status_code >= 400:
                hermes_error = f"Hermes returned HTTP {response.status_code}"
            else:
                choice = response.json()["choices"][0]
                finish_reason = choice.get("finish_reason")
                if finish_reason in ("error", "cancelled"):
                    hermes_error = f"Hermes finish_reason: {finish_reason}"
                else:
                    return {
                        "role": "assistant",
                        "content": choice["message"]["content"],
                        "model": settings.hermes_model,
                        "via": "hermes",
                    }
        except httpx.RequestError as e:
            hermes_error = f"Hermes connection failed ({type(e).__name__})"
        except Exception as e:
            hermes_error = f"Hermes response invalid ({type(e).__name__})"
        if hermes_error:
            hermes_error = hermes_error[:200]

    if not settings.nebius_api_key:
        result = {
            "role": "assistant",
            "content": f"(mock) Reçu: {body.message[:200]} — configure NEBIUS_API_KEY pour le vrai modèle.",
            "model": "mock",
        }
        if hermes_error:
            result["hermesError"] = hermes_error
        return result

    nebius_user_content: Any = body.message
    if body.images:
        nebius_user_content = [
            {"type": "text", "text": body.message},
            *[{"type": "text", "text": f"[image attachée: {u[:80]}]"} for u in body.images[:4]],
        ]

    payload = {
        "model": settings.nebius_model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": nebius_user_content},
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
            result = {
                "role": "assistant",
                "content": content,
                "model": settings.nebius_model,
                "via": "nebius",
            }
            if hermes_error:
                result["hermesError"] = hermes_error
            return result
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
