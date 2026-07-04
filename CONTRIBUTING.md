# Contributing

DRIFT is a small, security-conscious TypeScript project.

Before opening a pull request:

1. Run `pnpm install`.
2. Run `pnpm run check`.
3. Do not commit secrets, production conversation data, private operator material, local databases, or generated build output.
4. Keep domain logic independent from HTTP, database clients, provider SDKs, and environment variables.
5. Add tests for success and safe-failure behavior.

Public documentation should describe released behavior, not private planning context.
