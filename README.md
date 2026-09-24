# Veltrix Cloud — Pterodactyl Discord Deploy Bot

Node.js + discord.js bot for Pterodactyl Application API management.

## Commands

- `/list`
- `/user-create email: password: username:`
- `/server-create ram: cpu: disk: email: name:`
- `/servers email:`
- `/server-delete email: server:`
- `/delete email: server:` (alias)
- `/server-reinstall email: server:`
- `/status identifier:`
- `/restart identifier:`

All commands are restricted to Discord members with the Administrator permission.

## Important

`PTERODACTYL_API_KEY` must be an **Application API key** from the Pterodactyl admin area.

For `/server-create`, you must configure:
- NEST_ID
- NODE_ID
- LOCATION_ID
- EGG_ID
- ALLOCATION_ID
- DOCKER_IMAGE
- STARTUP

The exact values depend on your Pterodactyl node/egg/allocation. Do not guess them.

`/restart` is intentionally protected as a placeholder because Pterodactyl server power actions use the Client API context. Do not put a user's client token in a public bot or hard-code it.

## Render

Render supports Node.js. For a continuously running Discord bot, use a service type that is available to your account and appropriate for long-running processes. Render's current documentation says free instances are not available for Background Workers; free Web Services are available but sleep after inactivity. A Discord bot therefore needs to be checked against the current Render plan/service limitations before relying on it for 24/7 operation.

Build:
npm install

Start:
npm start

Environment variables:
copy `.env.example` values into Render Environment Variables.

## Security

Never put the Discord token or Pterodactyl API key directly in GitHub.
Use Render Environment Variables.
