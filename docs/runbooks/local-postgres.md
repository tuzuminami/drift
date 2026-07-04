# Local PostgreSQL Runbook

Start the local database:

```bash
docker compose up -d postgres
```

Apply the initial schema manually while the project is pre-1.0:

```bash
psql postgresql://drift:drift_dev_password@localhost:5432/drift -f migrations/001_initial.sql
```

The schema is tenant-scoped by primary key design. Application adapters must include `tenant_id` in every read and write predicate.

Stop the database:

```bash
docker compose down
```

Delete local data only when you intentionally want a clean development database:

```bash
docker compose down -v
```
