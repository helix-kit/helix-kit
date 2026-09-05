# SPDX-License-Identifier: AGPL-3.0-only
SHELL := /bin/bash

.PHONY: test unit build up down logs psql ldapsearch getent clean

## test: run the whole experiment from a clean checkout (Go tests + containers + e2e)
test:
	./scripts/e2e.sh

## unit: Go unit + in-process LDAP integration tests only
unit:
	go test ./...

## build: build all three images
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

## psql: open a psql shell on the identity database
psql:
	docker compose exec postgres psql -U helix -d helix

## ldapsearch: query the facade directly as the service account
ldapsearch:
	docker compose exec sssd-client ldapsearch -x -LLL \
		-H ldap://helix-ldap:3389 \
		-D 'cn=sssd,dc=helix,dc=local' -w 'dev-only-password' \
		-b 'ou=People,dc=helix,dc=local' '(objectClass=posixAccount)'

## getent: resolve the seeded users through NSS
getent:
	docker compose exec sssd-client getent passwd alice
	docker compose exec sssd-client id alice

clean: down
