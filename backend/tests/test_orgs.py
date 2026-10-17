import asyncio
import json
import sqlite3
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import db, main


@pytest.fixture
def app_state(monkeypatch, tmp_path):
    monkeypatch.setattr(main.settings, "database_path", str(tmp_path / "stockflow.db"))
    monkeypatch.setattr(main.settings, "clerk_secret_key", "sk_test_local")
    main._organization_names.clear()
    current_user = {
        "user_id": "user_a",
        "workspace": "user:user_a",
        "org_id": None,
        "via": "clerk",
        "claims": {},
    }
    main.app.dependency_overrides.clear()
    main.app.dependency_overrides[main.require_user] = lambda: current_user
    yield main.app, current_user
    main.app.dependency_overrides.clear()


@pytest.fixture
def client(app_state):
    app, current_user = app_state
    with TestClient(app) as test_client:
        yield test_client, current_user


def assume_user(current_user, user_id, org_id=None):
    current_user.clear()
    current_user.update(
        {
            "user_id": user_id,
            "workspace": f"org:{org_id}" if org_id else f"user:{user_id}",
            "org_id": org_id,
            "via": "clerk",
            "claims": {},
        }
    )


def test_personal_and_organization_workspaces_are_isolated(client):
    test_client, current_user = client
    private_item = test_client.post(
        "/v1/stock",
        json={"title": "Personnel A", "qty": 1},
    ).json()["item"]
    assert len(test_client.get("/v1/shops").json()["shops"]) == 1  # demo seed: one Vinted shop

    assume_user(current_user, "user_a", "org_x")
    assert test_client.get("/v1/stock").json()["items"] == []
    assert test_client.get("/v1/shops").json()["shops"] == []
    assert test_client.get("/v1/listings").json()["listings"] == []
    test_client.post("/v1/stock", json={"title": "Stock org X", "qty": 2})

    assume_user(current_user, "user_a")
    personal_items = test_client.get("/v1/stock").json()["items"]
    assert any(item["id"] == private_item["id"] for item in personal_items)
    assert not any(item["title"] == "Stock org X" for item in personal_items)


def test_organization_members_share_data_but_not_personal_data(client):
    test_client, current_user = client
    personal_item = test_client.post(
        "/v1/stock",
        json={"title": "Privé de A", "qty": 3},
    ).json()["item"]

    assume_user(current_user, "user_a", "org_x")
    created_shop = test_client.post(
        "/v1/shops",
        json={"marketplace": "vinted", "displayName": "Boutique commune"},
    ).json()["shop"]
    shared_item = test_client.post(
        "/v1/stock",
        json={"title": "Article partagé", "qty": 4},
    ).json()["item"]
    workflow = test_client.get("/v1/workflows").json()["workflows"][0]
    test_client.patch(f"/v1/workflows/{workflow['id']}", json={"enabled": True})

    assume_user(current_user, "user_b", "org_x")
    assert created_shop["id"] in [shop["id"] for shop in test_client.get("/v1/shops").json()["shops"]]
    assert shared_item["id"] in [item["id"] for item in test_client.get("/v1/stock").json()["items"]]
    assert test_client.get("/v1/workflows").json()["workflows"][0]["enabled"] is True

    assume_user(current_user, "user_b")
    personal_items = test_client.get("/v1/stock").json()["items"]
    assert all(item["id"] != personal_item["id"] for item in personal_items)
    assert all(item["id"] != shared_item["id"] for item in personal_items)


def test_workflow_toggle_is_persistent_and_scoped(client):
    test_client, current_user = client
    assume_user(current_user, "user_a", "org_x")
    workflow_id = test_client.get("/v1/workflows").json()["workflows"][0]["id"]
    assert test_client.patch(
        f"/v1/workflows/{workflow_id}",
        json={"enabled": True},
    ).json()["workflow"]["enabled"] is True

    assume_user(current_user, "user_b", "org_x")
    assert test_client.get("/v1/workflows").json()["workflows"][0]["enabled"] is True

    assume_user(current_user, "user_b", "org_y")
    assert test_client.get("/v1/workflows").json()["workflows"][0]["enabled"] is False


def test_teach_save_persists_intent_and_run_prompt_uses_guardrails(client, monkeypatch):
    test_client, current_user = client
    started_at = "2026-01-01T00:00:00Z"
    draft = {
        "title": "Répondre aux favoris",
        "trigger": "Un article est ajouté aux favoris",
        "steps": ["Lire la demande", "Préparer une réponse"],
        "tools": [{"tool": "read_thread", "args": {}}],
        "intent": {
            "goal": "Répondre à l'acheteur sans dépasser le prix plancher",
            "actor": "seller",
            "entities": {"marketplace": "vinted", "prix_plancher": "20 €"},
            "success_criteria": "La réponse est envoyée après validation",
            "constraints": ["Ne jamais proposer moins de 20 €"],
        },
        "guardrails": ["Ne pas proposer moins de 20 €"],
        "tone_notes": "Tutoiement, ton chaleureux",
        "confidence": "high",
    }
    with db.connection() as conn:
        conn.execute(
            """INSERT INTO teach_sessions
               (id, workspace, created_by, marketplace, status, started_at, trace_json, draft_json)
               VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)""",
            (
                "teach-intent", current_user["workspace"], current_user["user_id"], "vinted", started_at,
                json.dumps({"events": [{"t": started_at}, {"t": "2026-01-01T00:00:03Z"}]}),
                json.dumps(draft, ensure_ascii=False),
            ),
        )
    saved = test_client.post(
        "/v1/teach/teach-intent/save",
        json={"title": draft["title"], "steps": draft["steps"], "enabled": True},
    )
    assert saved.status_code == 200
    workflow = saved.json()["workflow"]
    assert workflow["intent"] == draft["intent"]
    assert workflow["trigger"] == draft["trigger"]
    assert workflow["tools"] == draft["tools"]
    assert workflow["guardrails"] == draft["guardrails"]
    assert workflow["toneNotes"] == draft["tone_notes"]
    assert workflow["confidence"] == "high"
    assert workflow["humanProfile"]["pace"] == 3

    captured = {}

    async def fake_llm(system, user_text, _session_key):
        captured["system"] = system
        captured["user_text"] = user_text
        return {
            "actions": [{"tool": "read_thread", "args": {}, "needs_approval": False}],
            "summary": "Lire le fil",
        }, "test"

    monkeypatch.setattr(main, "_llm_json", fake_llm)
    response = test_client.post(f"/v1/workflows/{workflow['id']}/run")
    assert response.status_code == 200
    prompt = captured["user_text"]
    assert "Ne pas proposer moins de 20 €" in prompt
    assert prompt.index("Garde-fous :") < prompt.index("Contexte live du bureau")
    assert "Répondre à l'acheteur" in prompt


def test_desktop_lease_blocks_another_workspace_and_hides_screen(client, monkeypatch):
    test_client, current_user = client
    monkeypatch.setattr(main, "_desktop_enabled", lambda: True)
    monkeypatch.setattr(main, "_screenpipe_enabled", lambda: True)
    monkeypatch.setattr(main.settings, "desktop_base_url", "https://desktop.example")
    monkeypatch.setattr(main.settings, "desktop_signing_secret", "test-secret")

    async def opened(_url):
        return True

    monkeypatch.setattr(main, "_desktop_open", opened)
    started = test_client.post("/v1/teach/start", json={"marketplace": "vinted"})
    assert started.status_code == 200
    assert db.desktop_lease_held(current_user["workspace"])

    assume_user(current_user, "user_b")
    blocked = test_client.post("/v1/teach/start", json={"marketplace": "vinted"})
    assert blocked.status_code == 409
    assert "autre équipe" in blocked.json()["detail"]
    assert asyncio.run(main._screen_context(current_user["workspace"])) == ""


def test_auto_click_keeps_approval_filter_and_logs_stale_screen_without_click(client, monkeypatch):
    test_client, current_user = client
    workflow_id = test_client.get("/v1/workflows").json()["workflows"][0]["id"]
    run_id = "run-auto-click"
    plan = {
        "actions": [
            {"tool": "send_message", "args": {}, "preview": "Bonjour", "needs_approval": True, "target_text": "Envoyer"},
            {"tool": "read_thread", "args": {}, "preview": "", "needs_approval": False, "target_text": "Répondre"},
        ]
    }
    with db.connection() as conn:
        conn.execute(
            """INSERT INTO workflow_runs (id, workspace, created_by, workflow_id, status, plan_json)
               VALUES (?, ?, ?, ?, 'awaiting_approval', ?)""",
            (run_id, current_user["workspace"], current_user["user_id"], workflow_id, json.dumps(plan)),
        )
    db.acquire_desktop_lease(current_user["workspace"], current_user["user_id"], "vinted", 3600)
    monkeypatch.setattr(main, "_desktop_enabled", lambda: True)
    monkeypatch.setattr(main, "_desktop_open", lambda _url: asyncio.sleep(0, result=True))
    async def stale_target(_text, **_kwargs):
        raise main.ScreenpipeFrameStaleError()

    monkeypatch.setattr(main, "find_target", stale_target)
    monkeypatch.setattr(main, "pre_action_delay", lambda _rng, _profile: 0)

    class FakeDesktop:
        clicks = 0

        def __init__(self, *_args):
            self.width = 1600
            self.height = 900

        async def connect(self):
            pass

        async def close(self):
            pass

        async def click(self, *_args, **_kwargs):
            type(self).clicks += 1

    monkeypatch.setattr(main, "RemoteDesktop", FakeDesktop)
    async def approve_and_wait():
        response = await main.approve_run(
            run_id,
            main.RunDecisionIn(approved_indexes=[1], mode="auto_click"),
            current_user,
        )
        assert response["run"]["status"] == "executing"
        tasks = [task for task in main._run_tasks if not task.done()]
        assert len(tasks) == 1
        await tasks[0]

    asyncio.run(approve_and_wait())
    with db.connection() as conn:
        run = main._run_row(conn, current_user["workspace"], run_id)
    log = json.loads(run["log_json"])
    assert log[0]["detail"] == "non approuvée"
    assert log[1]["detail"] == "écran Screenpipe pas à jour : aucun clic"
    assert FakeDesktop.clicks == 0


def test_screen_excerpt_flags_stale_frame(monkeypatch):
    async def stale_frame():
        raise main.ScreenpipeFrameStaleError()

    monkeypatch.setattr(main, "latest_frame_id", stale_frame)
    assert asyncio.run(main._screen_excerpt()) == "écran Screenpipe pas à jour"


def test_auto_click_approval_returns_before_background_execution_and_persists_result(client, monkeypatch):
    test_client, current_user = client
    workflow_id = test_client.get("/v1/workflows").json()["workflows"][0]["id"]
    run_id = "run-background-click"
    plan = {"actions": [{"tool": "read_thread", "args": {}, "preview": "", "needs_approval": False}]}
    with db.connection() as conn:
        conn.execute(
            """INSERT INTO workflow_runs (id, workspace, created_by, workflow_id, status, plan_json)
               VALUES (?, ?, ?, ?, 'awaiting_approval', ?)""",
            (run_id, current_user["workspace"], current_user["user_id"], workflow_id, json.dumps(plan)),
        )
    db.acquire_desktop_lease(current_user["workspace"], current_user["user_id"], "vinted", 3600)
    calls = []

    async def fake_execute_run_actions(
        _run_id, _workspace, _user, _workflow, _plan, _approved_indexes, _mode, log,
    ):
        calls.append("started")
        log.append({"t": main._iso_now(), "tool": "read_thread", "result": "clicked", "detail": "test terminé"})

    monkeypatch.setattr(main, "_execute_run_actions", fake_execute_run_actions)

    async def approve_and_wait():
        response = await main.approve_run(
            run_id,
            main.RunDecisionIn(approved_indexes=[0], mode="auto_click"),
            current_user,
        )
        assert response["run"]["status"] == "executing"
        assert calls == []
        tasks = [task for task in main._run_tasks if not task.done()]
        assert len(tasks) == 1
        await tasks[0]

    asyncio.run(approve_and_wait())
    with db.connection() as conn:
        run = main._run_row(conn, current_user["workspace"], run_id)
    assert calls == ["started"]
    assert run["status"] == "executed"
    assert json.loads(run["log_json"])[0]["detail"] == "test terminé"


def test_vinted_start_url_uses_homepage():
    assert main._marketplace_start_url("vinted") == "https://www.vinted.fr/"


def test_created_workflow_defaults_nullable_metadata(client):
    test_client, _current_user = client
    created = test_client.post(
        "/v1/workflows",
        json={
            "title": "Workflow créé par le chat",
            "marketplace": "vinted",
            "steps": ["Vérifier le nouvel article"],
        },
    )
    assert created.status_code == 200
    workflow_id = created.json()["workflow"]["id"]
    assert created.json()["workflow"]["intent"] == {}
    assert created.json()["workflow"]["guardrails"] == []

    listed = test_client.get("/v1/workflows")
    assert listed.status_code == 200
    workflow = next(item for item in listed.json()["workflows"] if item["id"] == workflow_id)
    assert workflow["intent"] == {}
    assert workflow["guardrails"] == []


def test_workflow_schema_migration_is_idempotent(client):
    test_client, current_user = client
    test_client.get("/v1/workflows")
    legacy_steps = [
        "Client met un article en favoris",
        "Détection via messagerie / notif (backend plus tard)",
        "Envoi d'un message avec proposition de prix (discount)",
    ]
    with db.connection() as conn:
        conn.execute(
            "UPDATE workflows SET title=?, steps_json=? WHERE workspace=? AND id=?",
            (
                "Favoris → offre discount",
                json.dumps(legacy_steps, ensure_ascii=False),
                current_user["workspace"],
                "vinted-fav-offer",
            ),
        )
    db.initialize_database()
    db.initialize_database()
    with db.connection() as conn:
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(workflows)")}
        migrated = conn.execute(
            "SELECT title, steps_json FROM workflows WHERE workspace=? AND id=?",
            (current_user["workspace"], "vinted-fav-offer"),
        ).fetchone()
    assert {
        "trigger", "intent_json", "tools_json", "guardrails_json",
        "tone_notes", "confidence", "human_profile_json",
    } <= columns
    assert migrated["title"] == "Favoris → proposition de prix"
    assert "backend plus tard" not in migrated["steps_json"]


def test_patch_and_delete_reject_rows_from_another_workspace(client):
    test_client, current_user = client
    item = test_client.post("/v1/stock", json={"title": "Privé", "qty": 1}).json()["item"]
    shop = test_client.post(
        "/v1/shops",
        json={"marketplace": "vinted", "displayName": "Privée"},
    ).json()["shop"]

    assume_user(current_user, "user_b")
    assert test_client.patch(f"/v1/stock/{item['id']}", json={"qty": 9}).status_code == 404
    assert test_client.delete(f"/v1/stock/{item['id']}").status_code == 404
    assert test_client.patch(f"/v1/shops/{shop['id']}", json={"status": "expired"}).status_code == 404
    assert test_client.delete(f"/v1/shops/{shop['id']}").status_code == 404


def test_invite_links_require_an_org_and_accept_with_admin_role(client, monkeypatch):
    test_client, current_user = client
    assert test_client.post("/v1/org/invite-links").status_code == 400

    assume_user(current_user, "owner", "org_x")
    calls = []

    async def fake_clerk_api(method, path, body=None):
        calls.append((method, path, body))
        if method == "GET":
            if path == "/users/owner":
                return 200, {"email_addresses": [{"email_address": "YassirBoudda@gmail.com"}]}
            return 200, {"id": "org_x", "name": "Atelier partagé"}
        if method == "POST":
            return 422, {
                "errors": [{"code": "already_a_member_in_organization"}],
            }
        return 200, {"public_metadata": {"stockflow_access": True}}

    monkeypatch.setattr(main, "_clerk_api", fake_clerk_api)
    created_response = test_client.post("/v1/org/invite-links")
    assert created_response.status_code == 200
    created = created_response.json()
    assert created["token"].startswith("inv_")
    assert created["path"] == f"/join/{created['token']}"
    info = test_client.get(f"/v1/invites/{created['token']}")
    assert info.status_code == 200
    assert info.json() == {
        "orgId": "org_x",
        "orgName": "Atelier partagé",
        "expiresAt": created["expiresAt"],
    }

    assume_user(current_user, "member_b")
    accepted = test_client.post(f"/v1/invites/{created['token']}/accept")
    assert accepted.status_code == 200
    assert accepted.json() == {"orgId": "org_x"}
    assert calls[-2:] == [
        (
            "POST",
            "/organizations/org_x/memberships",
            {"user_id": "member_b", "role": "org:admin"},
        ),
        (
            "PATCH",
            "/users/member_b/metadata",
            {"public_metadata": {"stockflow_access": True}},
        ),
    ]


@pytest.mark.parametrize(
    ("clerk_user", "expected_status"),
    [
        ({"email_addresses": [{"email_address": "INVITER@example.com"}]}, 200),
        ({"public_metadata": {"stockflow_access": True}}, 200),
        ({"email_addresses": [{"email_address": "other@example.com"}]}, 403),
    ],
)
def test_invite_link_creation_requires_stockflow_access(
    client,
    monkeypatch,
    clerk_user,
    expected_status,
):
    test_client, current_user = client
    assume_user(current_user, "owner", "org_x")
    monkeypatch.setattr(main.settings, "poc_allowed_emails", " inviter@example.com, teammate@example.com ")

    async def fake_clerk_api(method, path, body=None):
        assert method == "GET"
        assert path == "/users/owner"
        return 200, clerk_user

    monkeypatch.setattr(main, "_clerk_api", fake_clerk_api)
    response = test_client.post("/v1/org/invite-links")
    assert response.status_code == expected_status
    if expected_status == 403:
        assert response.json()["detail"] == "Accès OctoHandy requis pour inviter"
    else:
        assert response.json()["token"].startswith("inv_")


def test_invite_link_clerk_lookup_errors_return_bad_gateway(client, monkeypatch):
    test_client, current_user = client
    assume_user(current_user, "owner", "org_x")

    async def fake_clerk_api(_method, _path, _body=None):
        return 500, {"errors": []}

    monkeypatch.setattr(main, "_clerk_api", fake_clerk_api)
    response = test_client.post("/v1/org/invite-links")
    assert response.status_code == 502


def test_invites_return_not_found_and_gone_for_unknown_or_expired_tokens(client):
    test_client, current_user = client
    assert test_client.get("/v1/invites/not-a-token").status_code == 404
    expired = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat().replace("+00:00", "Z")
    with db.connection() as conn:
        conn.execute(
            """INSERT INTO invite_links (token, org_id, created_by, created_at, expires_at)
               VALUES (?, ?, ?, ?, ?)""",
            ("inv_expired", "org_x", "owner", expired, expired),
        )
    assert test_client.get("/v1/invites/inv_expired").status_code == 410


def test_data_survives_recreating_the_app_client(app_state):
    app, current_user = app_state
    with TestClient(app) as first_client:
        result = first_client.post(
            "/v1/stock",
            json={"title": "Persistant", "qty": 2},
        ).json()["item"]

    with TestClient(app) as next_client:
        items = next_client.get("/v1/stock").json()["items"]
    assert any(item["id"] == result["id"] for item in items)
    assert current_user["workspace"] == "user:user_a"


@pytest.mark.parametrize(
    ("claims", "expected_workspace", "expected_org"),
    [
        ({"sub": "user_a", "o": {"id": "org_v2"}}, "org:org_v2", "org_v2"),
        ({"sub": "user_a", "org_id": "org_v1"}, "org:org_v1", "org_v1"),
        ({"sub": "user_a"}, "user:user_a", None),
    ],
)
def test_require_user_derives_workspace_from_clerk_claims(
    claims,
    expected_workspace,
    expected_org,
    monkeypatch,
):
    async def fake_jwks():
        return [{"kid": "test"}]

    token = main.jwt.encode({"sub": "unused"}, "secret", algorithm="HS256", headers={"kid": "test"})
    monkeypatch.setattr(main, "_jwks", fake_jwks)
    monkeypatch.setattr(main.jwk, "construct", lambda *_args: "test-key")
    monkeypatch.setattr(main.jwt, "decode", lambda *_args, **_kwargs: claims)
    user = asyncio.run(main.require_user(f"Bearer {token}"))
    assert user["workspace"] == expected_workspace
    assert user["org_id"] == expected_org


def _install_fake_hermes(monkeypatch, on_post=None):
    captured = {}

    class FakeResponse:
        status_code = 200

        @staticmethod
        def json():
            return {"choices": [{"message": {"content": "Réponse test"}, "finish_reason": "stop"}]}

    class FakeClient:
        def __init__(self, *_args, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, _url, headers, json):
            captured["messages"] = json["messages"]
            if on_post:
                on_post(json)
            return FakeResponse()

    async def empty_context(*_args):
        return ""

    monkeypatch.setattr(main.httpx, "AsyncClient", FakeClient)
    monkeypatch.setattr(main.settings, "hermes_api_key", "test-key")
    monkeypatch.setattr(main.settings, "nebius_api_key", "")
    monkeypatch.setattr(main, "_chat_context", empty_context)
    monkeypatch.setattr(main, "_screen_context", empty_context)
    return captured


def test_chat_with_other_workspace_lease_instructs_hermes_and_keeps_lease(client, monkeypatch):
    _test_client, current_user = client
    other_workspace = "org:team-b"
    lease_id, remaining = db.acquire_desktop_lease(other_workspace, "user_b", "vinted", 600)
    assert lease_id and remaining is None
    captured = _install_fake_hermes(monkeypatch)

    asyncio.run(main.chat(main.ChatIn(message="Vérifie mes annonces"), current_user))

    system = captured["messages"][0]["content"]
    assert "ne crée pas d'exécution" in system
    assert "environ" in system
    with db.connection() as conn:
        lease = conn.execute("SELECT lease_id FROM desktop_leases WHERE id=1").fetchone()
    assert lease["lease_id"] == lease_id
    assert db.desktop_lease_held(other_workspace)


def test_chat_temporarily_acquires_and_releases_lease(client, monkeypatch):
    _test_client, current_user = client
    observed = []

    def assert_lease_during_request(_payload):
        with db.connection() as conn:
            lease = conn.execute("SELECT lease_id FROM desktop_leases WHERE id=1").fetchone()
        observed.append(lease["lease_id"])
        assert db.desktop_lease_held(current_user["workspace"])

    _install_fake_hermes(monkeypatch, assert_lease_during_request)
    asyncio.run(main.chat(main.ChatIn(message="Aide-moi"), current_user))

    assert observed and observed[0]
    assert not db.desktop_lease_held(current_user["workspace"])


def test_chat_keeps_existing_teach_lease_and_id(client, monkeypatch):
    _test_client, current_user = client
    lease_id, _remaining = db.acquire_desktop_lease(
        current_user["workspace"], current_user["user_id"], "vinted", 3600
    )
    observed = []

    def assert_same_lease(_payload):
        with db.connection() as conn:
            lease = conn.execute("SELECT lease_id FROM desktop_leases WHERE id=1").fetchone()
        observed.append(lease["lease_id"])

    _install_fake_hermes(monkeypatch, assert_same_lease)
    asyncio.run(main.chat(main.ChatIn(message="Aide-moi"), current_user))

    assert observed == [lease_id]
    with db.connection() as conn:
        lease = conn.execute("SELECT lease_id FROM desktop_leases WHERE id=1").fetchone()
    assert lease["lease_id"] == lease_id


def test_run_log_is_blocked_by_other_workspace_lease_but_accepted_when_free(client):
    test_client, _current_user = client
    workflow_id = test_client.get("/v1/workflows").json()["workflows"][0]["id"]
    body = {"workflowId": workflow_id, "status": "done", "summary": "Fini"}
    db.acquire_desktop_lease("org:team-b", "user_b", "vinted", 600)

    blocked = test_client.post("/v1/workflows/runs/log", json=body)
    assert blocked.status_code == 409
    assert blocked.json()["detail"] == "Le bureau est utilisé par une autre équipe."

    with db.connection() as conn:
        conn.execute("UPDATE desktop_leases SET expires_at='2000-01-01T00:00:00Z' WHERE id=1")
    accepted = test_client.post("/v1/workflows/runs/log", json=body)
    assert accepted.status_code == 200


def test_desktop_lease_id_is_stable_and_expiry_never_shortens(client):
    test_client, current_user = client
    test_client.get("/v1/workflows")
    first_lease_id, _remaining = db.acquire_desktop_lease(
        current_user["workspace"], current_user["user_id"], "vinted", 3600
    )
    with db.connection() as conn:
        first_expiry = conn.execute("SELECT expires_at FROM desktop_leases WHERE id=1").fetchone()["expires_at"]

    second_lease_id, _remaining = db.acquire_desktop_lease(
        current_user["workspace"], current_user["user_id"], "vinted", 1
    )
    with db.connection() as conn:
        second_expiry = conn.execute("SELECT expires_at FROM desktop_leases WHERE id=1").fetchone()["expires_at"]
    assert second_lease_id == first_lease_id
    assert second_expiry >= first_expiry


def test_legacy_desktop_lease_migration_is_idempotent():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute(
        """CREATE TABLE desktop_leases (
            id INTEGER PRIMARY KEY, workspace TEXT NOT NULL, user_id TEXT NOT NULL,
            marketplace TEXT, acquired_at TEXT NOT NULL, expires_at TEXT NOT NULL
        )"""
    )
    conn.execute(
        "INSERT INTO desktop_leases VALUES (1, 'workspace-a', 'user-a', 'vinted', 'now', 'later')"
    )

    db.migrate_desktop_lease_id(conn)
    first_id = conn.execute("SELECT lease_id FROM desktop_leases WHERE id=1").fetchone()["lease_id"]
    db.migrate_desktop_lease_id(conn)
    second_id = conn.execute("SELECT lease_id FROM desktop_leases WHERE id=1").fetchone()["lease_id"]

    assert len(first_id) == 32
    assert second_id == first_id
    conn.close()
