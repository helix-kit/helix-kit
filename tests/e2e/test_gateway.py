from __future__ import annotations

import pytest
import websocket
from _gateway import connect_ws, device_session, settle, ws_recv, ws_send


def test_command_routes_to_device_and_response_returns(stack, provisioned_device) -> None:
    """A WS client's command reaches the device on /in, and the device's
    response on /out is routed back to that client by requestId."""
    with device_session(stack, provisioned_device) as device:
        ws = connect_ws(stack, provisioned_device.device_id)
        settle()
        try:
            ws_send(
                ws, {"service": "gpio", "method": "read", "payload": {"pin": 2}}, request_id="r1"
            )
            command = device.wait_command()
            assert command["requestId"] == "r1"
            assert command["message"]["method"] == "read"

            device.publish_out(
                {"service": "gpio", "method": "result", "payload": {"value": 1}}, request_id="r1"
            )
            response = ws_recv(ws)
            assert response["requestId"] == "r1"
            assert response["message"]["payload"]["value"] == 1
        finally:
            ws.close()


def test_response_routes_only_to_the_requesting_client(stack, provisioned_device) -> None:
    """With two clients on one device, a requestId response goes only to the
    client that issued that request."""
    with device_session(stack, provisioned_device) as device:
        owner = connect_ws(stack, provisioned_device.device_id)
        other = connect_ws(stack, provisioned_device.device_id, timeout=2)
        settle()
        try:
            ws_send(owner, {"service": "s", "method": "m"}, request_id="req-owner")
            device.wait_command()
            device.publish_out({"service": "s", "method": "result"}, request_id="req-owner")

            assert ws_recv(owner)["requestId"] == "req-owner"
            with pytest.raises(websocket.WebSocketTimeoutException):
                other.recv()
        finally:
            owner.close()
            other.close()


def test_device_broadcast_reaches_all_clients(stack, provisioned_device) -> None:
    """A device message with no requestId is broadcast to every client on that
    device."""
    with device_session(stack, provisioned_device) as device:
        client_a = connect_ws(stack, provisioned_device.device_id)
        client_b = connect_ws(stack, provisioned_device.device_id)
        settle()
        try:
            device.publish_out({"service": "telemetry", "method": "tick"})
            assert ws_recv(client_a)["message"]["method"] == "tick"
            assert ws_recv(client_b)["message"]["method"] == "tick"
        finally:
            client_a.close()
            client_b.close()


def test_client_disconnect_is_cleaned_up(stack, provisioned_device) -> None:
    """When one client disconnects, the remaining client keeps receiving; the
    router drops the gone client without erroring."""
    with device_session(stack, provisioned_device) as device:
        leaving = connect_ws(stack, provisioned_device.device_id)
        staying = connect_ws(stack, provisioned_device.device_id)
        settle()
        leaving.close()
        settle()
        try:
            device.publish_out({"service": "telemetry", "method": "tick"})
            assert ws_recv(staying)["message"]["method"] == "tick"
        finally:
            staying.close()


def test_connection_without_device_id_is_rejected(stack) -> None:
    """The gateway closes a WS connection that carries no device identity
    (parseConnection throws -> policy-violation close). Depending on the client
    version that surfaces as an empty recv or a WebSocketException; either way
    the socket must end up closed with no application data delivered."""
    url = f"ws://127.0.0.1:{stack.appliance.config.public_http_port}/ws"
    ws = websocket.create_connection(url, timeout=3)
    try:
        try:
            data = ws.recv()
        except websocket.WebSocketException:
            data = ""
        assert data == ""
        assert not ws.connected
    finally:
        ws.close()
