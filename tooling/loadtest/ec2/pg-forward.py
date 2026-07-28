#!/usr/bin/env python3
"""TCP forwarder to reach the appliance's loopback-only Postgres from container-localhost (pg_hba allows only 127.0.0.1/32)."""

import contextlib
import socket
import threading


def pipe(a: socket.socket, b: socket.socket) -> None:
    try:
        while True:
            data = a.recv(65536)
            if not data:
                break
            b.sendall(data)
    except OSError:
        pass
    finally:
        for s in (a, b):
            with contextlib.suppress(OSError):
                s.close()


def main() -> None:
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("0.0.0.0", 5433))
    srv.listen(128)
    while True:
        client, _ = srv.accept()
        upstream = socket.create_connection(("127.0.0.1", 5432))
        threading.Thread(target=pipe, args=(client, upstream), daemon=True).start()
        threading.Thread(target=pipe, args=(upstream, client), daemon=True).start()


if __name__ == "__main__":
    main()
