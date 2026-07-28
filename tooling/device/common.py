from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from uuid import uuid4

import click


def load_json_option(value: str, path: Path | None, option_name: str) -> Any:
    if value and path is not None:
        raise click.ClickException(f"use only one of --{option_name}-json or --{option_name}-file")
    if path is not None:
        value = path.read_text(encoding="utf-8")
    if value == "":
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError as exc:
        raise click.ClickException(f"invalid JSON for {option_name}: {exc}") from exc


def create_packet(
    service: str, method: str, payload: Any, request_id: str | None = None
) -> dict[str, Any]:
    message: dict[str, Any] = {
        "service": service,
        "method": method,
    }
    if payload is not None:
        message["payload"] = payload
    return {
        "requestId": request_id or str(uuid4()),
        "message": message,
    }


def compact_json(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def echo_response(packet: dict[str, Any]) -> None:
    click.echo(json.dumps(packet, indent=2, sort_keys=True, ensure_ascii=False))


def validate_response_packet(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise click.ClickException("device returned a non-object Helix packet")
    message = value.get("message")
    if not isinstance(message, dict):
        raise click.ClickException("device returned a Helix packet without message object")
    service = message.get("service")
    method = message.get("method")
    if not isinstance(service, str) or not isinstance(method, str):
        raise click.ClickException("device returned a Helix packet without service/method")
    return value


def request_options(function: Any) -> Any:
    function = click.option(
        "--payload-file", type=click.Path(exists=True, dir_okay=False, path_type=Path)
    )(function)
    function = click.option("--payload-json", default="")(function)
    function = click.option("--method", required=True)(function)
    function = click.option("--service", required=True)(function)
    return function
