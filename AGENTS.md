# CRM lab agreements

This is an isolated, wholly synthetic local CRM application. Do not import any real customer content or identifiers. All database records and meetings are invented. Tools mutate only the local SQLite database; no email sending or external CRM writes exist.

Keep the existing OpenAI SDK and its wire protocol when adapting provider configuration. Gateway inference must use a verified Understudy-owned organization. Direct OpenAI runs use an explicitly authorized OpenAI key from the process environment, without gateway credentials or headers. Both paths require a bounded request budget. Do not print, commit or pass credentials in command arguments. The app owns its SQLite data, run history, captured requests and responses in ignored, private `.local/`, using `.local/crm.sqlite` by default. Reserve ignored, private `.understudy/` for optional gateway configuration and gateway verification evidence. Neither directory belongs in source history or application packages; credentials stay outside the repository. Do not publish this app or add a Git remote without instruction.

Preserve the distinction between deterministic offline transport exercises and real model runs. A successful mock run is not live inference proof. Every tool call and mutation must be journaled; errors must remain visible. Validate actual final database state when testing the agent.
