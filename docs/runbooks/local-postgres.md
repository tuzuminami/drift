# Local PostgreSQL Runbook

Start the local database:

```bash
docker compose up -d postgres
```

Apply the initial schema manually while the project is pre-1.0:

```bash
DATABASE_URL=postgresql://drift:drift_dev_password@localhost:5432/drift pnpm run db:migrate
```

The migration runner records applied files in `schema_migrations` with a SHA-256 checksum. If an
already-applied migration file changes, the runner fails closed instead of applying a drifted schema.
The API readiness path also checks for the expected migrated session event schema before reporting
ready.

Run the optional PostgreSQL integration suite against a disposable local database:

```bash
DRIFT_POSTGRES_TEST_URL=postgresql://drift:drift_dev_password@localhost:5432/drift pnpm run check
```

The schema is tenant-scoped by primary key design. Application adapters must include `tenant_id` in
every read and write predicate. The PostgreSQL scenario store also commits aggregate state,
idempotency record, audit event, and outbox event in one transaction.

## Recovery And Rollback

For `001_initial.sql`, rollback is a deployment operation, not an application mutation:

1. Stop traffic to the affected environment.
2. Take a physical or logical backup of the database.
3. For local disposable databases only, run `docker compose down -v` and recreate from migrations.
4. For shared environments, restore the previous database backup or apply an operator-reviewed
   reverse migration in a maintenance window.

Do not edit an applied migration in place. Add a new forward migration and keep old checksums stable.

Stop the database:

```bash
docker compose down
```

Delete local data only when you intentionally want a clean development database:

```bash
docker compose down -v
```
