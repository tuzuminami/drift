# Changelog

All notable public changes to DRIFT are documented here.

## 0.2.0 - 2026-07-05

- Added a typed TypeScript SDK client for the public scenario/session API.
- Added a `drift smoke` CLI command for the primary local API flow.
- Added explicit auth adapter and scenario store ports for production-safe server wiring.
- Added PostgreSQL storage configuration for the executable server.
- Added a narrow Plugin SPI with explicit capability checks, version compatibility, and timeout failure behavior.
- Added structured safe HTTP request logging hooks.
- Added CI-ready PostgreSQL integration configuration.
- Added dependency license and package-boundary release checks.
- Added `.dockerignore`, `.npmignore`, and public issue templates for release hygiene.
- Removed Persona Contract compilation from the public API surface; DRIFT now only carries
  references to already-compiled public-safe artifacts.

## 0.1.0 - 2026-07-05

- Added scenario graph validation, version-pinned sessions, guarded transitions, context packs, and replay support.
- Added HTTP contract boundary, OpenAPI, JSON Schemas, and public package boundary checks.
- Added PostgreSQL schema, migration runner, and transactional scenario store.
- Released under Apache License 2.0.
