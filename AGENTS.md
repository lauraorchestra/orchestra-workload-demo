# CRM lab agreements

This is an isolated, wholly synthetic local CRM application. Do not import any real customer content or identifiers. All database records and meetings are invented. Tools mutate only the local SQLite database; no email sending or external CRM writes exist.

Keep the existing OpenAI SDK and its wire protocol when adapting provider configuration. Gateway inference must use a verified Understudy-owned organization. Direct OpenAI runs use an explicitly authorized OpenAI key from the process environment, without gateway credentials or headers. Both paths require a bounded request budget. Do not print, commit or pass credentials in command arguments. Runtime identities, SQLite data, request IDs, run records and acceptance receipts belong in the ignored .understudy directory with private permissions. Do not publish this app or add a Git remote without instruction.

Preserve the distinction between deterministic offline transport exercises and real model runs. A successful mock run is not live inference proof. Every tool call and mutation must be journaled; errors must remain visible. Validate actual final database state when testing the agent.
