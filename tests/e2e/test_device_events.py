from __future__ import annotations

import time

from _events import publish_event, wait_for_message

INGEST_TIMEOUT_SECONDS = 20


def _wait_for_count(stack, device_id: str, expected: int) -> int:
    deadline = time.monotonic() + INGEST_TIMEOUT_SECONDS
    count: int = stack.appliance.count_events(device_id)
    while count < expected and time.monotonic() < deadline:
        time.sleep(1)
        count = stack.appliance.count_events(device_id)
    return count


def test_device_events_are_ingested(stack, provisioned_device) -> None:
    device_id = provisioned_device.device_id
    assert stack.appliance.count_events(device_id) == 0

    publish_event(stack, provisioned_device, "evt-a", {"temp": 21})
    publish_event(stack, provisioned_device, "evt-b", {"temp": 22})

    assert _wait_for_count(stack, device_id, 2) == 2


def test_duplicate_message_ids_are_deduped(stack, provisioned_device) -> None:
    device_id = provisioned_device.device_id
    assert wait_for_message(stack.appliance, device_id, "evt-a")

    # Re-publish evt-a with a different payload; the dedupe constraint keeps the original.
    publish_event(stack, provisioned_device, "evt-a", {"temp": 99})
    time.sleep(3)
    assert stack.appliance.count_events(device_id) == 2

    payload = stack.appliance.psql(
        f"SELECT event_payload::text FROM device_event "
        f"WHERE device_id = '{device_id}' AND message_id = 'evt-a'"
    ).stdout
    assert '"temp": 21' in payload
