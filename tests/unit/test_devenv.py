"""Unit tests for the appliance dev-env `.env` writer (no container needed)."""

from __future__ import annotations

from pathlib import Path

from tooling.appliance.devenv import AppEnvPlan, write_env


def _plan(path: Path, *, database_url: str = "postgres://new") -> AppEnvPlan:
    return AppEnvPlan(
        name="helix",
        path=path,
        managed={"DATABASE_URL": database_url, "BETTER_AUTH_SECRET": "secret"},
        defaults={"SMTP_SERVER": "", "EMAIL_LOG_CONTENT": "true"},
    )


def test_creates_file_when_missing(tmp_path: Path) -> None:
    plan = _plan(tmp_path / "helix" / ".env")
    action = write_env(plan, fresh=False)
    assert action == "created"
    body = plan.path.read_text()
    assert "DATABASE_URL=postgres://new" in body
    assert "EMAIL_LOG_CONTENT=true" in body


def test_restart_syncs_managed_but_preserves_user_edits(tmp_path: Path) -> None:
    path = tmp_path / "helix" / ".env"
    write_env(_plan(path), fresh=False)

    # A developer tweaks a seeded default and adds their own key.
    edited = path.read_text().replace("SMTP_SERVER=", "SMTP_SERVER=smtp://mine:25")
    path.write_text(edited + "\nMY_CUSTOM=keepme\n")

    # A restart resyncs only the managed keys.
    action = write_env(_plan(path, database_url="postgres://CHANGED"), fresh=False)
    assert action == "synced"
    body = path.read_text()
    assert "DATABASE_URL=postgres://CHANGED" in body  # managed → updated
    assert "SMTP_SERVER=smtp://mine:25" in body  # user edit → preserved
    assert "MY_CUSTOM=keepme" in body  # user key → preserved


def test_fresh_backs_up_and_regenerates(tmp_path: Path) -> None:
    path = tmp_path / "helix" / ".env"
    write_env(_plan(path), fresh=False)
    path.write_text(path.read_text() + "\nMY_CUSTOM=keepme\n")

    action = write_env(_plan(path, database_url="postgres://CHANGED"), fresh=True)
    assert action.startswith("recreated")

    backup = path.with_name(".env.bak")
    assert backup.exists()
    assert "MY_CUSTOM=keepme" in backup.read_text()  # old content saved

    regenerated = path.read_text()
    assert "MY_CUSTOM" not in regenerated  # clean template
    assert "DATABASE_URL=postgres://CHANGED" in regenerated
