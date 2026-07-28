from __future__ import annotations

import os
import subprocess

import pytest
from _gateway import gateway_base_url, gpio_device_session, settle

from tooling.common.paths import REPO_ROOT

ANDROID_DIR = REPO_ROOT / "android"


def _android_available() -> bool:
    """The Android e2e needs the Gradle wrapper and a configured SDK (local.properties)."""
    if os.environ.get("HELIX_E2E_SKIP_ANDROID"):
        return False
    return (ANDROID_DIR / "gradlew").exists() and (ANDROID_DIR / "local.properties").exists()


@pytest.mark.skipif(not _android_available(), reason="Android SDK / gradlew not configured")
def test_android_mqtt_transport_round_trips(stack, provisioned_device) -> None:
    """The real Android :helix MQTT transport drives gpio-control through the WS->MQTT gateway and back (via its Gradle test)."""
    with gpio_device_session(stack, provisioned_device) as gpio:
        settle()
        env = {
            **os.environ,
            "HELIX_MQTT_GATEWAY_URL": gateway_base_url(stack),
            "HELIX_MQTT_DEVICE_ID": provisioned_device.device_id,
        }
        result = subprocess.run(
            [
                "./gradlew",
                ":helix:testDebugUnitTest",
                "--tests",
                "*MqttGatewayIntegrationTest",
                "--rerun-tasks",
                "--console=plain",
                f"-PmqttGatewayUrl={gateway_base_url(stack)}",
                f"-PmqttDeviceId={provisioned_device.device_id}",
            ],
            cwd=ANDROID_DIR,
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )
        assert result.returncode == 0, result.stdout + result.stderr

        # The Gradle test skips (exit 0) if it can't reach the gateway, so assert the
        # device actually saw the client's commands to prove a real round-trip.
        assert (2, 1) in gpio.set_commands, gpio.set_commands
        assert (2, 0) in gpio.set_commands, gpio.set_commands
        assert (17, 1) in gpio.set_commands, gpio.set_commands
