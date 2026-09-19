# Repository instructions

## Deployment on Jacky's macOS workstation

- Read [`docs/RUNBOOK.md`](docs/RUNBOOK.md) before deploying this checkout.
- The live instance at `/Volumes/shit/projects/servertop` runs as a native Node.js
  process managed by the user LaunchAgent `dev.servertop`. It is not deployed with
  Docker Compose.
- Deploy changes with `npm test --workspace server`, `npm run build`, then
  `launchctl kickstart -k "gui/$(id -u)/dev.servertop"`. Verify the new PID,
  port 3000, `/api/auth/status`, and the service log.
- Build GitHub Pages only with `npm run build:pages`; it writes to
  `web/dist-pages`. Never use a Pages base path for the normal `npm run build`,
  because launchd serves the root-based `web/dist` directory.
- Do not print or commit `.env.local`, `layout.json`, `llm.json`, access tokens, or
  JWT secrets.
- Do not run `docker compose up` on this Mac unless the user explicitly requests a
  migration to Docker. The checked-in Compose configuration targets Linux; on
  Docker Desktop it would monitor the Linux VM rather than native macOS.
- The Docker card intentionally does not list ServerTop itself in this deployment:
  ServerTop is a host LaunchAgent, not a Docker container.

The Docker Compose workflow in the README remains the supported deployment path for
Linux hosts.
