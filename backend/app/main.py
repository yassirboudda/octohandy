"""OctoHandy API — binds 127.0.0.1:3000 behind nginx. Keep port 8080 reserved by the host."""

from __future__ import annotations

import asyncio
import json
import random
import re
import time
import uuid
from urllib.parse import urlencode
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
from jose import jwk, jwt
from jose.exceptions import JWTError
from pydantic import BaseModel, Field

from . import db
from .desktop import _desktop_enabled, _desktop_token
from .human import HumanProfile, click_point, from_trace, key_delays, move_path, pre_action_delay, typos
from .marketplaces import agent_context, get_doc, get_marketplace
from .rfb import DesktopInputError, RemoteDesktop, keysym_for_key
from .screen import (
    SCREENPIPE_STALE_OUTCOME,
    ScreenpipeFrameStaleError,
    find_target,
    frame_elements,
    latest_frame_id,
)
from .settings import settings


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    db.initialize_database()
    yield


app = FastAPI(title="OctoHandy API", version="0.1.0", lifespan=_lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_jwks_cache: dict[str, Any] = {"at": 0.0, "keys": []}
_organization_names: dict[str, str] = {}
_run_tasks: set[asyncio.Task[None]] = set()


def _build_chat_system_prompt() -> str:
    return (
        "Tu es OctoHandy, assistant marketplace. Réponds en français, de façon concise et "
        "utile pour le stock, les prix, les messages clients et les workflows. Tu couvres les "
        "marketplaces décrites dans la référence ci-dessous. Utilise-la pour décider si une "
        "action passe par l'API ou un screenpipe_workflow, et quelles confirmations vendeur/"
        "acheteur sont nécessaires.\n\n"
        f"{agent_context()}"
    )


def _default_shops() -> list[dict[str, Any]]:
    return [
        {"id": "s1", "marketplace": "vinted", "displayName": "lola_du75", "status": "connected", "listingCount": 6},
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
    ]


def _default_stock(owner: str) -> list[dict[str, Any]]:
    return [
        {"id": "i1", "title": "Masque Halloween", "qty": 3, "price": 12, "marketplace": "vinted", "ownerLabel": owner},
        {"id": "i2", "title": "Veste jean vintage", "qty": 1, "price": 35, "marketplace": "vinted", "ownerLabel": owner},
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

    # Extension long-lived token (sfx_…)
    if token.startswith("sfx_"):
        with db.connection() as conn:
            row = conn.execute("SELECT * FROM ext_tokens WHERE token = ?", (token,)).fetchone()
        meta = dict(row) if row else None
        if not meta:
            raise HTTPException(401, "Unknown extension token")
        workspace = meta["workspace"]
        return {
            "user_id": meta["user_id"],
            "workspace": workspace,
            "org_id": workspace[4:] if workspace.startswith("org:") else None,
            "via": "extension",
            "claims": {},
        }

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
    org_claim = claims.get("o") or {}
    org_id = org_claim.get("id") or claims.get("org_id")
    return {
        "user_id": sub,
        "workspace": f"org:{org_id}" if org_id else f"user:{sub}",
        "org_id": org_id,
        "via": "clerk",
        "claims": claims,
    }


async def workspace_user(user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    db.seed_workspace(
        user["workspace"],
        user["user_id"],
        personal=user.get("org_id") is None,
        shops=_default_shops(),
        listings=_default_listings(),
        stock=_default_stock("toi"),
    )
    return user


def _profile(user_id: str) -> dict[str, Any]:
    with db.connection() as conn:
        row = conn.execute("SELECT * FROM profiles WHERE user_id = ?", (user_id,)).fetchone()
    if row is None:
        return {"displayName": "", "preferences": {}}
    return {
        "displayName": row["display_name"],
        "preferences": json.loads(row["preferences"]),
    }


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


async def _clerk_api(
    method: str,
    path: str,
    body: dict[str, Any] | None = None,
) -> tuple[int, dict[str, Any]]:
    if not settings.clerk_secret_key:
        raise HTTPException(status_code=503, detail="Clerk API non configurée")
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.request(
            method,
            f"{settings.clerk_api_url.rstrip('/')}{path}",
            headers={"Authorization": f"Bearer {settings.clerk_secret_key}"},
            json=body,
        )
    try:
        payload = response.json()
    except ValueError:
        payload = {}
    return response.status_code, payload if isinstance(payload, dict) else {}


async def _organization_name(org_id: str, claims: dict[str, Any] | None = None) -> str:
    org_claim = (claims or {}).get("o") or {}
    claim_name = org_claim.get("name") or (claims or {}).get("org_name")
    if claim_name:
        _organization_names[org_id] = str(claim_name)
    if org_id not in _organization_names:
        code, data = await _clerk_api("GET", f"/organizations/{org_id}")
        if code >= 400:
            raise HTTPException(status_code=502, detail="Impossible de récupérer l'organisation")
        if data.get("name"):
            _organization_names[org_id] = str(data["name"])
    return _organization_names.get(org_id, org_id)


async def _chat_context(user: dict[str, Any]) -> str:
    profile = _profile(user["user_id"])
    display_name = profile["displayName"] or "membre sans nom renseigné"
    preferences = json.dumps(profile["preferences"], ensure_ascii=False, separators=(",", ":"))
    org_id = user.get("org_id")
    workspace = "Espace perso"
    if org_id:
        try:
            org_name = await _organization_name(org_id, user.get("claims"))
        except HTTPException:
            org_name = org_id
        workspace = f"Organisation {org_name}"
    with db.connection() as conn:
        workflows = conn.execute(
            """SELECT title, intent_json, guardrails_json FROM workflows
               WHERE workspace=? AND enabled=1 ORDER BY created_at, id LIMIT 10""",
            (user["workspace"],),
        ).fetchall()
    workflow_lines = []
    for workflow in workflows:
        intent = json.loads(workflow["intent_json"] or "{}")
        guardrails = json.loads(workflow["guardrails_json"] or "[]")
        goal = str(intent.get("goal") or workflow["title"]).strip()
        rules = ", ".join(str(rule) for rule in guardrails[:3] if str(rule).strip())
        workflow_lines.append(f"- {workflow['title']} : {goal[:120]}" + (f" ; garde-fous : {rules[:120]}" if rules else ""))
    return (
        "\n\nContexte utilisateur\n"
        f"Profil : {display_name}. Préférences : {preferences}.\n"
        f"Espace : {workspace}."
        + ("\nAutomatisations actives :\n" + "\n".join(workflow_lines) if workflow_lines else "")
    )


@app.get("/health")
@app.get("/")
def health():
    return {
        "ok": True,
        "service": "octohandy-api",
        "backend": True,
        "model": settings.nebius_model,
        "hermes": bool(settings.hermes_api_key),
        "desktop": bool(settings.desktop_base_url and settings.desktop_signing_secret),
        "screenpipe": bool(settings.screenpipe_api_url and settings.screenpipe_api_key),
        "hermesUrl": settings.hermes_api_url,
        "hint": "API live on 127.0.0.1:3000 via nginx :80/:8080",
    }


@app.get("/v1/marketplaces")
def list_marketplaces():
    return get_doc()


@app.get("/v1/marketplaces/{marketplace_id}")
def marketplace(marketplace_id: str):
    result = get_marketplace(marketplace_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Marketplace not found")
    return result


@app.get("/v1/me")
async def me(user: dict[str, Any] = Depends(workspace_user)):
    return {
        "userId": user["user_id"],
        "workspace": user["workspace"],
        "orgId": user.get("org_id"),
        "profile": _profile(user["user_id"]),
    }


class ProfileIn(BaseModel):
    displayName: str = ""
    preferences: dict[str, Any] = Field(default_factory=dict)


@app.get("/v1/me/profile")
async def get_profile(user: dict[str, Any] = Depends(workspace_user)):
    return {"profile": _profile(user["user_id"])}


@app.put("/v1/me/profile")
async def put_profile(body: ProfileIn, user: dict[str, Any] = Depends(workspace_user)):
    with db.connection() as conn:
        conn.execute(
            """INSERT INTO profiles (user_id, display_name, preferences, updated_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name,
                 preferences=excluded.preferences, updated_at=excluded.updated_at""",
            (
                user["user_id"],
                body.displayName,
                json.dumps(body.preferences, ensure_ascii=False),
                _iso_now(),
            ),
        )
    return {"profile": _profile(user["user_id"])}


def _shop_dict(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "marketplace": row["marketplace"],
        "displayName": row["display_name"],
        "status": row["status"],
        "listingCount": row["listing_count"],
    }


def _listing_dict(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "shopId": row["shop_id"],
        "marketplace": row["marketplace"],
        "title": row["title"],
        "price": row["price"],
        "status": row["status"],
        "imageUrl": row["image_url"],
        "url": row["url"],
        "views": row["views"],
        "favorites": row["favorites"],
        "updatedAt": row["updated_at"],
        "createdBy": row["created_by"],
        "creatorName": row["creator_name"] if "creator_name" in row.keys() else None,
    }


def _stock_dict(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "title": row["title"],
        "sku": row["sku"],
        "qty": row["qty"],
        "price": row["price"],
        "marketplace": row["marketplace"],
        "ownerLabel": row["owner_label"],
        "createdBy": row["created_by"],
        "creatorName": row["creator_name"] if "creator_name" in row.keys() else None,
    }


def _workflow_dict(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "marketplace": row["marketplace"],
        "title": row["title"],
        "steps": json.loads(row["steps_json"]),
        "tone": row["tone"],
        "source": row["source"],
        "trigger": row["trigger"] or "",
        "intent": json.loads(row["intent_json"] or "{}"),
        "tools": json.loads(row["tools_json"] or "[]"),
        "guardrails": json.loads(row["guardrails_json"] or "[]"),
        "toneNotes": row["tone_notes"] or "",
        "confidence": row["confidence"] or "",
        "humanProfile": json.loads(row["human_profile_json"] or "{}"),
        "enabled": bool(row["enabled"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


@app.get("/v1/shops")
async def list_shops(user: dict[str, Any] = Depends(workspace_user)):
    with db.connection() as conn:
        rows = conn.execute(
            """SELECT s.*, COUNT(l.id) AS listing_count
               FROM shops s LEFT JOIN listings l
                 ON l.workspace=s.workspace AND l.shop_id=s.id
               WHERE s.workspace=? GROUP BY s.workspace, s.id ORDER BY s.created_at, s.id""",
            (user["workspace"],),
        ).fetchall()
    return {"shops": [_shop_dict(row) for row in rows]}


@app.get("/v1/listings")
async def list_listings(shopId: str | None = None, user: dict[str, Any] = Depends(workspace_user)):
    query = """SELECT l.*, p.display_name AS creator_name FROM listings l
               LEFT JOIN profiles p ON p.user_id=l.created_by WHERE l.workspace=?"""
    values: list[Any] = [user["workspace"]]
    if shopId:
        query += " AND l.shop_id=?"
        values.append(shopId)
    query += " ORDER BY l.updated_at DESC, l.id"
    with db.connection() as conn:
        rows = conn.execute(query, values).fetchall()
    return {"listings": [_listing_dict(row) for row in rows]}


@app.get("/v1/shops/{shop_id}/listings")
async def shop_listings(shop_id: str, user: dict[str, Any] = Depends(workspace_user)):
    with db.connection() as conn:
        shop = conn.execute(
            "SELECT 1 FROM shops WHERE workspace=? AND id=?",
            (user["workspace"], shop_id),
        ).fetchone()
        if shop is None:
            raise HTTPException(404, "Shop not found")
        rows = conn.execute(
            """SELECT l.*, p.display_name AS creator_name FROM listings l
               LEFT JOIN profiles p ON p.user_id=l.created_by
               WHERE l.workspace=? AND l.shop_id=? ORDER BY l.updated_at DESC, l.id""",
            (user["workspace"], shop_id),
        ).fetchall()
    return {"listings": [_listing_dict(row) for row in rows]}


class ExtPairIn(BaseModel):
    name: str = "Chrome"


@app.post("/v1/extension/pair")
async def extension_pair(body: ExtPairIn, user: dict[str, Any] = Depends(workspace_user)):
    if user.get("via") == "extension":
        raise HTTPException(400, "Already an extension token")
    token = f"sfx_{uuid.uuid4().hex}"
    created_at = _iso_now()
    with db.connection() as conn:
        conn.execute(
            """INSERT INTO ext_tokens (token, user_id, workspace, created_by, name, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (token, user["user_id"], user["workspace"], user["user_id"], body.name, created_at),
        )
    return {"token": token}


@app.get("/v1/extension/me")
async def extension_me(user: dict[str, Any] = Depends(workspace_user)):
    return {
        "userId": user["user_id"],
        "via": user.get("via", "clerk"),
        "workspace": user["workspace"],
        "orgId": user.get("org_id"),
    }


class ExtSessionIn(BaseModel):
    marketplace: Literal["vinted"]
    displayName: str
    cookies: str
    cookieNames: list[str] = Field(default_factory=list)
    bearer: str | None = None
    csrf: str | None = None
    meta: dict[str, Any] = Field(default_factory=dict)


@app.post("/v1/extension/session")
async def extension_session(body: ExtSessionIn, user: dict[str, Any] = Depends(workspace_user)):
    if not body.cookies.strip():
        raise HTTPException(400, "cookies empty")
    workspace = user["workspace"]
    now = _iso_now()
    credentials = {
        "cookies": body.cookies,
        "cookieNames": body.cookieNames,
        "bearer": body.bearer,
        "csrf": body.csrf,
        "meta": {**body.meta, "receivedAt": now},
    }
    with db.connection() as conn:
        shop_row = conn.execute(
            "SELECT * FROM shops WHERE workspace=? AND marketplace=? ORDER BY created_at LIMIT 1",
            (workspace, body.marketplace),
        ).fetchone()
        if shop_row:
            shop_id = shop_row["id"]
            display_name = body.displayName or shop_row["display_name"]
            conn.execute(
                "UPDATE shops SET display_name=?, status='connected', updated_at=? WHERE workspace=? AND id=?",
                (display_name, now, workspace, shop_id),
            )
        else:
            shop_id = f"s-{uuid.uuid4().hex[:8]}"
            display_name = body.displayName
            conn.execute(
                """INSERT INTO shops (id, workspace, created_by, marketplace, display_name, status)
                   VALUES (?, ?, ?, ?, ?, 'connected')""",
                (shop_id, workspace, user["user_id"], body.marketplace, display_name),
            )
        conn.execute(
            """INSERT INTO marketplace_sessions
               (workspace, created_by, marketplace, display_name, credentials_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(workspace, marketplace) DO UPDATE SET
                 created_by=excluded.created_by, display_name=excluded.display_name,
                 credentials_json=excluded.credentials_json, updated_at=excluded.updated_at""",
            (
                workspace, user["user_id"], body.marketplace, display_name,
                json.dumps(credentials, ensure_ascii=False), now, now,
            ),
        )
        row = conn.execute(
            """SELECT s.*, COUNT(l.id) AS listing_count FROM shops s
               LEFT JOIN listings l ON l.workspace=s.workspace AND l.shop_id=s.id
               WHERE s.workspace=? AND s.id=? GROUP BY s.workspace, s.id""",
            (workspace, shop_id),
        ).fetchone()
    shop = _shop_dict(row)
    shop["hasCredentials"] = True
    return {"ok": True, "shop": shop}


class ShopIn(BaseModel):
    marketplace: str
    displayName: str
    status: Literal["connected", "expired"] = "connected"
    listingCount: int = 0


class ShopPatch(BaseModel):
    displayName: str | None = None
    status: Literal["connected", "expired"] | None = None


@app.post("/v1/shops")
async def create_shop(body: ShopIn, user: dict[str, Any] = Depends(workspace_user)):
    if get_marketplace(body.marketplace) is None:
        raise HTTPException(404, "Marketplace inconnue")
    shop_id = f"s-{uuid.uuid4().hex[:8]}"
    with db.connection() as conn:
        conn.execute(
            """INSERT INTO shops (id, workspace, created_by, marketplace, display_name, status, listing_count)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                shop_id, user["workspace"], user["user_id"], body.marketplace,
                body.displayName, body.status, body.listingCount,
            ),
        )
        row = conn.execute(
            "SELECT *, listing_count AS listing_count FROM shops WHERE workspace=? AND id=?",
            (user["workspace"], shop_id),
        ).fetchone()
    return {"shop": _shop_dict(row)}


@app.patch("/v1/shops/{shop_id}")
async def update_shop(shop_id: str, body: ShopPatch, user: dict[str, Any] = Depends(workspace_user)):
    changes = body.model_dump(exclude_unset=True)
    with db.connection() as conn:
        row = conn.execute(
            "SELECT * FROM shops WHERE workspace=? AND id=?",
            (user["workspace"], shop_id),
        ).fetchone()
        if row is None:
            raise HTTPException(404, "Shop not found")
        if changes:
            fields = []
            values: list[Any] = []
            for key, column in (("displayName", "display_name"), ("status", "status")):
                if key in changes and changes[key] is not None:
                    fields.append(f"{column}=?")
                    values.append(changes[key])
            if fields:
                values.extend([_iso_now(), user["workspace"], shop_id])
                conn.execute(
                    f"UPDATE shops SET {', '.join(fields)}, updated_at=? WHERE workspace=? AND id=?",
                    values,
                )
        row = conn.execute(
            """SELECT s.*, COUNT(l.id) AS listing_count FROM shops s LEFT JOIN listings l
               ON l.workspace=s.workspace AND l.shop_id=s.id
               WHERE s.workspace=? AND s.id=? GROUP BY s.workspace, s.id""",
            (user["workspace"], shop_id),
        ).fetchone()
    return {"shop": _shop_dict(row)}


@app.delete("/v1/shops/{shop_id}")
async def delete_shop(shop_id: str, user: dict[str, Any] = Depends(workspace_user)):
    with db.connection() as conn:
        row = conn.execute(
            "SELECT 1 FROM shops WHERE workspace=? AND id=?",
            (user["workspace"], shop_id),
        ).fetchone()
        if row is None:
            raise HTTPException(404, "Shop not found")
        conn.execute("DELETE FROM listings WHERE workspace=? AND shop_id=?", (user["workspace"], shop_id))
        conn.execute("DELETE FROM shops WHERE workspace=? AND id=?", (user["workspace"], shop_id))
    return {"ok": True}


# ---------------------------------------------------------------------------
# Remote desktop (A4000): the seller logs into the marketplace in a real Chrome
# that lives next to Screenpipe and Hermes. Access = short-lived HMAC token that
# the A4000 gate verifies (Caddy forward_auth) on the noVNC websocket.

LOGIN_URLS: dict[str, str | None] = {
    "vinted": "https://www.vinted.fr/",
    "ebay": "https://signin.ebay.fr/",
    "etsy": "https://www.etsy.com/fr/signin",
    "amazon": "https://sellercentral.amazon.fr/",
    "facebook_marketplace": "https://www.facebook.com/login/?next=https%3A%2F%2Fwww.facebook.com%2Fmarketplace%2F",
}


def _marketplace_start_url(marketplace: str | None) -> str | None:
    if not marketplace:
        return None
    if marketplace in LOGIN_URLS:
        return LOGIN_URLS[marketplace]
    doc = get_marketplace(marketplace) or {}
    for key in ("login_url", "url", "website"):
        if isinstance(doc.get(key), str) and doc[key].startswith("http"):
            return doc[key]
    return f"https://www.{marketplace}.fr/"


async def _desktop_open(url: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.post(
                f"{settings.desktop_base_url.rstrip('/')}/desktop/open",
                headers={"X-Gate-Secret": settings.desktop_signing_secret},
                json={"url": url},
            )
            return response.status_code == 200
    except httpx.HTTPError:
        return False


def _acquire_desktop_lease(user: dict[str, Any], marketplace: str | None, ttl: int) -> None:
    _lease_id, remaining = db.acquire_desktop_lease(
        user["workspace"], user["user_id"], marketplace, ttl
    )
    if remaining is not None:
        minutes = max(1, (remaining + 59) // 60)
        raise HTTPException(
            409,
            f"Le bureau est déjà utilisé par une autre équipe, réessaie dans {minutes} minute(s).",
        )


class DesktopSessionIn(BaseModel):
    marketplace: str | None = None
    purpose: Literal["connect", "teach", "browse"] = "connect"


@app.get("/v1/desktop")
async def desktop_status(user: dict[str, Any] = Depends(workspace_user)):
    return {
        "enabled": _desktop_enabled(),
        "host": settings.desktop_base_url or None,
        "marketplaces": sorted(LOGIN_URLS),
    }


@app.post("/v1/desktop/sessions")
async def create_desktop_session(body: DesktopSessionIn, user: dict[str, Any] = Depends(workspace_user)):
    if not _desktop_enabled():
        raise HTTPException(503, "Bureau distant non configuré (DESKTOP_BASE_URL / DESKTOP_SIGNING_SECRET)")
    if body.marketplace and get_marketplace(body.marketplace) is None and body.marketplace not in LOGIN_URLS:
        raise HTTPException(404, "Marketplace inconnue")
    _acquire_desktop_lease(user, body.marketplace, settings.desktop_session_ttl)
    token, exp = _desktop_token(user["workspace"], body.marketplace, settings.desktop_session_ttl)
    params = {
        "autoconnect": "1",
        "resize": "scale",
        "reconnect": "1",
        "reconnect_delay": "1500",
        "show_dot": "1",
        "t": token,
        "path": f"websockify?t={token}",
    }
    if settings.desktop_vnc_password:
        params["password"] = settings.desktop_vnc_password
    url = f"{settings.desktop_base_url.rstrip('/')}/vnc.html?{urlencode(params)}"
    start_url = _marketplace_start_url(body.marketplace) if body.purpose == "connect" else None
    opened = await _desktop_open(start_url) if start_url else False
    return {
        "url": url,
        "expiresAt": datetime.fromtimestamp(exp, tz=timezone.utc).isoformat(),
        "marketplace": body.marketplace,
        "purpose": body.purpose,
        "startUrl": start_url,
        "opened": opened,
    }


@app.post("/v1/desktop/release")
async def release_desktop(user: dict[str, Any] = Depends(workspace_user)):
    db.release_desktop_lease(user["workspace"])
    return {"ok": True}


class DesktopConnectedIn(BaseModel):
    marketplace: str
    displayName: str | None = None


@app.post("/v1/desktop/connected")
async def desktop_connected(body: DesktopConnectedIn, user: dict[str, Any] = Depends(workspace_user)):
    doc = get_marketplace(body.marketplace)
    if doc is None and body.marketplace not in LOGIN_URLS:
        raise HTTPException(404, "Marketplace inconnue")
    name = body.displayName or f"{(doc or {}).get('name') or body.marketplace.capitalize()} · bureau distant"
    with db.connection() as conn:
        row = conn.execute(
            "SELECT * FROM shops WHERE workspace=? AND marketplace=? ORDER BY created_at LIMIT 1",
            (user["workspace"], body.marketplace),
        ).fetchone()
        if row is None:
            shop_id = f"s-{uuid.uuid4().hex[:8]}"
            conn.execute(
                """INSERT INTO shops (id, workspace, created_by, marketplace, display_name, status, listing_count)
                   VALUES (?, ?, ?, ?, ?, 'connected', 0)""",
                (shop_id, user["workspace"], user["user_id"], body.marketplace, name),
            )
        else:
            shop_id = row["id"]
            conn.execute(
                "UPDATE shops SET status='connected', display_name=COALESCE(?, display_name), updated_at=? WHERE workspace=? AND id=?",
                (body.displayName, _iso_now(), user["workspace"], shop_id),
            )
        row = conn.execute(
            """SELECT s.*, COUNT(l.id) AS listing_count FROM shops s LEFT JOIN listings l
               ON l.workspace=s.workspace AND l.shop_id=s.id
               WHERE s.workspace=? AND s.id=? GROUP BY s.workspace, s.id""",
            (user["workspace"], shop_id),
        ).fetchone()
    return {"shop": _shop_dict(row)}


# ---------------------------------------------------------------------------
# Teach by doing: the seller performs the task once on the remote desktop, we
# pull that time window from Screenpipe (same machine as Chrome) and Hermes
# compiles the trace into a workflow card built from a fixed tool catalog.

TEACH_TOOLS: list[str] = [
    "list_unread_messages", "read_thread", "send_message", "list_favorites", "list_offers",
    "send_offer", "get_listing", "update_price", "republish_listing", "list_notifications",
    "wait_for_event", "notify_seller",
]

_WORKFLOW_TONES = {"vinted": "teal"}


def _teach_dict(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "marketplace": row["marketplace"],
        "status": row["status"],
        "startedAt": row["started_at"],
        "endedAt": row["ended_at"],
        "trace": json.loads(row["trace_json"]) if row["trace_json"] else None,
        "draft": json.loads(row["draft_json"]) if row["draft_json"] else None,
        "workflowId": row["workflow_id"],
        "error": row["error"],
        "createdAt": row["created_at"],
    }


def _teach_row(conn: Any, workspace: str, teach_id: str) -> Any:
    row = conn.execute(
        "SELECT * FROM teach_sessions WHERE workspace=? AND id=?", (workspace, teach_id)
    ).fetchone()
    if row is None:
        raise HTTPException(404, "Session d'apprentissage introuvable")
    return row


def _screenpipe_enabled() -> bool:
    return bool(settings.screenpipe_api_url and settings.screenpipe_api_key)


async def _screenpipe_events(start_iso: str, end_iso: str) -> dict[str, Any]:
    """Fetch the Screenpipe window and compress it into a compact, de-duplicated trace."""
    items: list[dict[str, Any]] = []
    headers = {"Authorization": f"Bearer {settings.screenpipe_api_key}"}
    async with httpx.AsyncClient(timeout=30) as client:
        for offset in range(0, 600, 200):
            response = await client.get(
                f"{settings.screenpipe_api_url.rstrip('/')}/search",
                headers=headers,
                params={
                    "content_type": "all", "start_time": start_iso, "end_time": end_iso,
                    "limit": 200, "offset": offset,
                },
            )
            response.raise_for_status()
            page = response.json().get("data", [])
            items.extend(page)
            if len(page) < 200:
                break
    items.sort(key=lambda item: str((item.get("content") or {}).get("timestamp", "")))
    events: list[dict[str, Any]] = []
    seen_lines: set[str] = set()
    apps: dict[str, int] = {}
    total_chars = 0
    for item in items:
        content = item.get("content") or {}
        kind = str(item.get("type", "")).lower()
        app = str(content.get("app_name") or "")
        window = str(content.get("window_name") or content.get("title") or "")
        text = str(content.get("text") or content.get("transcription") or "")
        apps[app or "?"] = apps.get(app or "?", 0) + 1
        lines: list[str] = []
        for raw in text.splitlines():
            line = " ".join(raw.split())
            if len(line) < 3 or line in seen_lines:
                continue
            seen_lines.add(line)
            lines.append(line)
        snippet = " | ".join(lines)[:600]
        if not snippet and (not events or events[-1]["window"] == window):
            continue
        if events and events[-1]["window"] == window and events[-1]["kind"] == kind and len(events[-1]["text"]) < 900:
            events[-1]["text"] = (events[-1]["text"] + " | " + snippet).strip(" |")[:1200]
        else:
            events.append({
                "t": str(content.get("timestamp") or ""), "kind": kind, "app": app,
                "window": window, "text": snippet,
            })
        total_chars += len(snippet)
        if total_chars > 14000:
            break
    return {
        "frames": len(items), "events": events[:80], "apps": apps,
        "windows": list(dict.fromkeys(event["window"] for event in events if event["window"]))[:20],
    }


def _parse_json_block(text: str) -> dict[str, Any] | None:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text[text.find("\n") + 1:] if "\n" in text else text
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        return None
    try:
        data = json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _fallback_draft(marketplace: str, trace: dict[str, Any]) -> dict[str, Any]:
    windows = [w for w in trace.get("windows", []) if w][:4] or ["Action réalisée sur la marketplace"]
    return {
        "title": f"Workflow {marketplace.capitalize()} appris le {datetime.now(timezone.utc).strftime('%d/%m %H:%M')}",
        "trigger": "",
        "steps": [f"Écran : {w[:90]}" for w in windows],
        "tools": [], "guardrails": ["Toujours demander validation avant d'envoyer un message"],
        "tone_notes": "", "confidence": "low",
        "intent": {
            "goal": "",
            "actor": "seller",
            "entities": {},
            "success_criteria": "",
            "constraints": [],
        },
    }


async def _llm_json(system: str, user_text: str, session_key: str) -> tuple[dict[str, Any] | None, str]:
    """Hermes first (same OpenAI-compatible gateway as /v1/chat), then Nebius DeepSeek directly."""
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user_text}]
    if settings.hermes_api_key:
        try:
            async with httpx.AsyncClient(timeout=settings.hermes_timeout) as client:
                response = await client.post(
                    f"{settings.hermes_api_url.rstrip('/')}/chat/completions",
                    headers={"Authorization": f"Bearer {settings.hermes_api_key}", "X-Hermes-Session-Key": session_key},
                    json={"model": settings.hermes_model, "messages": messages, "stream": False},
                )
            if response.status_code < 400:
                parsed = _parse_json_block(response.json()["choices"][0]["message"]["content"])
                if parsed:
                    return parsed, "hermes"
        except (httpx.HTTPError, KeyError, ValueError):
            pass
    if settings.nebius_api_key:
        try:
            async with httpx.AsyncClient(timeout=90) as client:
                response = await client.post(
                    f"{settings.nebius_base_url.rstrip('/')}/chat/completions",
                    headers={"Authorization": f"Bearer {settings.nebius_api_key}"},
                    json={"model": settings.nebius_model, "messages": messages, "temperature": 0.2,
                          "response_format": {"type": "json_object"}},
                )
            if response.status_code < 400:
                parsed = _parse_json_block(response.json()["choices"][0]["message"]["content"])
                if parsed:
                    return parsed, "nebius"
        except (httpx.HTTPError, KeyError, ValueError):
            pass
    return None, "none"


_TEACH_SYSTEM = """Tu es le compilateur de workflows d'OctoHandy, un assistant pour vendeurs sur les marketplaces
(Vinted, eBay, Etsy…). On te donne la trace Screenpipe (texte OCR des écrans, titres de fenêtres, ordre
chronologique) d'un vendeur qui vient de faire UNE FOIS, à la main, la tâche qu'il veut automatiser.
Déduis le workflow réutilisable et réponds UNIQUEMENT avec un objet JSON valide (pas de markdown, pas de texte avant ou après) :
{
 "title": "titre court (max 60 caractères), style 'Favoris → proposition de prix'",
 "trigger": "l'événement qui déclenche le workflow, une phrase",
 "steps": ["3 à 6 étapes courtes en français, impératif, style 'Client met un article en favoris'"],
 "tools": [{"tool": "<un outil du catalogue>", "args": {"...": "..."}}],
 "intent": {
   "goal": "ce que le vendeur veut obtenir, en une phrase",
   "actor": "seller|buyer",
   "entities": {"marketplace": "...", "article": "...", "prix_plancher": "...", "delai": "..."},
   "success_criteria": "comment reconnaître que le résultat est atteint",
   "constraints": ["limites et conditions à respecter"]
 },
 "guardrails": ["règles de sécurité déduites (prix plancher, ne jamais répondre hors sujet, validation humaine…)"],
 "tone_notes": "comment le vendeur écrit (tutoiement, emojis, formules), déduit des messages tapés",
 "confidence": "high|medium|low"
}
Catalogue d'outils autorisés (n'en invente pas d'autre) : %s.
Ignore les bandeaux cookies, publicités, onglets sans rapport. Si la trace est trop pauvre, mets confidence "low"
et propose quand même le workflow le plus plausible pour cette marketplace.""" % ", ".join(TEACH_TOOLS)


async def _compile_teach(marketplace: str, trace: dict[str, Any], user_id: str) -> tuple[dict[str, Any], str]:
    started = trace.get("events", [{}])[0].get("t", "") if trace.get("events") else ""
    lines = [f"Marketplace : {marketplace}", f"Frames Screenpipe : {trace.get('frames')}", f"Début : {started}", "Trace :"]
    for event in trace.get("events", []):
        lines.append(f"- [{event['t'][11:19]}] {event['app']} / {event['window'][:80]} :: {event['text'][:500]}")
    draft, via = await _llm_json(_TEACH_SYSTEM, "\n".join(lines)[:16000], f"octohandy-teach-{user_id}")
    if not draft or not isinstance(draft.get("steps"), list) or not draft.get("title"):
        return _fallback_draft(marketplace, trace), "fallback"
    draft["steps"] = [str(step)[:160] for step in draft["steps"]][:8]
    draft["tools"] = [tool for tool in draft.get("tools", []) if isinstance(tool, dict) and tool.get("tool") in TEACH_TOOLS]
    intent = draft.get("intent") if isinstance(draft.get("intent"), dict) else {}
    entities = intent.get("entities") if isinstance(intent.get("entities"), dict) else {}
    draft["intent"] = {
        "goal": str(intent.get("goal") or "")[:500],
        "actor": intent.get("actor") if intent.get("actor") in ("seller", "buyer") else "seller",
        "entities": {
            str(key)[:80]: str(value)[:300]
            for key, value in list(entities.items())[:30]
            if isinstance(value, (str, int, float, bool))
        },
        "success_criteria": str(intent.get("success_criteria") or "")[:500],
        "constraints": [str(item)[:300] for item in intent.get("constraints", []) if str(item).strip()][:20]
        if isinstance(intent.get("constraints"), list) else [],
    }
    draft["guardrails"] = [str(rule)[:300] for rule in draft.get("guardrails", []) if str(rule).strip()][:20]
    draft["trigger"] = str(draft.get("trigger") or "")[:300]
    draft["tone_notes"] = str(draft.get("tone_notes") or "")[:500]
    draft["confidence"] = draft.get("confidence") if draft.get("confidence") in ("high", "medium", "low") else "low"
    return draft, via


class TeachStartIn(BaseModel):
    marketplace: str


class TeachSaveIn(BaseModel):
    title: str | None = None
    steps: list[str] | None = None
    enabled: bool = False


@app.get("/v1/teach")
async def list_teach(user: dict[str, Any] = Depends(workspace_user)):
    with db.connection() as conn:
        rows = conn.execute(
            "SELECT * FROM teach_sessions WHERE workspace=? ORDER BY created_at DESC LIMIT 20",
            (user["workspace"],),
        ).fetchall()
    return {"enabled": _desktop_enabled() and _screenpipe_enabled(), "sessions": [_teach_dict(row) for row in rows]}


@app.post("/v1/teach/start")
async def teach_start(body: TeachStartIn, user: dict[str, Any] = Depends(workspace_user)):
    if not (_desktop_enabled() and _screenpipe_enabled()):
        raise HTTPException(503, "Apprentissage indisponible : bureau distant ou Screenpipe non configuré")
    if get_marketplace(body.marketplace) is None and body.marketplace not in LOGIN_URLS:
        raise HTTPException(404, "Marketplace inconnue")
    session_ttl = max(settings.desktop_session_ttl, 1800)
    _acquire_desktop_lease(user, body.marketplace, session_ttl)
    teach_id = f"t-{uuid.uuid4().hex[:8]}"
    now = _iso_now()
    with db.connection() as conn:
        conn.execute(
            "UPDATE teach_sessions SET status='abandoned', updated_at=? WHERE workspace=? AND status='recording'",
            (now, user["workspace"]),
        )
        conn.execute(
            """INSERT INTO teach_sessions (id, workspace, created_by, marketplace, status, started_at)
               VALUES (?, ?, ?, ?, 'recording', ?)""",
            (teach_id, user["workspace"], user["user_id"], body.marketplace, now),
        )
        row = _teach_row(conn, user["workspace"], teach_id)
    token, exp = _desktop_token(user["workspace"], body.marketplace, session_ttl)
    params = {
        "autoconnect": "1", "resize": "scale", "reconnect": "1", "reconnect_delay": "1500",
        "show_dot": "1", "t": token, "path": f"websockify?t={token}",
    }
    if settings.desktop_vnc_password:
        params["password"] = settings.desktop_vnc_password
    start_url = _marketplace_start_url(body.marketplace)
    opened = await _desktop_open(start_url) if start_url else False
    return {
        "session": _teach_dict(row),
        "desktop": {
            "url": f"{settings.desktop_base_url.rstrip('/')}/vnc.html?{urlencode(params)}",
            "expiresAt": datetime.fromtimestamp(exp, tz=timezone.utc).isoformat(),
            "opened": opened,
        },
    }


@app.post("/v1/teach/{teach_id}/stop")
async def teach_stop(teach_id: str, user: dict[str, Any] = Depends(workspace_user)):
    with db.connection() as conn:
        row = _teach_row(conn, user["workspace"], teach_id)
        if row["status"] != "recording":
            raise HTTPException(409, "Cette session n'est plus en cours d'enregistrement")
        ended = _iso_now()
        conn.execute(
            "UPDATE teach_sessions SET status='compiling', ended_at=?, updated_at=? WHERE workspace=? AND id=?",
            (ended, ended, user["workspace"], teach_id),
        )
    error = None
    trace: dict[str, Any] = {"frames": 0, "events": [], "apps": {}, "windows": []}
    try:
        # Screenpipe indexes with a few seconds of delay: give it a short grace period.
        await asyncio.sleep(4)
        trace = await _screenpipe_events(row["started_at"], ended)
    except (httpx.HTTPError, ValueError) as e:
        error = f"Screenpipe indisponible ({type(e).__name__})"
    try:
        draft, via = await _compile_teach(row["marketplace"], trace, user["user_id"])
    finally:
        db.release_desktop_lease(user["workspace"])
    draft["via"] = via
    with db.connection() as conn:
        conn.execute(
            """UPDATE teach_sessions SET status='draft', trace_json=?, draft_json=?, error=?, updated_at=?
               WHERE workspace=? AND id=?""",
            (json.dumps({**trace, "events": trace["events"][:40]}, ensure_ascii=False), json.dumps(draft, ensure_ascii=False),
             error, _iso_now(), user["workspace"], teach_id),
        )
        row = _teach_row(conn, user["workspace"], teach_id)
    return {"session": _teach_dict(row)}


@app.post("/v1/teach/{teach_id}/save")
async def teach_save(teach_id: str, body: TeachSaveIn, user: dict[str, Any] = Depends(workspace_user)):
    with db.connection() as conn:
        row = _teach_row(conn, user["workspace"], teach_id)
        draft = json.loads(row["draft_json"] or "{}")
        trace = json.loads(row["trace_json"] or "{}")
        title = (body.title or draft.get("title") or "Workflow appris").strip()[:80]
        steps = [step.strip() for step in (body.steps or draft.get("steps") or []) if step and step.strip()][:8]
        if not steps:
            raise HTTPException(422, "Le workflow doit contenir au moins une étape")
        workflow_id = row["workflow_id"] or f"w-{uuid.uuid4().hex[:8]}"
        tone = _WORKFLOW_TONES.get(row["marketplace"], "blue")
        intent = draft.get("intent") if isinstance(draft.get("intent"), dict) else {}
        tools = draft.get("tools") if isinstance(draft.get("tools"), list) else []
        guardrails = draft.get("guardrails") if isinstance(draft.get("guardrails"), list) else []
        profile = asdict(from_trace(user["user_id"], trace))
        metadata = (
            str(draft.get("trigger") or ""),
            json.dumps(intent, ensure_ascii=False),
            json.dumps(tools, ensure_ascii=False),
            json.dumps(guardrails, ensure_ascii=False),
            str(draft.get("tone_notes") or ""),
            str(draft.get("confidence") or "low"),
            json.dumps(profile, ensure_ascii=False),
        )
        if row["workflow_id"]:
            conn.execute(
                """UPDATE workflows SET title=?, steps_json=?, enabled=?, "trigger"=?, intent_json=?,
                   tools_json=?, guardrails_json=?, tone_notes=?, confidence=?, human_profile_json=?,
                   updated_at=? WHERE workspace=? AND id=?""",
                (title, json.dumps(steps, ensure_ascii=False), int(body.enabled), *metadata,
                 _iso_now(), user["workspace"], workflow_id),
            )
        else:
            conn.execute(
                """INSERT INTO workflows
                   (id, workspace, created_by, marketplace, title, steps_json, tone, source, enabled,
                    "trigger", intent_json, tools_json, guardrails_json, tone_notes, confidence, human_profile_json)
                   VALUES (?, ?, ?, ?, ?, ?, ?, 'teach', ?, ?, ?, ?, ?, ?, ?, ?)""",
                (workflow_id, user["workspace"], user["user_id"], row["marketplace"], title,
                 json.dumps(steps, ensure_ascii=False), tone, int(body.enabled), *metadata),
            )
        conn.execute(
            "UPDATE teach_sessions SET status='saved', workflow_id=?, updated_at=? WHERE workspace=? AND id=?",
            (workflow_id, _iso_now(), user["workspace"], teach_id),
        )
        workflow = conn.execute(
            "SELECT * FROM workflows WHERE workspace=? AND id=?", (user["workspace"], workflow_id)
        ).fetchone()
        row = _teach_row(conn, user["workspace"], teach_id)
    return {"workflow": _workflow_dict(workflow), "session": _teach_dict(row)}


@app.delete("/v1/teach/{teach_id}")
async def teach_discard(teach_id: str, user: dict[str, Any] = Depends(workspace_user)):
    with db.connection() as conn:
        _teach_row(conn, user["workspace"], teach_id)
        conn.execute(
            "UPDATE teach_sessions SET status='discarded', updated_at=? WHERE workspace=? AND id=?",
            (_iso_now(), user["workspace"], teach_id),
        )
    db.release_desktop_lease(user["workspace"])
    return {"ok": True}


# ---------------------------------------------------------------------------
# Workflow runs: Hermes turns a workflow card + the live desktop context
# (Screenpipe, last minutes) into a concrete action plan; the seller approves;
# the backend executes in "assisted" mode on the A4000 desktop (opens the right
# marketplace page in Chrome, puts the drafted message in the clipboard, logs
# every step). Fully autonomous clicking is deliberately out of scope for the PoC.

INBOX_URLS: dict[str, str] = {
    "vinted": "https://www.vinted.fr/inbox",
    "ebay": "https://mesg.ebay.fr/mesgweb/ViewMessages/0",
    "etsy": "https://www.etsy.com/fr/messages",
    "facebook_marketplace": "https://www.facebook.com/messages/",
}
LISTINGS_URLS: dict[str, str] = {
    "vinted": "https://www.vinted.fr/member/general/items",
    "ebay": "https://www.ebay.fr/sh/lst/active",
    "etsy": "https://www.etsy.com/your/shops/me/tools/listings",
    "facebook_marketplace": "https://www.facebook.com/marketplace/you/selling",
}
_MESSAGE_TOOLS = {"list_unread_messages", "read_thread", "send_message", "send_offer", "list_offers", "list_favorites", "list_notifications"}
_LISTING_TOOLS = {"get_listing", "update_price", "republish_listing"}


def _run_dict(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "workflowId": row["workflow_id"],
        "status": row["status"],
        "mode": row["mode"],
        "context": json.loads(row["context_json"]) if row["context_json"] else None,
        "plan": json.loads(row["plan_json"]) if row["plan_json"] else None,
        "log": json.loads(row["log_json"]) if row["log_json"] else [],
        "error": row["error"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _run_row(conn: Any, workspace: str, run_id: str) -> Any:
    row = conn.execute("SELECT * FROM workflow_runs WHERE workspace=? AND id=?", (workspace, run_id)).fetchone()
    if row is None:
        raise HTTPException(404, "Exécution introuvable")
    return row


async def _desktop_clipboard(text: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.post(
                f"{settings.desktop_base_url.rstrip('/')}/desktop/clipboard",
                headers={"X-Gate-Secret": settings.desktop_signing_secret},
                json={"text": text},
            )
            return response.status_code == 200
    except httpx.HTTPError:
        return False


_RUN_SYSTEM = """Tu es l'agent Hermes d'OctoHandy, qui exécute des workflows pour un vendeur sur une marketplace.
On te donne : l'objectif du workflow, ses critères de réussite, ses contraintes, garde-fous, ton du vendeur et outils autorisés,
puis le contexte live de son bureau (texte OCR Screenpipe des dernières minutes : ce qui est à l'écran dans Chrome).
Prépare le plan d'exécution
concret pour CETTE occurrence. Réponds UNIQUEMENT avec un objet JSON :
{
 "summary": "une phrase : ce que tu vas faire maintenant",
 "situation": "ce que tu comprends de l'écran (messages non lus, favoris, annonces…), ou 'contexte insuffisant'",
 "actions": [
   {"tool": "<outil du catalogue>", "args": {"...": "..."}, "preview": "texte exact du message/offre si l'action en envoie un, dans le ton du vendeur", "needs_approval": true, "target_text": "libellé visible exact à cliquer", "input_text": "texte à saisir après le clic, sinon chaîne vide", "submit": false}
 ],
 "risks": ["ce qui pourrait mal se passer"],
 "ask_user": "question au vendeur si une info manque, sinon chaîne vide"
}
Catalogue d'outils : %s. Max 5 actions. Indique target_text uniquement si le libellé est visible dans l'OCR.
Toute action qui envoie un message, une offre ou modifie un prix a needs_approval=true. Respecte les garde-fous
(prix plancher, etc.). Les messages sont en français, courts, sans inventer d'informations sur l'article.""" % ", ".join(TEACH_TOOLS)


def _fallback_plan(workflow: dict[str, Any]) -> dict[str, Any]:
    return {
        "summary": f"Ouvrir {workflow['marketplace']} et dérouler « {workflow['title']} » avec toi",
        "situation": "contexte insuffisant (agent indisponible)",
        "actions": [{"tool": "list_unread_messages", "args": {"marketplace": workflow["marketplace"]}, "preview": "", "needs_approval": False}],
        "risks": ["Plan de secours : l'agent n'a pas pu analyser l'écran"],
        "ask_user": "",
    }


@app.get("/v1/workflows/runs")
async def list_runs(workflow_id: str | None = None, user: dict[str, Any] = Depends(workspace_user)):
    with db.connection() as conn:
        if workflow_id:
            rows = conn.execute(
                "SELECT * FROM workflow_runs WHERE workspace=? AND workflow_id=? ORDER BY created_at DESC LIMIT 20",
                (user["workspace"], workflow_id),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM workflow_runs WHERE workspace=? ORDER BY created_at DESC LIMIT 20", (user["workspace"],)
            ).fetchall()
    return {"runs": [_run_dict(row) for row in rows]}


@app.post("/v1/workflows/{workflow_id}/run")
async def run_workflow(workflow_id: str, user: dict[str, Any] = Depends(workspace_user)):
    with db.connection() as conn:
        row = conn.execute(
            "SELECT * FROM workflows WHERE workspace=? AND id=?", (user["workspace"], workflow_id)
        ).fetchone()
        if row is None:
            raise HTTPException(404, "Workflow not found")
        workflow = _workflow_dict(row)
        run_id = f"r-{uuid.uuid4().hex[:8]}"
        conn.execute(
            "INSERT INTO workflow_runs (id, workspace, created_by, workflow_id, status) VALUES (?, ?, ?, ?, 'planning')",
            (run_id, user["workspace"], user["user_id"], workflow_id),
        )
    context: dict[str, Any] = {"frames": 0, "events": [], "windows": []}
    error = None
    if _screenpipe_enabled() and db.desktop_lease_held(user["workspace"]):
        try:
            end = datetime.now(timezone.utc)
            context = await _screenpipe_events(
                (end - timedelta(minutes=3)).strftime("%Y-%m-%dT%H:%M:%SZ"), end.strftime("%Y-%m-%dT%H:%M:%SZ")
            )
        except (httpx.HTTPError, ValueError) as e:
            error = f"Screenpipe indisponible ({type(e).__name__})"
    lines = [
        f"Workflow « {workflow['title']} » ({workflow['marketplace']})",
        "Étapes : " + " / ".join(workflow["steps"]),
    ]
    intent = workflow.get("intent") or {}
    allowed_tools = [item.get("tool") for item in workflow.get("tools", []) if isinstance(item, dict) and item.get("tool")]
    lines.extend([
        f"Objectif : {intent.get('goal') or 'non précisé'}",
        f"Critères de réussite : {intent.get('success_criteria') or 'non précisés'}",
        "Contraintes : " + (" / ".join(intent.get("constraints", [])) or "aucune précisée"),
        "Garde-fous : " + (" / ".join(workflow.get("guardrails") or []) or "aucun précisé"),
        f"Ton du vendeur : {workflow.get('toneNotes') or 'non précisé'}",
        "Outils autorisés pour ce workflow : " + (", ".join(allowed_tools) or "aucun outil déclaré"),
        "",
        f"Contexte live du bureau ({context.get('frames', 0)} frames Screenpipe, 3 dernières minutes) :",
    ])
    for event in context.get("events", [])[:30]:
        lines.append(f"- [{event['t'][11:19]}] {event['window'][:80]} :: {event['text'][:400]}")
    plan, via = await _llm_json(_RUN_SYSTEM, "\n".join(lines)[:14000], f"octohandy-run-{user['user_id']}")
    if not plan or not isinstance(plan.get("actions"), list):
        plan, via = _fallback_plan(workflow), "fallback"
    plan["actions"] = [
        {
            "tool": action.get("tool"), "args": action.get("args") or {},
            "preview": str(action.get("preview") or "")[:1500],
            "needs_approval": bool(action.get("needs_approval", True))
            or action.get("tool") in {"send_message", "send_offer", "update_price"},
            "target_text": str(action.get("target_text") or "")[:240],
            "input_text": str(action.get("input_text") or "")[:1500],
            "submit": bool(action.get("submit", False)),
        }
        for action in plan["actions"] if isinstance(action, dict) and action.get("tool") in TEACH_TOOLS
    ][:5]
    plan["via"] = via
    plan.setdefault("risks", [])
    plan.setdefault("ask_user", "")
    plan.setdefault("situation", "")
    with db.connection() as conn:
        conn.execute(
            """UPDATE workflow_runs SET status='awaiting_approval', context_json=?, plan_json=?, error=?, updated_at=?
               WHERE workspace=? AND id=?""",
            (json.dumps({"frames": context.get("frames", 0), "windows": context.get("windows", [])[:10]}, ensure_ascii=False),
             json.dumps(plan, ensure_ascii=False), error, _iso_now(), user["workspace"], run_id),
        )
        run = _run_row(conn, user["workspace"], run_id)
    return {"run": _run_dict(run), "workflow": workflow}


class RunDecisionIn(BaseModel):
    approved_indexes: list[int] | None = None
    mode: Literal["assisted", "auto_click"] = "assisted"


async def _screen_excerpt() -> str:
    try:
        frame_id = await latest_frame_id()
    except ScreenpipeFrameStaleError:
        return "écran Screenpipe pas à jour"
    if frame_id is None:
        return ""
    elements = await frame_elements(frame_id)
    texts = list(dict.fromkeys(str(item.get("text") or "").strip() for item in elements if item.get("text")))
    return " · ".join(texts)[:320]


def _workflow_human_profile(row: Any, user_id: str) -> HumanProfile:
    fallback = from_trace(user_id, {"events": []})
    try:
        stored = json.loads(row["human_profile_json"] or "{}")
        return HumanProfile(
            seed=int(stored.get("seed", fallback.seed)),
            pace=float(stored.get("pace", fallback.pace)),
            type_wpm=float(stored.get("type_wpm", fallback.type_wpm)),
            jitter=float(stored.get("jitter", fallback.jitter)),
            overshoot_chance=float(stored.get("overshoot_chance", fallback.overshoot_chance)),
            typo_chance=min(0.03, max(0.0, float(stored.get("typo_chance", fallback.typo_chance)))),
        )
    except (TypeError, ValueError, json.JSONDecodeError):
        return fallback


async def _type_human_text(
    desktop: RemoteDesktop,
    text: str,
    rng: random.Random,
    profile: HumanProfile,
) -> None:
    delays = key_delays(text, rng, profile)
    index = 0
    for char, correct in typos(text, rng, profile):
        if not correct:
            await desktop.type_text(char)
            await asyncio.sleep(rng.uniform(0.06, 0.14))
            backspace = keysym_for_key("BackSpace")
            await desktop.key(backspace, True)
            await desktop.key(backspace, False)
            continue
        await desktop.type_text(char)
        await asyncio.sleep(delays[index])
        index += 1


def _persist_run_progress(workspace: str, run_id: str, log: list[dict[str, Any]]) -> None:
    with db.connection() as conn:
        conn.execute(
            "UPDATE workflow_runs SET log_json=?, updated_at=? WHERE workspace=? AND id=?",
            (json.dumps(log, ensure_ascii=False), _iso_now(), workspace, run_id),
        )


def _finish_workflow_run(
    workspace: str,
    run_id: str,
    status: str,
    log: list[dict[str, Any]],
    error: str | None = None,
) -> None:
    with db.connection() as conn:
        conn.execute(
            "UPDATE workflow_runs SET status=?, log_json=?, error=?, updated_at=? WHERE workspace=? AND id=?",
            (status, json.dumps(log, ensure_ascii=False), error, _iso_now(), workspace, run_id),
        )


def _execution_error(exc: BaseException) -> str:
    detail = str(exc).strip() or type(exc).__name__
    return f"Échec de l'exécution : {detail[:400]}"


async def _execute_run_actions(
    run_id: str,
    workspace: str,
    user: dict[str, Any],
    workflow: dict[str, Any] | None,
    plan: dict[str, Any],
    approved_indexes: list[int] | None,
    mode: Literal["assisted", "auto_click"],
    log: list[dict[str, Any]],
) -> None:
    marketplace = workflow["marketplace"] if workflow else "vinted"
    opened_pages: set[str] = set()
    desktop: RemoteDesktop | None = None
    desktop_attempted = False
    desktop_error: str | None = None
    profile = _workflow_human_profile(workflow, user["user_id"]) if workflow else from_trace(user["user_id"], {"events": []})
    rng = random.Random(f"{profile.seed}:{run_id}")

    def record(entry: dict[str, Any]) -> None:
        log.append(entry)
        if mode == "auto_click":
            _persist_run_progress(workspace, run_id, log)

    try:
        for index, action in enumerate(plan.get("actions", [])):
            tool = action["tool"]
            if approved_indexes is not None and index not in approved_indexes:
                record({"t": _iso_now(), "tool": tool, "result": "skipped", "detail": "non approuvée"})
                continue
            if mode == "auto_click":
                try:
                    _acquire_desktop_lease(user, marketplace, settings.desktop_session_ttl)
                except HTTPException as exc:
                    record({
                        "t": _iso_now(), "tool": tool, "result": "failed",
                        "detail": str(exc.detail),
                    })
                    break
            if not db.desktop_lease_held(workspace):
                record({
                    "t": _iso_now(), "tool": tool, "result": "failed",
                    "detail": "réservation du bureau expirée ; aucune action effectuée",
                })
                if mode == "auto_click":
                    break
                continue
            page = (
                INBOX_URLS.get(marketplace) if tool in _MESSAGE_TOOLS
                else LISTINGS_URLS.get(marketplace) if tool in _LISTING_TOOLS
                else None
            )
            if mode == "auto_click" and page is None:
                page = _marketplace_start_url(marketplace)
            details: list[str] = []
            page_ok = True
            if page and page not in opened_pages and _desktop_enabled():
                opened_pages.add(page)
                page_ok = await _desktop_open(page)
                details.append(f"page ouverte dans le Chrome du bureau : {page}" if page_ok else "ouverture de page impossible")

            if mode == "assisted":
                ok = page_ok
                if action.get("preview") and _desktop_enabled():
                    copied = await _desktop_clipboard(action["preview"])
                    details.append("message prêt dans le presse-papiers du bureau" if copied else "presse-papiers indisponible")
                    ok = ok and copied
                if tool == "notify_seller":
                    details.append("notification affichée dans le journal")
                if tool == "wait_for_event":
                    details.append("déclencheur automatique à configurer")
                record({
                    "t": _iso_now(), "tool": tool, "args": action.get("args", {}),
                    "preview": action.get("preview", ""), "result": "assisted" if ok else "partial",
                    "detail": " · ".join(details) or "aucune action sur le bureau",
                })
                continue

            target_text = str(action.get("target_text") or "").strip()
            entry: dict[str, Any] = {
                "t": _iso_now(), "tool": tool, "args": action.get("args", {}),
                "preview": action.get("preview", ""), "searched": target_text,
                "matched": None, "confidence": None, "coordinates": None, "evidence": "",
            }
            if not page_ok:
                entry.update(result="failed", outcome="ouverture de page impossible", detail="ouverture de page impossible")
                record(entry)
                continue
            if not target_text:
                entry.update(result="failed", outcome="cible non précisée dans le plan", detail="cible non précisée dans le plan")
                record(entry)
                continue
            if not desktop_attempted:
                desktop_attempted = True
                try:
                    desktop = RemoteDesktop(workspace, marketplace, settings.desktop_session_ttl)
                    await desktop.connect()
                except DesktopInputError as exc:
                    desktop_error = str(exc)
                    desktop = None
            if desktop is None:
                outcome = desktop_error or "connexion RFB indisponible"
                entry.update(result="failed", outcome=outcome, detail=outcome)
                record(entry)
                continue

            await asyncio.sleep(pre_action_delay(rng, profile))
            try:
                target = await find_target(target_text, screen_size=(desktop.width, desktop.height))
            except ScreenpipeFrameStaleError:
                entry.update(result="failed", outcome=SCREENPIPE_STALE_OUTCOME, detail=SCREENPIPE_STALE_OUTCOME)
                record(entry)
                continue
            if target is None:
                entry.update(
                    result="failed", outcome="cible introuvable à l'écran",
                    detail="cible introuvable à l'écran",
                )
                record(entry)
                continue
            entry["matched"] = target["text"]
            entry["confidence"] = target["confidence"]
            point = click_point(target["bounds_px"], rng)
            entry["coordinates"] = {"x": point[0], "y": point[1]}
            clicked = False
            try:
                path = move_path((desktop._x, desktop._y), point, rng, profile)
                for x, y, delay in path:
                    await asyncio.sleep(delay)
                    await desktop.move(round(x), round(y))
                await desktop.click(*point, rng=rng)
                clicked = True
                if action.get("input_text"):
                    await _type_human_text(desktop, action["input_text"], rng, profile)
                if action.get("submit"):
                    enter = keysym_for_key("Enter")
                    await desktop.key(enter, True)
                    await desktop.key(enter, False)
                await asyncio.sleep(rng.uniform(1.5, 3.0))
                entry["evidence"] = await _screen_excerpt()
                entry.update(result="clicked", outcome="clic exécuté", detail=" · ".join(details) or "clic exécuté")
            except DesktopInputError as exc:
                entry.update(result="partial" if clicked else "failed", outcome=str(exc), detail=str(exc))
                if clicked:
                    await asyncio.sleep(rng.uniform(1.5, 3.0))
                    entry["evidence"] = await _screen_excerpt()
            record(entry)
    finally:
        if desktop is not None:
            await desktop.close()


async def _run_auto_click_background(
    run_id: str,
    workspace: str,
    user: dict[str, Any],
    workflow: dict[str, Any] | None,
    plan: dict[str, Any],
    approved_indexes: list[int] | None,
) -> None:
    log: list[dict[str, Any]] = []
    try:
        await _execute_run_actions(
            run_id, workspace, user, workflow, plan, approved_indexes, "auto_click", log
        )
        _finish_workflow_run(workspace, run_id, "executed", log)
    except asyncio.CancelledError:
        error = "Exécution interrompue avant la fin."
        log.append({"t": _iso_now(), "tool": "execution", "result": "failed", "detail": error})
        _finish_workflow_run(workspace, run_id, "failed", log, error)
    except Exception as exc:
        error = _execution_error(exc)
        log.append({"t": _iso_now(), "tool": "execution", "result": "failed", "detail": error})
        _finish_workflow_run(workspace, run_id, "failed", log, error)


@app.post("/v1/workflows/runs/{run_id}/approve")
async def approve_run(run_id: str, body: RunDecisionIn, user: dict[str, Any] = Depends(workspace_user)):
    with db.connection() as conn:
        run = _run_row(conn, user["workspace"], run_id)
        if run["status"] != "awaiting_approval":
            raise HTTPException(409, "Cette exécution n'attend plus d'approbation")
        workflow_row = conn.execute(
            "SELECT * FROM workflows WHERE workspace=? AND id=?", (user["workspace"], run["workflow_id"])
        ).fetchone()
        workflow = dict(workflow_row) if workflow_row else None
        plan = json.loads(run["plan_json"] or "{}")
        actions = plan.get("actions", [])
        approved = [action for index, action in enumerate(actions) if body.approved_indexes is None or index in body.approved_indexes]
        if body.mode == "auto_click" and approved and not db.desktop_lease_held(user["workspace"]):
            raise HTTPException(409, "Réserve le bureau distant avant de lancer les clics.")
        conn.execute(
            "UPDATE workflow_runs SET status='executing', mode=?, updated_at=? WHERE workspace=? AND id=?",
            (body.mode, _iso_now(), user["workspace"], run_id),
        )
    log: list[dict[str, Any]] = []
    if body.mode == "auto_click":
        try:
            task = asyncio.create_task(
                _run_auto_click_background(
                    run_id, user["workspace"], user, workflow, plan,
                    list(body.approved_indexes) if body.approved_indexes is not None else None,
                )
            )
            _run_tasks.add(task)
            task.add_done_callback(_run_tasks.discard)
        except Exception as exc:
            error = _execution_error(exc)
            log.append({"t": _iso_now(), "tool": "execution", "result": "failed", "detail": error})
            _finish_workflow_run(user["workspace"], run_id, "failed", log, error)
    else:
        try:
            await _execute_run_actions(
                run_id, user["workspace"], user, workflow, plan,
                list(body.approved_indexes) if body.approved_indexes is not None else None,
                "assisted", log,
            )
            _finish_workflow_run(user["workspace"], run_id, "executed", log)
        except Exception as exc:
            error = _execution_error(exc)
            log.append({"t": _iso_now(), "tool": "execution", "result": "failed", "detail": error})
            _finish_workflow_run(user["workspace"], run_id, "failed", log, error)
    with db.connection() as conn:
        run = _run_row(conn, user["workspace"], run_id)
    return {"run": _run_dict(run)}


@app.post("/v1/workflows/runs/{run_id}/reject")
async def reject_run(run_id: str, user: dict[str, Any] = Depends(workspace_user)):
    with db.connection() as conn:
        _run_row(conn, user["workspace"], run_id)
        conn.execute("UPDATE workflow_runs SET status='rejected', updated_at=? WHERE workspace=? AND id=?",
                     (_iso_now(), user["workspace"], run_id))
        run = _run_row(conn, user["workspace"], run_id)
    return {"run": _run_dict(run)}


# ---------------------------------------------------------------------------
# Desktop status (A4000 health seen from the backend) + "eyes" for the chat.

async def _screen_context(workspace: str | None = None, minutes: int = 2) -> str:
    """What is on the remote desktop screen right now (Screenpipe OCR), for Hermes."""
    if not workspace or not db.desktop_lease_held(workspace) or not _screenpipe_enabled():
        return ""
    try:
        end = datetime.now(timezone.utc)
        trace = await _screenpipe_events(
            (end - timedelta(minutes=minutes)).strftime("%Y-%m-%dT%H:%M:%SZ"), end.strftime("%Y-%m-%dT%H:%M:%SZ")
        )
    except (httpx.HTTPError, ValueError):
        return ""
    events = trace.get("events", [])
    if not events:
        return ""
    lines = [f"- [{e['t'][11:19]}] {e['window'][:80]} :: {e['text'][:350]}" for e in events[-8:]]
    return (
        "\n\nÉcran du bureau OctoHandy (Chrome distant, OCR Screenpipe des 2 dernières minutes, du plus ancien au plus "
        "récent). Utilise-le si l'utilisateur parle de ce qu'il voit, de ses messages, favoris ou annonces :\n"
        + "\n".join(lines)
    )


@app.get("/v1/desktop/status")
async def desktop_status_live(user: dict[str, Any] = Depends(workspace_user)):
    base = settings.desktop_base_url.rstrip("/")
    result: dict[str, Any] = {
        "enabled": _desktop_enabled(), "host": settings.desktop_base_url or None,
        "gate": False, "screenpipe": None, "hermes": False, "screen": None, "checkedAt": _iso_now(),
    }
    if not _desktop_enabled():
        return result

    async def gate(client: httpx.AsyncClient) -> None:
        try:
            response = await client.get(f"{base}/desktop/health")
            result["gate"] = response.status_code == 200
        except httpx.HTTPError:
            pass

    async def screenpipe(client: httpx.AsyncClient) -> None:
        if not _screenpipe_enabled():
            return
        headers = {"Authorization": f"Bearer {settings.screenpipe_api_key}"}
        try:
            health = await client.get(f"{settings.screenpipe_api_url.rstrip('/')}/health", headers=headers)
            result["screenpipe"] = {"status": health.json().get("status"), "ok": health.status_code == 200}
            if db.desktop_lease_held(user["workspace"]):
                latest = await client.get(
                    f"{settings.screenpipe_api_url.rstrip('/')}/search", headers=headers,
                    params={"content_type": "ocr", "limit": 1},
                )
                data = latest.json().get("data") or []
                if data:
                    content = data[0].get("content") or {}
                    result["screen"] = {
                        "window": content.get("window_name") or content.get("app_name") or "",
                        "at": content.get("timestamp"),
                        "excerpt": " ".join(str(content.get("text") or "").split())[:240],
                    }
        except (httpx.HTTPError, ValueError):
            result["screenpipe"] = result["screenpipe"] or {"status": "unreachable", "ok": False}

    async def hermes(client: httpx.AsyncClient) -> None:
        if not settings.hermes_api_key:
            return
        try:
            response = await client.get(
                f"{settings.hermes_api_url.rstrip('/')}/models",
                headers={"Authorization": f"Bearer {settings.hermes_api_key}"},
            )
            result["hermes"] = response.status_code == 200
        except httpx.HTTPError:
            pass

    async with httpx.AsyncClient(timeout=8) as client:
        await asyncio.gather(gate(client), screenpipe(client), hermes(client))
    result["model"] = settings.nebius_model
    return result


@app.get("/v1/desktop/screen")
async def desktop_screen(minutes: int = 2, user: dict[str, Any] = Depends(workspace_user)):
    """Proof that Screenpipe sees the remote desktop: the compressed trace of the last N minutes."""
    if not db.desktop_lease_held(user["workspace"]):
        raise HTTPException(409, "Réserve le bureau distant pour consulter son écran.")
    if not _screenpipe_enabled():
        raise HTTPException(503, "Screenpipe non configuré")
    minutes = max(1, min(minutes, 30))
    end = datetime.now(timezone.utc)
    try:
        trace = await _screenpipe_events(
            (end - timedelta(minutes=minutes)).strftime("%Y-%m-%dT%H:%M:%SZ"), end.strftime("%Y-%m-%dT%H:%M:%SZ")
        )
    except (httpx.HTTPError, ValueError) as e:
        raise HTTPException(502, f"Screenpipe injoignable ({type(e).__name__})")
    return {"minutes": minutes, "frames": trace["frames"], "windows": trace["windows"], "events": trace["events"][-12:], "checkedAt": _iso_now()}


@app.get("/v1/stock")
async def list_stock(user: dict[str, Any] = Depends(workspace_user)):
    with db.connection() as conn:
        rows = conn.execute(
            """SELECT s.*, p.display_name AS creator_name FROM stock s
               LEFT JOIN profiles p ON p.user_id=s.created_by
               WHERE s.workspace=? ORDER BY s.created_at, s.id""",
            (user["workspace"],),
        ).fetchall()
    return {"items": [_stock_dict(row) for row in rows]}


class StockIn(BaseModel):
    title: str
    qty: int = Field(default=1, ge=0)
    price: float | None = None
    marketplace: str | None = None
    ownerLabel: str = "toi"
    sku: str | None = None


class StockPatch(BaseModel):
    title: str | None = None
    qty: int | None = Field(default=None, ge=0)
    price: float | None = None
    marketplace: str | None = None
    ownerLabel: str | None = None
    sku: str | None = None


@app.post("/v1/stock")
async def add_stock(body: StockIn, user: dict[str, Any] = Depends(workspace_user)):
    item_id = f"i-{uuid.uuid4().hex[:8]}"
    with db.connection() as conn:
        conn.execute(
            """INSERT INTO stock (id, workspace, created_by, title, sku, qty, price, marketplace, owner_label)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                item_id, user["workspace"], user["user_id"], body.title, body.sku,
                body.qty, body.price, body.marketplace, body.ownerLabel,
            ),
        )
        row = conn.execute(
            """SELECT s.*, p.display_name AS creator_name FROM stock s
               LEFT JOIN profiles p ON p.user_id=s.created_by WHERE s.workspace=? AND s.id=?""",
            (user["workspace"], item_id),
        ).fetchone()
    return {"item": _stock_dict(row)}


@app.patch("/v1/stock/{item_id}")
async def update_stock(item_id: str, body: StockPatch, user: dict[str, Any] = Depends(workspace_user)):
    changes = body.model_dump(exclude_unset=True)
    columns = {
        "title": "title",
        "qty": "qty",
        "price": "price",
        "marketplace": "marketplace",
        "ownerLabel": "owner_label",
        "sku": "sku",
    }
    with db.connection() as conn:
        row = conn.execute(
            """SELECT s.*, p.display_name AS creator_name FROM stock s
               LEFT JOIN profiles p ON p.user_id=s.created_by WHERE s.workspace=? AND s.id=?""",
            (user["workspace"], item_id),
        ).fetchone()
        if row is None:
            raise HTTPException(404, "Stock item not found")
        if changes:
            fields = [f"{columns[key]}=?" for key in changes]
            values = list(changes.values())
            values.extend([_iso_now(), user["workspace"], item_id])
            conn.execute(
                f"UPDATE stock SET {', '.join(fields)}, updated_at=? WHERE workspace=? AND id=?",
                values,
            )
        row = conn.execute(
            """SELECT s.*, p.display_name AS creator_name FROM stock s
               LEFT JOIN profiles p ON p.user_id=s.created_by WHERE s.workspace=? AND s.id=?""",
            (user["workspace"], item_id),
        ).fetchone()
    return {"item": _stock_dict(row)}


@app.delete("/v1/stock/{item_id}")
async def delete_stock(item_id: str, user: dict[str, Any] = Depends(workspace_user)):
    with db.connection() as conn:
        result = conn.execute(
            "DELETE FROM stock WHERE workspace=? AND id=?",
            (user["workspace"], item_id),
        )
        if result.rowcount == 0:
            raise HTTPException(404, "Stock item not found")
    return {"ok": True}


@app.get("/v1/workflows")
async def workflows(user: dict[str, Any] = Depends(workspace_user)):
    with db.connection() as conn:
        rows = conn.execute(
            "SELECT * FROM workflows WHERE workspace=? ORDER BY created_at, id",
            (user["workspace"],),
        ).fetchall()
    return {"workflows": [_workflow_dict(row) for row in rows]}


class WorkflowCreateIn(BaseModel):
    title: str
    marketplace: str
    steps: list[str]
    tone: str | None = None
    source: str = "hermes-chat"
    enabled: bool = False


@app.post("/v1/workflows")
async def create_workflow(body: WorkflowCreateIn, user: dict[str, Any] = Depends(workspace_user)):
    steps = [step.strip() for step in body.steps if step and step.strip()][:12]
    if not steps:
        raise HTTPException(422, "Le workflow doit contenir au moins une étape")
    marketplace = body.marketplace.strip().lower()[:40] or "multi"
    workflow_id = f"w-{uuid.uuid4().hex[:8]}"
    with db.connection() as conn:
        conn.execute(
            """INSERT INTO workflows (id, workspace, created_by, marketplace, title, steps_json, tone, source, enabled)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (workflow_id, user["workspace"], user["user_id"], marketplace, body.title.strip()[:80] or "Workflow",
             json.dumps(steps, ensure_ascii=False), (body.tone or _WORKFLOW_TONES.get(marketplace, "blue"))[:40],
             body.source[:40], int(body.enabled)),
        )
        row = conn.execute("SELECT * FROM workflows WHERE workspace=? AND id=?", (user["workspace"], workflow_id)).fetchone()
    return {"workflow": _workflow_dict(row)}


class RunLogIn(BaseModel):
    workflowId: str
    status: Literal["done", "partial", "failed"]
    summary: str = ""
    recordingId: str | None = None
    stepsDone: list[str] = Field(default_factory=list)


@app.post("/v1/workflows/runs/log")
async def log_run(body: RunLogIn, user: dict[str, Any] = Depends(workspace_user)):
    """Journal d'une exécution faite par l'agent Hermes sur le bureau (vidéo incluse)."""
    if db.desktop_lease_held_by_other(user["workspace"]) is not None:
        raise HTTPException(409, "Le bureau est utilisé par une autre équipe.")
    recording = body.recordingId if body.recordingId and RECORDING_ID.fullmatch(body.recordingId) else None
    log = [{"t": _iso_now(), "step": step[:300], "ok": True} for step in body.stepsDone[:20]]
    log.append({"t": _iso_now(), "step": body.summary[:2000], "ok": body.status != "failed", "kind": "summary"})
    if recording:
        log.append({"t": _iso_now(), "step": "Vidéo de l'exécution", "ok": True, "kind": "recording",
                    "recordingId": recording, "url": f"/v1/desktop/recordings/{recording}.mp4"})
    run_id = f"r-{uuid.uuid4().hex[:8]}"
    with db.connection() as conn:
        conn.execute(
            """INSERT INTO workflow_runs (id, workspace, created_by, workflow_id, status, mode, log_json, updated_at)
               VALUES (?, ?, ?, ?, ?, 'hermes-chat', ?, ?)""",
            (run_id, user["workspace"], user["user_id"], body.workflowId, body.status,
             json.dumps(log, ensure_ascii=False), _iso_now()),
        )
        run = _run_row(conn, user["workspace"], run_id)
    return {"run": _run_dict(run)}


RECORDING_ID = re.compile(r"[0-9a-f]{16}")


@app.get("/v1/desktop/recordings/{recording_id}.mp4")
async def desktop_recording(recording_id: str):
    """Vidéo d'une exécution sur le bureau A4000. L'id est un secret aléatoire de 64 bits (lien type pièce jointe)."""
    if not RECORDING_ID.fullmatch(recording_id) or not _desktop_enabled():
        raise HTTPException(404, "Vidéo introuvable")
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.get(
                f"{settings.desktop_base_url.rstrip('/')}/desktop/recordings/{recording_id}.mp4",
                headers={"X-Gate-Secret": settings.desktop_signing_secret},
            )
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Bureau indisponible ({type(e).__name__})") from e
    if response.status_code != 200:
        raise HTTPException(404, "Vidéo introuvable")
    return Response(content=response.content, media_type="video/mp4",
                    headers={"Cache-Control": "private, max-age=86400", "Accept-Ranges": "none"})


class WorkflowPatch(BaseModel):
    enabled: bool


@app.patch("/v1/workflows/{workflow_id}")
async def update_workflow(
    workflow_id: str,
    body: WorkflowPatch,
    user: dict[str, Any] = Depends(workspace_user),
):
    with db.connection() as conn:
        result = conn.execute(
            """UPDATE workflows SET enabled=?, updated_at=?
               WHERE workspace=? AND id=?""",
            (int(body.enabled), _iso_now(), user["workspace"], workflow_id),
        )
        if result.rowcount == 0:
            raise HTTPException(404, "Workflow not found")
        row = conn.execute(
            "SELECT * FROM workflows WHERE workspace=? AND id=?",
            (user["workspace"], workflow_id),
        ).fetchone()
    return {"workflow": _workflow_dict(row)}


@app.post("/v1/org/invite-links")
async def create_invite_link(user: dict[str, Any] = Depends(workspace_user)):
    org_id = user.get("org_id")
    if not org_id:
        raise HTTPException(status_code=400, detail="Sélectionne une organisation")
    try:
        clerk_status, clerk_user = await _clerk_api("GET", f"/users/{user['user_id']}")
    except (HTTPException, httpx.HTTPError) as exc:
        raise HTTPException(status_code=502, detail="Impossible de vérifier l'accès OctoHandy") from exc
    if clerk_status >= 400:
        raise HTTPException(status_code=502, detail="Impossible de vérifier l'accès OctoHandy")
    public_metadata = clerk_user.get("public_metadata")
    if not isinstance(public_metadata, dict) or public_metadata.get("stockflow_access") is not True:
        allowed_emails = {
            email.strip().lower()
            for email in settings.poc_allowed_emails.split(",")
            if email.strip()
        }
        email_addresses = clerk_user.get("email_addresses")
        email_allowed = isinstance(email_addresses, list) and any(
            isinstance(address, dict)
            and isinstance(address.get("email_address"), str)
            and address["email_address"].strip().lower() in allowed_emails
            for address in email_addresses
        )
        if not email_allowed:
            raise HTTPException(status_code=403, detail="Accès OctoHandy requis pour inviter")
    created_at = datetime.now(timezone.utc)
    expires_at = created_at + timedelta(days=7)
    token = f"inv_{uuid.uuid4().hex}"
    with db.connection() as conn:
        conn.execute(
            """INSERT INTO invite_links (token, org_id, created_by, created_at, expires_at)
               VALUES (?, ?, ?, ?, ?)""",
            (
                token, org_id, user["user_id"],
                created_at.isoformat().replace("+00:00", "Z"),
                expires_at.isoformat().replace("+00:00", "Z"),
            ),
        )
    return {"token": token, "path": f"/join/{token}", "expiresAt": expires_at.isoformat().replace("+00:00", "Z")}


def _invite(token: str) -> dict[str, Any]:
    with db.connection() as conn:
        row = conn.execute("SELECT * FROM invite_links WHERE token=?", (token,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Lien d'invitation introuvable")
    expires_at = datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00"))
    if expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="Ce lien d'invitation a expiré")
    return dict(row)


@app.get("/v1/invites/{token}")
async def invite_info(token: str, _user: dict[str, Any] = Depends(workspace_user)):
    invite = _invite(token)
    org_name = await _organization_name(invite["org_id"])
    return {"orgId": invite["org_id"], "orgName": org_name, "expiresAt": invite["expires_at"]}


def _clerk_error_codes(payload: dict[str, Any]) -> set[str]:
    errors = payload.get("errors", [])
    if not isinstance(errors, list):
        return set()
    return {str(error.get("code")) for error in errors if isinstance(error, dict) and error.get("code")}


@app.post("/v1/invites/{token}/accept")
async def accept_invite(token: str, user: dict[str, Any] = Depends(workspace_user)):
    if user.get("via") != "clerk":
        raise HTTPException(status_code=401, detail="Connexion Clerk requise")
    invite = _invite(token)
    org_id = invite["org_id"]
    membership_status, membership_data = await _clerk_api(
        "POST",
        f"/organizations/{org_id}/memberships",
        {"user_id": user["user_id"], "role": "org:admin"},
    )
    if membership_status >= 400 and "already_a_member_in_organization" not in _clerk_error_codes(membership_data):
        raise HTTPException(status_code=502, detail="Impossible de rejoindre l'organisation")
    metadata_status, _metadata_data = await _clerk_api(
        "PATCH",
        f"/users/{user['user_id']}/metadata",
        {"public_metadata": {"stockflow_access": True}},
    )
    if metadata_status >= 400:
        raise HTTPException(status_code=502, detail="Impossible de mettre à jour l'accès OctoHandy")
    return {"orgId": org_id}


class ChatIn(BaseModel):
    message: str = Field(min_length=1)
    images: list[str] = Field(default_factory=list)


async def _chat_response(body: ChatIn, user: dict[str, Any], system: str) -> dict[str, Any]:
    """Chat via Hermes, then Nebius Token Factory (DeepSeek), or a mock response."""
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
            "content": f"J'ai bien reçu ton message : « {body.message[:200]} ». L'agent n'est pas configuré sur ce serveur.",
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


@app.post("/v1/chat")
async def chat(body: ChatIn, user: dict[str, Any] = Depends(workspace_user)):
    workspace = user["workspace"]
    lease_id = None
    busy_seconds = None
    if not db.desktop_lease_held(workspace):
        lease_id, busy_seconds = db.acquire_desktop_lease(
            workspace,
            user["user_id"],
            None,
            int(settings.hermes_timeout + 60),
        )
    try:
        system = _build_chat_system_prompt() + await _chat_context(user) + await _screen_context(workspace)
        if busy_seconds is not None:
            minutes = max(1, (busy_seconds + 59) // 60)
            system += (
                "\n\nLe bureau OctoHandy est utilisé par une autre équipe en ce moment : "
                "ne lance aucune action ni aucun workflow sur le bureau, ne crée pas d'exécution. "
                f"Dis à l'utilisateur que le bureau est occupé et qu'il pourra réessayer dans environ {minutes} minute(s)."
            )
        return await _chat_response(body, user, system)
    finally:
        if lease_id:
            db.release_desktop_lease(workspace, lease_id)
