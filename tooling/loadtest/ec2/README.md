<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# Remote appliance load testing on EC2 — runbook

Reproducible setup for load-testing an already-running Helix appliance on a
separate cloud box, with real TLS, from an in-region load generator. Results and
analysis live in `docs/13-Appliance-EC2-Load-Testing.md`. The reusable drivers
are in the parent dir (`remote_harness.py`, `provision_remote.py`,
`sample_remote.py`); this folder holds the orchestrator + config templates +
this runbook.

Two boxes, both free-tier-eligible shapes (this account is capped to
`t3.micro/small`, `t4g.micro/small`, `c7i-flex.large`, `m7i-flex.large`):

- **AUT** — appliance under test, `t3.small` (2 vCPU / 2 GB), no memory cap.
- **GEN** — load generator, `m7i-flex.large` (2 vCPU / 8 GB), same AZ. Hits the
  AUT's **private** IP.

Ports the AUT exposes: `443` (Caddy HTTPS API), `4001` (device mTLS ingest +
file transfer), `8883/8884` (mosquitto MQTT). `3000/4000/5432` stay on loopback.

## 0. Provision (AWS CLI, profile `admin`, region ap-south-1)

```sh
# reuse the existing key + AMI + subnet from the live box; create a temp SG
SG=$(aws --profile admin ec2 create-security-group --group-name helix-loadtest-sg \
  --description 'temp' --vpc-id <vpc> --query GroupId --output text)
aws --profile admin ec2 authorize-security-group-ingress --group-id $SG --ip-permissions \
  "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=<your-ip>/32}]" \
  "IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=<your-ip>/32}]" \
  "IpProtocol=tcp,FromPort=4001,ToPort=4001,IpRanges=[{CidrIp=<your-ip>/32}]" \
  "IpProtocol=tcp,FromPort=8883,ToPort=8884,IpRanges=[{CidrIp=<your-ip>/32}]"
# self-referencing rule so GEN <-> AUT can talk on all ports over the private IP
aws --profile admin ec2 authorize-security-group-ingress --group-id $SG \
  --ip-permissions "IpProtocol=-1,UserIdGroupPairs=[{GroupId=$SG}]"
# launch AUT (30GB root) + GEN (20GB root), tag helix-loadtest=true
aws --profile admin ec2 run-instances --image-id <ami> --instance-type t3.small ...
aws --profile admin ec2 run-instances --image-id <ami> --instance-type m7i-flex.large ...
```

Gotcha: a dynamic home IP can drift mid-session and lock you out of SSH — widen
the SG to your ISP `/23` if that happens.

## 1. Build the appliance image locally and ship it (build-not-pull)

The launch script now supports DBOS in-container (see fix A). Build fresh so that
change + current bundles are baked in:

```sh
uv run helix appliance bundles     # Next app + helix-server zips
uv run helix appliance build       # -> helix-appliance:e2e (~1.8 GB, ~424 MB gz)
docker save helix-appliance:e2e | gzip -1 > /tmp/helix-appliance.tar.gz
scp /tmp/helix-appliance.tar.gz ubuntu@<AUT>:                # ~424 MB
scp cloud/appliance/bundles/*.zip ubuntu@<AUT>:helix-appliance/bundles/
ssh ubuntu@<AUT> 'sudo apt-get install -y docker.io && sudo docker load -i helix-appliance.tar.gz'
```

## 2. Configure + run the container on the AUT

Put `site.env` (from `site.env.example`, domain = `<dashed-public-ip>.nip.io`) and
`Caddyfile` (from `Caddyfile.internal`) under `~/helix-appliance/`, then:

```sh
sudo docker run -d --name helix-appliance --privileged --cgroupns=private \
  --tmpfs /run --tmpfs /run/lock --tmpfs /tmp --stop-signal SIGRTMIN+3 \
  -v helix-appliance-data:/var/lib/helix \
  -v ~/helix-appliance/bundles:/opt/helix/bundles \
  -v ~/helix-appliance/site.env:/etc/helix/site.env:ro \
  -v ~/helix-appliance/Caddyfile:/etc/helix/Caddyfile:ro \
  -p 0.0.0.0:443:443 -p 0.0.0.0:4001:4001 -p 0.0.0.0:8883:8883 -p 0.0.0.0:8884:8884 \
  -p 127.0.0.1:3000:3000 -p 127.0.0.1:4000:4000 -p 127.0.0.1:5432:5432 \
  helix-appliance:e2e
```

First boot (~2 min) runs seed-env → PKI → Postgres initdb → bundles → bootstrap →
app/helix-server/caddy. Check `systemctl --failed` (only `systemd-modules-load` is
expected to fail in a container).

## 3. Fixes / steps the tooling normally hides

**A. DBOS inside the shipped container.** DBOS was only wired for HOST-mode dev.
Fix lives in `cloud/appliance/bin/helix-server-launch.sh`: when
`HELIX_WORKFLOW_MODE=dbos` it defaults `DBOS_SYSTEM_DATABASE_URL` from
`DATABASE_URL`, sets `HELIX_DBOS_SCHEMA`, and runs the one-time system-schema
migration before launch. Also set `HELIX_SERVER_ROLES=...,dispatch` in `site.env`
(default roles omit `dispatch`, so a stock appliance runs no workflows).

**B. App migrations (external) via a loopback-only Postgres.** No `helix-cloud-init`
bundle is built, so drizzle migrations are applied externally — but the container
Postgres listens on `127.0.0.1` with `pg_hba` allowing only `127.0.0.1/32`, so a
docker-proxy/tunnel connection is refused. Run the forwarder from `pg-forward.py`
inside the container and tunnel to it:

```sh
CIP=$(ssh ubuntu@<AUT> "sudo docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' helix-appliance")
scp pg-forward.py ubuntu@<AUT>: && ssh ubuntu@<AUT> 'sudo docker cp pg-forward.py helix-appliance:/tmp/ && sudo docker exec -d helix-appliance python3 /tmp/pg-forward.py'
ssh -fN -L 15433:$CIP:5433 ubuntu@<AUT>
PW=$(ssh ubuntu@<AUT> 'sudo docker exec helix-appliance sed -n "s/^POSTGRES_PASSWORD=//p" /var/lib/helix/env/secrets.env')
cd web && SKIP_ENV_VALIDATION=true DATABASE_URL="postgres://helix:$PW@127.0.0.1:15433/helix" \
  pnpm --filter helix db:migrate && pnpm --filter helix db:seed-features
```

**C. Load-test measurement table.** `workflow_run_result` (the notify node's target)
is not in the product schema; without it every workflow errors at the final step.
Create it once (DDL: see `tooling/loadtest/commands.py`), via in-container psql:
`truncate`/`select` against `"$DATABASE_URL"`.

**D. Sysadmin.** No seed CLI ships. Sign up via better-auth, then promote:

```sh
curl -sk --resolve <domain>:443:127.0.0.1 -X POST https://<domain>/api/auth/sign-up/email \
  -H 'Content-Type: application/json' -H 'Origin: https://<domain>' \
  -d '{"email":"admin@helix.test","password":"...","name":"Administrator"}'
# then, in-container psql:
#   update "user" set role='sysadmin', email_verified=true where email='admin@helix.test';
```

**E. Device certs for MQTT/HTTPS ingest.** `/api/certificates/device` lives on
helix-server's public HTTP (`:4000`, plain HTTP), NOT behind Caddy (Caddy only
proxies a fixed path list to helix-server). Tunnel to 4000 and provision:

```sh
ssh -fN -L 14000:127.0.0.1:4000 ubuntu@<AUT>
python3 tooling/loadtest/provision_remote.py --ssh-host ubuntu@<AUT> --pem "$PEM" \
  --issuer-url http://127.0.0.1:14000 --count 50 --out /tmp/helix-certs
```

**F. TLS SNI / origin.** Caddy's internal cert is for the nip.io hostname. From the
GEN box, add `/etc/hosts`: `<AUT-private-ip> <domain>` so the API driver connects
by hostname (SNI + Host + better-auth origin all match) while reaching the private
IP. MQTT/mTLS ingest connect to the private IP directly with hostname-check off.

## 4. Set up GEN and run tests

```sh
scp tooling/loadtest/remote_harness.py /tmp/helix-certs.tgz ubuntu@<GEN>:
ssh ubuntu@<GEN> 'python3 -m venv ~/lt-venv && ~/lt-venv/bin/pip install paho-mqtt && \
  tar xzf helix-certs.tgz && echo "<AUT-priv> <domain>" | sudo tee -a /etc/hosts'

export AUT=ubuntu@<AUT> GEN=ubuntu@<GEN>
./run_remote_test.sh mqtt-500       25 mqtt  --host <AUT-priv> --port 8883 --certs '~/helix-certs' --rate 500 --duration 25 --workers 10 --devices 50
./run_remote_test.sh https-250      30 https --host <AUT-priv> --port 4001 --certs '~/helix-certs' --rate 250 --duration 30 --workers 20 --devices 50 --batch 5
./run_remote_test.sh api-c20        25 api   --sni <domain> --email admin@helix.test --password '...' --duration 25 --concurrency 20 --write-ratio 0.2
./run_remote_test.sh combined       60 combined --mqtt-host <AUT-priv> --sni <domain> --certs '~/helix-certs' \
     --email admin@helix.test --password '...' --duration 60 --mqtt-rate 120 --https-rate 100 --batch 5 --api-concurrency 10
```

Note: DBOS workflows top out ~250/s on 2 vCPU; ingesting faster builds a redpanda
backlog that inflates memory. Between over-ceiling tests, drain (poll
`rpk group describe helix-workflow-dispatch` until lag 0) for clean numbers. The
paho generator drops queued messages on disconnect at very high rates, so measure
appliance ingest by `device_event` delta, not the client's emit count.

## 5. Teardown (stop billing)

```sh
aws --profile admin ec2 terminate-instances --instance-ids <AUT-id> <GEN-id>
aws --profile admin ec2 wait instance-terminated --instance-ids <AUT-id> <GEN-id>
aws --profile admin ec2 delete-security-group --group-id <sg-id>
```

Root volumes are `DeleteOnTermination` by default. **Do not** touch the live
`Helix Server` box.
