# SPDX-License-Identifier: AGPL-3.0-only
SHELL := /bin/bash

.PHONY: test unit auth-test cloud cloud-down build up down logs ssh shell clean

## test: prove the PAM boundary from a clean checkout (no cloud needed)
test:
	./scripts/e2e.sh

## cloud: start a real Helix cloud on the host, seeded with a user and a device
cloud:
	./scripts/cloud-up.sh

## cloud-down: stop the lab cloud and its database
cloud-down:
	./scripts/cloud-down.sh

## auth-test: exercise all three real authentication methods (needs `make cloud`)
auth-test:
	./scripts/auth-e2e.sh

## unit: Go unit tests for the protocol and the authentication daemon
unit:
	cd ../../linux/device/go && go test ./internal/authproto/... ./internal/authd/...

## build: build every image
build:
	docker compose build

## up: start the stack in the background
up:
	docker compose up -d --build

## down: stop the stack and remove its volumes
down:
	docker compose down -v --remove-orphans

## logs: follow logs for all services
logs:
	docker compose logs -f

## ssh: an interactive login as alice -- pick a method and follow the prompts
ssh:
	docker compose exec ssh-client ssh alice@device

## ssh-online / ssh-offline / ssh-persistent: drive one method end to end
ssh-online:
	docker compose exec -T ssh-client auth-flow online

ssh-offline:
	docker compose exec -T ssh-client auth-flow offline

ssh-persistent:
	docker compose exec -T ssh-client auth-flow persistent-enroll --credential-out /tmp/cred
	docker compose exec -T ssh-client auth-flow persistent-use --credential-file /tmp/cred

## shell: a root shell on the device, for poking at sssd/sshd/authd
shell:
	docker compose exec device bash

clean: down cloud-down
