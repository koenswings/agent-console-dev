# TOOLS.md — Console UI Developer

## Environment

- **Projects root (container):** `/home/node/workspace/`
- **Console repo:** `/home/node/workspace/agents/agent-console-dev`
- **Engine repo (read-only reference):** `/home/node/workspace/agents/agent-engine-dev`
- **Org root:** `/home/node/workspace/` (CONTEXT.md, BACKLOG.md, proposals/, etc.)

## Local Engine for Testing

To test the Console against a live Engine:
- Engine must be running on the Pi (via `pnpm dev` or as a service)
- Connect Console to Engine API at `http://<pi-ip>:<port>`
- Use Tailscale hostname for consistent addressing

## Notes

_(Add browser compatibility notes, Chrome Extension manifest quirks, or local dev observations here.)_
