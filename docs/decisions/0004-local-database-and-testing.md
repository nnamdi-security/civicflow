# 0004: Local database and integration testing

Status: Accepted

## Decision
Run PostgreSQL + PostGIS locally with Docker Compose (`postgis/postgis` image, non-default host port). Use two databases on that instance: `civicflow` for development and `civicflow_test` for integration tests. CI uses the same image as a service container. The first migration enables the `postgis` extension explicitly so the SQL is reviewed.

## Rationale
Spatial queries and routing depend on real PostGIS behaviour, so mocks and SQLite are not acceptable (see `docs/testing.md`). Docker gives every developer and CI the same database version with no host installation. A separate test database keeps destructive test setup away from development data.

## Consequences
Developers need Docker. Tests that touch the database fail fast with a clear message if it is not running. Production hosting must still provide PostGIS (ADR 0001). pg-boss will later use its own schema in the same database (ADR 0002).
