"""Synthetic ESP32 release simulators + a thin HTTP client for the release API."""

from __future__ import annotations

import hashlib
import json
import secrets
import urllib.request
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

JsonDict = dict[str, Any]

ESP32_ROLES: tuple[tuple[str, str], ...] = (
    ("bootloader", "0x1000"),
    ("partition-table", "0x8000"),
    ("ota-data", "0xd000"),
    ("app", "0x10000"),
)

_SYNTH_REPEAT = 64

ESP32_TYPE_SEED_SQL = (
    "INSERT INTO artifact_type (key, display_name, distribution_mode, selector_keys, roles, "
    "adapter_key, status) VALUES ('esp32-firmware', 'ESP32 Firmware', 'blob', "
    """'[{"key":"chip","required":true},{"key":"flashSize","required":true},"""
    """{"key":"featureSet","required":false,"rankWeight":1}]'::jsonb, """
    """'[{"name":"bootloader","required":true,"storage":"blob","hasOffset":true},"""
    """{"name":"partition-table","required":true,"storage":"blob","hasOffset":true},"""
    """{"name":"ota-data","required":true,"storage":"blob","hasOffset":true},"""
    """{"name":"app","required":true,"storage":"blob","hasOffset":true}]'::jsonb, """
    "'esp32-firmware', 'active') ON CONFLICT (key) DO NOTHING"
)

LINUX_PACKAGE_TYPE_SEED_SQL = (
    "INSERT INTO artifact_type (key, display_name, distribution_mode, selector_keys, roles, "
    "adapter_key, status) VALUES ('helix-linux-package', 'Helix Linux Package', 'blob', "
    """'[{"key":"arch","required":true},"""
    """{"key":"distro","required":false,"rankWeight":1}]'::jsonb, """
    """'[{"name":"pkg","required":true,"storage":"blob","hasOffset":false}]'::jsonb, """
    "'helix-linux-package', 'active') ON CONFLICT (key) DO NOTHING"
)


@dataclass(frozen=True)
class SynthArtifact:
    role: str
    offset: str
    data: bytes
    sha256: str
    size_bytes: int


def synth_esp32_artifacts(config: JsonDict) -> list[SynthArtifact]:
    """Deterministic synthetic firmware artifacts for a build config."""
    artifacts: list[SynthArtifact] = []
    for role, offset in ESP32_ROLES:
        seed = (
            json.dumps({"role": role, "config": config}, sort_keys=True)
            if role == "app"
            else role  # invariant across configs -> content-addressed dedupe
        )
        data = seed.encode() * _SYNTH_REPEAT
        artifacts.append(
            SynthArtifact(
                role=role,
                offset=offset,
                data=data,
                sha256=hashlib.sha256(data).hexdigest(),
                size_bytes=len(data),
            )
        )
    return artifacts


def make_ci_token_sql() -> tuple[str, str]:
    """Return (secret, INSERT SQL) for a scoped CI token; only the hash persists."""
    secret = f"cit_{secrets.token_hex(24)}"
    prefix = secret[:12]
    token_hash = hashlib.sha256(secret.encode()).hexdigest()
    token_id = f"cit_{secrets.token_hex(16)}"
    scopes = '{"typeKeys":["*"],"names":["*"],"canPublish":true}'
    sql = (
        "INSERT INTO ci_token (id, name, token_prefix, token_hash, scopes) VALUES "
        f"('{token_id}', 'sim', '{prefix}', '{token_hash}', '{scopes}'::jsonb)"
    )
    return secret, sql


def seed_profile_for_device_sql(
    device_id: str,
    type_key: str,
    release_name: str,
    channel: str,
    selector: JsonDict,
) -> list[str]:
    """SQL to create a profile+track (following a channel head) and assign it to a device."""
    profile_id = f"prof_{secrets.token_hex(12)}"
    track_id = f"ptrk_{secrets.token_hex(12)}"
    selector_json = json.dumps(selector)
    return [
        f"INSERT INTO profile (id, name) VALUES ('{profile_id}', 'sim-profile')",
        (
            "INSERT INTO profile_track (id, profile_id, type_key, release_name, channel, selector, "
            f"auto_update) VALUES ('{track_id}', '{profile_id}', '{type_key}', '{release_name}', "
            f"'{channel}', '{selector_json}'::jsonb, true)"
        ),
        (
            "INSERT INTO device_profile (device_id, profile_id) VALUES "
            f"('{device_id}', '{profile_id}')"
        ),
    ]


class ReleaseClient:
    """HTTP client for the release/build/OTA API on the public helix-server plane."""

    def __init__(self, base_url: str, ci_token: str | None = None) -> None:
        self.base_url = base_url.rstrip("/")
        self.ci_token = ci_token

    def _abs(self, url: str) -> str:
        parts = urlsplit(url)
        path = parts.path + (f"?{parts.query}" if parts.query else "")
        return f"{self.base_url}{path}"

    def _post(self, path: str, body: JsonDict, token: str | None = None) -> JsonDict:
        headers = {"content-type": "application/json"}
        bearer = token if token is not None else self.ci_token
        if bearer is not None:
            headers["authorization"] = f"Bearer {bearer}"
        request = urllib.request.Request(
            f"{self.base_url}{path}", data=json.dumps(body).encode(), method="POST", headers=headers
        )
        with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
            payload = json.loads(response.read())
        assert isinstance(payload, dict)
        return payload

    def _put_blob(self, signed: JsonDict, data: bytes) -> None:
        request = urllib.request.Request(
            self._abs(signed["url"]), data=data, method="PUT", headers=signed.get("headers", {})
        )
        with urllib.request.urlopen(request, timeout=30):  # noqa: S310
            pass

    def get(self, url: str) -> bytes:
        with urllib.request.urlopen(self._abs(url), timeout=30) as response:  # noqa: S310
            data: bytes = response.read()
        return data

    def request_build(
        self, config: JsonDict, owner_user_id: str, selector: JsonDict | None = None
    ) -> JsonDict:
        return self._post(
            "/api/builds/request",
            {
                "typeKey": "esp32-firmware",
                "ownerUserId": owner_user_id,
                "config": config,
                "selector": selector or {},
            },
        )

    def upload_build_blob(
        self, build_id: str, token: str, sha256: str, size: int, data: bytes
    ) -> None:
        signed = self._post(
            "/api/build/artifact-url",
            {
                "buildId": build_id,
                "sha256": sha256,
                "size": size,
                "contentType": "application/octet-stream",
            },
            token=token,
        )
        if not signed["exists"]:
            self._put_blob(signed, data)

    def build_complete(
        self,
        build_id: str,
        token: str,
        release: JsonDict,
        *,
        analysis: Any = None,
        duration_ms: int | None = None,
    ) -> JsonDict:
        body: JsonDict = {"buildId": build_id, "status": "success", "release": release}
        if analysis is not None:
            body["analysis"] = analysis
        if duration_ms is not None:
            body["durationMs"] = duration_ms
        return self._post("/api/build/complete", body, token=token)

    def build_failed(self, build_id: str, token: str, error_summary: str) -> JsonDict:
        return self._post(
            "/api/build/complete",
            {"buildId": build_id, "status": "failed", "errorSummary": error_summary[-2000:]},
            token=token,
        )

    def ci_upload_artifacts(self, artifacts: list[JsonDict]) -> None:
        """Presign + PUT each unique (by sha256) artifact via the CI upload endpoint."""
        seen: set[str] = set()
        for artifact in artifacts:
            if artifact["sha256"] in seen:
                continue
            seen.add(artifact["sha256"])
            signed = self._post(
                "/api/ci/artifacts/upload-url",
                {
                    "typeKey": "esp32-firmware",
                    "sha256": artifact["sha256"],
                    "size": artifact["sizeBytes"],
                    "contentType": "application/octet-stream",
                },
            )
            if not signed["exists"]:
                self._put_blob(signed, artifact["data"])

    def ci_publish(
        self,
        *,
        name: str,
        version: str,
        channel: str,
        config: JsonDict,
        variants: list[JsonDict],
    ) -> JsonDict:
        """Upload all variants' real artifact bytes, then register + publish a multi-variant release."""
        self.ci_upload_artifacts([a for variant in variants for a in variant["artifacts"]])
        return self._post(
            "/api/ci/releases",
            {
                "typeKey": "esp32-firmware",
                "name": name,
                "version": version,
                "channel": channel,
                "publish": True,
                "config": config,
                "variants": [
                    {
                        "selector": variant["selector"],
                        "artifacts": [
                            {
                                "role": a["role"],
                                "offset": a["offset"],
                                "sha256": a["sha256"],
                                "sizeBytes": a["sizeBytes"],
                            }
                            for a in variant["artifacts"]
                        ],
                    }
                    for variant in variants
                ],
            },
        )

    def sim_ci_esp32(
        self,
        *,
        name: str,
        version: str,
        channel: str,
        selector: JsonDict,
        config: JsonDict,
    ) -> JsonDict:
        """Simulate a CI build: upload synthetic artifacts + register the release."""
        artifacts = synth_esp32_artifacts(config)
        for artifact in artifacts:
            signed = self._post(
                "/api/ci/artifacts/upload-url",
                {
                    "typeKey": "esp32-firmware",
                    "sha256": artifact.sha256,
                    "size": artifact.size_bytes,
                    "contentType": "application/octet-stream",
                },
            )
            if not signed["exists"]:
                self._put_blob(signed, artifact.data)
        return self._post(
            "/api/ci/releases",
            {
                "typeKey": "esp32-firmware",
                "name": name,
                "version": version,
                "channel": channel,
                "publish": True,
                "config": config,
                "variants": [
                    {
                        "selector": selector,
                        "artifacts": [
                            {
                                "role": a.role,
                                "offset": a.offset,
                                "sha256": a.sha256,
                                "sizeBytes": a.size_bytes,
                            }
                            for a in artifacts
                        ],
                    }
                ],
            },
        )

    def sim_custom_build(
        self,
        *,
        name: str,
        version: str,
        channel: str,
        selector: JsonDict,
        config: JsonDict,
        owner_user_id: str,
    ) -> JsonDict:
        request = self._post(
            "/api/builds/request",
            {
                "typeKey": "esp32-firmware",
                "ownerUserId": owner_user_id,
                "config": config,
                "selector": selector,
            },
        )
        if request["status"] == "hit":
            return request

        build_id = request["buildId"]
        callback = request["callbackToken"]
        artifacts = synth_esp32_artifacts(config)
        for artifact in artifacts:
            signed = self._post(
                "/api/build/artifact-url",
                {
                    "buildId": build_id,
                    "sha256": artifact.sha256,
                    "size": artifact.size_bytes,
                    "contentType": "application/octet-stream",
                },
                token=callback,
            )
            if not signed["exists"]:
                self._put_blob(signed, artifact.data)
        self._post(
            "/api/build/complete",
            {
                "buildId": build_id,
                "status": "success",
                "release": {
                    "typeKey": "esp32-firmware",
                    "name": name,
                    "version": version,
                    "channel": channel,
                    "publish": True,
                    "config": config,
                    "variants": [
                        {
                            "selector": selector,
                            "artifacts": [
                                {
                                    "role": a.role,
                                    "offset": a.offset,
                                    "sha256": a.sha256,
                                    "sizeBytes": a.size_bytes,
                                }
                                for a in artifacts
                            ],
                        }
                    ],
                },
            },
            token=callback,
        )
        return {"status": "built", "buildId": build_id}

    def trigger_ota(self, device_id: str) -> JsonDict:
        return self._post("/api/ota/trigger", {"deviceId": device_id})
