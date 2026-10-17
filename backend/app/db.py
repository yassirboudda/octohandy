from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

from .settings import settings


DEFAULT_WORKFLOWS = (
    {
        "id": "vinted-fav-offer",
        "marketplace": "vinted",
        "title": "Favoris → proposition de prix",
        "steps": [
            "Repérer un nouvel article ajouté aux favoris",
            "Vérifier le contexte de la conversation",
            "Préparer une proposition de prix à valider par le vendeur",
        ],
        "tone": "teal",
        "trigger": "Un acheteur ajoute un article aux favoris",
        "intent": {
            "goal": "Préparer une proposition de prix adaptée à l'article favori",
            "actor": "seller",
            "entities": {},
            "success_criteria": "Le vendeur approuve la proposition avant son envoi",
            "constraints": ["Respecter le prix plancher défini par le vendeur"],
        },
        "tools": [{"tool": "list_favorites"}, {"tool": "read_thread"}, {"tool": "send_offer"}],
        "guardrails": ["Ne jamais envoyer une offre sans approbation du vendeur"],
        "tone_notes": "Réponse courte et chaleureuse",
    },
    {
        "id": "vinted-bump",
        "marketplace": "vinted",
        "title": "Annonce peu consultée → révision du prix",
        "steps": [
            "Consulter les performances d'une annonce active",
            "Suggérer une baisse à valider par le vendeur",
            "Préparer une mise à jour du prix",
        ],
        "tone": "teal",
        "trigger": "Une annonce active reçoit peu de consultations",
        "intent": {
            "goal": "Examiner les performances et préparer une révision du prix",
            "actor": "seller",
            "entities": {},
            "success_criteria": "Le vendeur approuve tout changement de prix",
            "constraints": ["Ne pas passer sous le prix plancher du vendeur"],
        },
        "tools": [{"tool": "get_listing"}, {"tool": "update_price"}],
        "guardrails": ["Ne jamais modifier le prix sans approbation du vendeur"],
        "tone_notes": "Conseil factuel, sans pression",
    },
    {
        "id": "multi-restock",
        "marketplace": "multi",
        "title": "Stock partagé → nouvelle annonce",
        "steps": ["Article ajouté au stock partagé", "Choisir une marketplace", "Préparer une annonce à valider"],
        "tone": "blue",
        "trigger": "Un article est ajouté au stock partagé",
        "intent": {
            "goal": "Préparer la remise en ligne d'un article disponible",
            "actor": "seller",
            "entities": {},
            "success_criteria": "Le vendeur valide l'annonce avant sa publication",
            "constraints": ["Utiliser uniquement les informations présentes dans le stock"],
        },
        "tools": [{"tool": "republish_listing"}],
        "guardrails": ["Ne jamais publier une annonce sans approbation du vendeur"],
        "tone_notes": "Description précise et fidèle à l'article",
    },
)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS shops (
    id TEXT NOT NULL,
    workspace TEXT NOT NULL,
    created_by TEXT NOT NULL,
    marketplace TEXT NOT NULL,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'connected',
    listing_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (workspace, id)
);
CREATE TABLE IF NOT EXISTS listings (
    id TEXT NOT NULL,
    workspace TEXT NOT NULL,
    created_by TEXT NOT NULL,
    shop_id TEXT NOT NULL,
    marketplace TEXT NOT NULL,
    title TEXT NOT NULL,
    price REAL NOT NULL,
    status TEXT NOT NULL,
    image_url TEXT,
    url TEXT,
    views INTEGER,
    favorites INTEGER,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace, id)
);
CREATE TABLE IF NOT EXISTS stock (
    id TEXT NOT NULL,
    workspace TEXT NOT NULL,
    created_by TEXT NOT NULL,
    title TEXT NOT NULL,
    sku TEXT,
    qty INTEGER NOT NULL,
    price REAL,
    marketplace TEXT,
    owner_label TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (workspace, id)
);
CREATE TABLE IF NOT EXISTS workflows (
    id TEXT NOT NULL,
    workspace TEXT NOT NULL,
    created_by TEXT NOT NULL,
    marketplace TEXT NOT NULL,
    title TEXT NOT NULL,
    steps_json TEXT NOT NULL,
    tone TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'screenpipe',
    enabled INTEGER NOT NULL DEFAULT 0,
    "trigger" TEXT,
    intent_json TEXT,
    tools_json TEXT,
    guardrails_json TEXT,
    tone_notes TEXT,
    confidence TEXT,
    human_profile_json TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (workspace, id)
);
CREATE TABLE IF NOT EXISTS marketplace_sessions (
    workspace TEXT NOT NULL,
    created_by TEXT NOT NULL,
    marketplace TEXT NOT NULL,
    display_name TEXT NOT NULL,
    credentials_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (workspace, marketplace)
);
CREATE TABLE IF NOT EXISTS ext_tokens (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workspace TEXT NOT NULL,
    created_by TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invite_links (
    token TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS profiles (
    user_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL DEFAULT '',
    preferences TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE IF NOT EXISTS seeded (
    workspace TEXT PRIMARY KEY,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_shops_workspace ON shops(workspace);
CREATE INDEX IF NOT EXISTS idx_listings_workspace_shop ON listings(workspace, shop_id);
CREATE INDEX IF NOT EXISTS idx_stock_workspace ON stock(workspace);
CREATE TABLE IF NOT EXISTS teach_sessions (
    id TEXT NOT NULL,
    workspace TEXT NOT NULL,
    created_by TEXT NOT NULL,
    marketplace TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'recording',
    started_at TEXT NOT NULL,
    ended_at TEXT,
    trace_json TEXT,
    draft_json TEXT,
    workflow_id TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (workspace, id)
);
CREATE TABLE IF NOT EXISTS workflow_runs (
    id TEXT NOT NULL,
    workspace TEXT NOT NULL,
    created_by TEXT NOT NULL,
    workflow_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'planning',
    mode TEXT NOT NULL DEFAULT 'assisted',
    context_json TEXT,
    plan_json TEXT,
    log_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (workspace, id)
);
CREATE TABLE IF NOT EXISTS desktop_leases (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    workspace TEXT NOT NULL,
    user_id TEXT NOT NULL,
    marketplace TEXT,
    lease_id TEXT NOT NULL,
    acquired_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflows_workspace ON workflows(workspace);
"""


@contextmanager
def connection() -> Iterator[sqlite3.Connection]:
    path = Path(settings.database_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def initialize_database() -> None:
    with connection() as conn:
        conn.executescript(_SCHEMA)
        migrate_workflow_columns(conn)
        migrate_desktop_lease_id(conn)
        migrate_default_workflow_copy(conn)


def migrate_workflow_columns(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(workflows)")}
    missing = {
        "trigger": "TEXT",
        "intent_json": "TEXT",
        "tools_json": "TEXT",
        "guardrails_json": "TEXT",
        "tone_notes": "TEXT",
        "confidence": "TEXT",
        "human_profile_json": "TEXT",
    }
    for name, column_type in missing.items():
        if name not in columns:
            quoted_name = f'"{name}"'
            conn.execute(f"ALTER TABLE workflows ADD COLUMN {quoted_name} {column_type}")


def migrate_desktop_lease_id(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(desktop_leases)")}
    if "lease_id" not in columns:
        conn.execute("ALTER TABLE desktop_leases ADD COLUMN lease_id TEXT")
    rows = conn.execute("SELECT id FROM desktop_leases WHERE lease_id IS NULL").fetchall()
    for row in rows:
        conn.execute("UPDATE desktop_leases SET lease_id=? WHERE id=?", (uuid.uuid4().hex, row["id"]))


def migrate_default_workflow_copy(conn: sqlite3.Connection) -> None:
    legacy = {
        "vinted-fav-offer": (
            "Favoris → offre discount",
            [
                "Client met un article en favoris",
                "Détection via messagerie / notif (backend plus tard)",
                "Envoi d'un message avec proposition de prix (discount)",
            ],
        ),
        "vinted-bump": (
            "Annonce dormante → baisse auto",
            ["Annonce sans vue depuis N jours", "Calcul d'une baisse X%", "Mise à jour prix + message optionnel"],
        ),
        "multi-restock": (
            "Stock équipe → republish",
            ["Article ajouté au stock partagé", "Choix marketplace", "Création / republication de l'annonce"],
        ),
    }
    for workflow in DEFAULT_WORKFLOWS:
        old = legacy.get(workflow["id"])
        if old is None:
            continue
        old_title, old_steps = old
        rows = conn.execute(
            "SELECT workspace, title, steps_json FROM workflows WHERE id=?",
            (workflow["id"],),
        ).fetchall()
        for row in rows:
            try:
                steps = json.loads(row["steps_json"])
            except (TypeError, json.JSONDecodeError):
                continue
            if row["title"] != old_title or steps != old_steps:
                continue
            conn.execute(
                """UPDATE workflows SET title=?, steps_json=?, "trigger"=?, intent_json=?, tools_json=?,
                   guardrails_json=?, tone_notes=? WHERE workspace=? AND id=?""",
                (
                    workflow["title"],
                    json.dumps(workflow["steps"], ensure_ascii=False),
                    workflow["trigger"],
                    json.dumps(workflow["intent"], ensure_ascii=False),
                    json.dumps(workflow["tools"], ensure_ascii=False),
                    json.dumps(workflow["guardrails"], ensure_ascii=False),
                    workflow["tone_notes"],
                    row["workspace"],
                    workflow["id"],
                ),
            )


def _lease_expiry(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def acquire_desktop_lease(
    workspace: str,
    user_id: str,
    marketplace: str | None,
    ttl: int,
) -> tuple[str | None, int | None]:
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat().replace("+00:00", "Z")
    expires_iso = (now + timedelta(seconds=max(1, ttl))).isoformat().replace("+00:00", "Z")
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        lease = conn.execute("SELECT * FROM desktop_leases WHERE id=1").fetchone()
        if lease is not None and _lease_expiry(lease["expires_at"]) > now:
            if lease["workspace"] != workspace:
                return None, max(0, int((_lease_expiry(lease["expires_at"]) - now).total_seconds()))
            lease_id = lease["lease_id"] or uuid.uuid4().hex
            extended_expiry = max(_lease_expiry(lease["expires_at"]), _lease_expiry(expires_iso))
            conn.execute(
                """UPDATE desktop_leases
                   SET user_id=?, marketplace=?, lease_id=?, expires_at=? WHERE id=1""",
                (
                    user_id,
                    marketplace,
                    lease_id,
                    extended_expiry.isoformat().replace("+00:00", "Z"),
                ),
            )
            return lease_id, None
        else:
            lease_id = uuid.uuid4().hex
            conn.execute(
                """INSERT INTO desktop_leases (id, workspace, user_id, marketplace, lease_id, acquired_at, expires_at)
                   VALUES (1, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET workspace=excluded.workspace, user_id=excluded.user_id,
                     marketplace=excluded.marketplace, lease_id=excluded.lease_id, acquired_at=excluded.acquired_at,
                     expires_at=excluded.expires_at""",
                (workspace, user_id, marketplace, lease_id, now_iso, expires_iso),
            )
            return lease_id, None


def desktop_lease_held(workspace: str) -> bool:
    now = datetime.now(timezone.utc)
    with connection() as conn:
        lease = conn.execute("SELECT workspace, expires_at FROM desktop_leases WHERE id=1").fetchone()
    return bool(lease and lease["workspace"] == workspace and _lease_expiry(lease["expires_at"]) > now)


def desktop_lease_held_by_other(workspace: str) -> int | None:
    now = datetime.now(timezone.utc)
    with connection() as conn:
        lease = conn.execute("SELECT workspace, expires_at FROM desktop_leases WHERE id=1").fetchone()
    if lease is None or lease["workspace"] == workspace:
        return None
    expires_at = _lease_expiry(lease["expires_at"])
    if expires_at <= now:
        return None
    return max(0, int((expires_at - now).total_seconds()))


def release_desktop_lease(workspace: str, lease_id: str | None = None) -> bool:
    with connection() as conn:
        if lease_id is None:
            result = conn.execute("DELETE FROM desktop_leases WHERE id=1 AND workspace=?", (workspace,))
        else:
            result = conn.execute(
                "DELETE FROM desktop_leases WHERE id=1 AND workspace=? AND lease_id=?",
                (workspace, lease_id),
            )
    return result.rowcount > 0


def seed_workspace(
    workspace: str,
    created_by: str,
    *,
    personal: bool,
    shops: list[dict[str, Any]],
    listings: list[dict[str, Any]],
    stock: list[dict[str, Any]],
) -> None:
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if conn.execute("SELECT 1 FROM seeded WHERE workspace = ?", (workspace,)).fetchone():
            return
        if personal:
            conn.executemany(
                """INSERT INTO shops
                   (id, workspace, created_by, marketplace, display_name, status, listing_count)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                [
                    (
                        shop["id"], workspace, created_by, shop["marketplace"], shop["displayName"],
                        shop["status"], shop.get("listingCount", 0),
                    )
                    for shop in shops
                ],
            )
            conn.executemany(
                """INSERT INTO listings
                   (id, workspace, created_by, shop_id, marketplace, title, price, status,
                    image_url, url, views, favorites, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                [
                    (
                        item["id"], workspace, created_by, item["shopId"], item["marketplace"],
                        item["title"], item["price"], item["status"], item.get("imageUrl"),
                        item.get("url"), item.get("views"), item.get("favorites"), item["updatedAt"],
                    )
                    for item in listings
                ],
            )
            conn.executemany(
                """INSERT INTO stock
                   (id, workspace, created_by, title, sku, qty, price, marketplace, owner_label)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                [
                    (
                        item["id"], workspace, created_by, item["title"], item.get("sku"),
                        item["qty"], item.get("price"), item.get("marketplace"), item.get("ownerLabel", "toi"),
                    )
                    for item in stock
                ],
            )
        conn.executemany(
            """INSERT INTO workflows
               (id, workspace, created_by, marketplace, title, steps_json, tone, source, enabled,
                "trigger", intent_json, tools_json, guardrails_json, tone_notes, confidence)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'screenpipe', 0, ?, ?, ?, ?, ?, 'medium')""",
            [
                (
                    flow["id"], workspace, created_by, flow["marketplace"], flow["title"],
                    json.dumps(flow["steps"], ensure_ascii=False), flow["tone"], flow["trigger"],
                    json.dumps(flow["intent"], ensure_ascii=False), json.dumps(flow["tools"], ensure_ascii=False),
                    json.dumps(flow["guardrails"], ensure_ascii=False), flow["tone_notes"],
                )
                for flow in DEFAULT_WORKFLOWS
            ],
        )
        conn.execute(
            "INSERT INTO seeded (workspace, created_by) VALUES (?, ?)",
            (workspace, created_by),
        )
