from __future__ import annotations

from _events import publish_event, wait_for_message

RECOVERY_TIMEOUT_SECONDS = 60


def test_gateway_restart_redelivers_offline_events(stack, provisioned_device) -> None:
    """helix-server restart: events published while it is down are queued by the
    persistent MQTT session and redelivered + ingested on restart."""
    device = provisioned_device
    publish_event(stack, device, "res-gw-online", {"n": 1})
    assert wait_for_message(stack.appliance, device.device_id, "res-gw-online")

    stack.server.stop()
    publish_event(stack, device, "res-gw-offline", {"n": 2})
    stack.server.start()

    assert wait_for_message(
        stack.appliance, device.device_id, "res-gw-offline", timeout=RECOVERY_TIMEOUT_SECONDS
    )


def test_broker_restart_resumes_ingestion(stack, provisioned_device) -> None:
    """mosquitto restart: the ingestion client reconnects and new events still
    flow to the database."""
    device = provisioned_device
    stack.appliance.restart_service("mosquitto")

    publish_event(stack, device, "res-broker", {"n": 3})
    assert wait_for_message(
        stack.appliance, device.device_id, "res-broker", timeout=RECOVERY_TIMEOUT_SECONDS
    )


def test_kafka_restart_resumes_ingestion(stack, provisioned_device) -> None:
    """redpanda restart: the producer reconnects and the writer's consumer
    recovers, so new events are ingested again."""
    device = provisioned_device
    stack.appliance.restart_service("redpanda")

    publish_event(stack, device, "res-kafka", {"n": 4})
    assert wait_for_message(
        stack.appliance, device.device_id, "res-kafka", timeout=RECOVERY_TIMEOUT_SECONDS
    )
