# SPDX-License-Identifier: AGPL-3.0-only
SHELL := /bin/bash

.PHONY: test unit build up down logs ssh shell clean

## test: run the whole experiment from a clean checkout
test:
	./scripts/e2e.sh

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

## ssh: log in as alice, answering the method prompt with "online"
ssh:
	docker compose exec -T ssh-client ssh-login alice@device \
		--answer 'method \[online/offline/persistent\]=online'

## shell: a root shell on the device, for poking at sssd/sshd/authd
shell:
	docker compose exec device bash

clean: down
