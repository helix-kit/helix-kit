from __future__ import annotations

import time
import urllib.error

import pytest
from _events import post_device_events

INGEST_TIMEOUT_SECONDS = 20


def _wait_for_count(stack, device_id: str, expected: int) -> int:
    deadline = time.monotonic() + INGEST_TIMEOUT_SECONDS
    count: int = stack.appliance.count_events(device_id)
    while count < expected and time.monotonic() < deadline:
        time.sleep(1)
        count = stack.appliance.count_events(device_id)
    return count


def test_http_events_are_ingested(stack, http_device) -> None:
    """Events POSTed over mTLS to /api/device/events land in device_event (cert CN is the identity)."""
    device_id = http_device.device_id
    assert stack.appliance.count_events(device_id) == 0

    response = post_device_events(
        stack,
        http_device,
        [
            {"msgId": "http-1", "type": "reading", "payload": {"temp": 21}},
            {"type": "heartbeat"},
        ],
    )
    assert response["accepted"] == 2
    assert response["deviceId"] == device_id
    msg_ids = {result["msgId"] for result in response["results"]}
    assert "http-1" in msg_ids
    assert all(result["status"] == "queued" for result in response["results"])

    assert _wait_for_count(stack, device_id, 2) == 2
    assert stack.appliance.has_event(device_id, "http-1")


def test_http_duplicate_message_ids_are_deduped(stack, http_device) -> None:
    """Re-POSTing a stored msgId is deduped by the (device_id, message_id) constraint; original kept."""
    device_id = http_device.device_id
    assert stack.appliance.has_event(device_id, "http-1")

    post_device_events(
        stack, http_device, [{"msgId": "http-1", "type": "reading", "payload": {"temp": 99}}]
    )
    time.sleep(3)
    assert stack.appliance.count_events(device_id) == 2

    payload = stack.appliance.psql(
        f"SELECT event_payload::text FROM device_event "
        f"WHERE device_id = '{device_id}' AND message_id = 'http-1'"
    ).stdout
    assert '"temp": 21' in payload


def test_http_event_rejects_mismatched_device_id(stack, http_device) -> None:
    """A body deviceId not matching the client certificate CN is rejected (403); nothing queued."""
    before = stack.appliance.count_events(http_device.device_id)
    with pytest.raises(urllib.error.HTTPError) as exc:
        post_device_events(stack, http_device, [{"type": "reading"}], body_device_id="someone-else")
    assert exc.value.code == 403
    time.sleep(2)
    assert stack.appliance.count_events(http_device.device_id) == before


def test_http_event_rejects_invalid_input(stack, http_device) -> None:
    """An event missing the required `type` fails input validation (400); nothing queued."""
    before = stack.appliance.count_events(http_device.device_id)
    with pytest.raises(urllib.error.HTTPError) as exc:
        post_device_events(stack, http_device, [{"payload": {"x": 1}}])
    assert exc.value.code == 400
    time.sleep(2)
    assert stack.appliance.count_events(http_device.device_id) == before
