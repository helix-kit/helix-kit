#!/usr/bin/env python3
"""Tiny TCP forwarder to reach the appliance's loopback-only Postgres.

The in-container Postgres listens on 127.0.0.1 with pg_hba allowing only
127.0.0.1/32 ("everything that talks to PG is in this container"). External
migration therefore needs a connection whose *source* is container-localhost.

Run this INSIDE the container (`docker exec -d helix-appliance python3 pg-forward.py`):
it listens on the container's bridge IP :5433 and proxies to 127.0.0.1:5432, so
the proxied connection reaches Postgres from 127.0.0.1 (allowed). Then tunnel to
it from your workstation:  ssh -L 15433:<container-ip>:5433 ubuntu@<host>
and point db:migrate at postgres://helix:<pw>@127.0.0.1:15433/helix.
"""

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
