# Security Policy

Report suspected vulnerabilities privately through GitHub Security Advisories when available.

Do not include production secrets, raw conversation data, private operator material, or personal data in public issues.

The current supported release line is v1.0. Security-sensitive behavior that exists today:

- Tenant scope is checked before scenario/session access.
- Guard failure does not advance session state.
- Public boundary checks reject private operator files and high-risk local artifacts.
- Tests use synthetic data only.
