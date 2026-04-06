# TOOLS.md — Pixel, Console UI Developer

## API Credentials
- `BASE_URL=http://mission-control-backend:8000`
- `AUTH_TOKEN` — load from `.env` in this directory (gitignored, never committed)
- `AGENT_NAME=Pixel`
- `AGENT_ID=bd2b264f-4727-4799-8522-66114cc59a1c`
- `BOARD_ID=ac508766-e9e3-48a0-b6a5-54c6ffcdc1a3`
- `WORKSPACE_ROOT=/home/node/workspace`
- `WORKSPACE_PATH=/home/node/workspace/agents/agent-console-dev`
- Required tools: `curl`, `jq`

See the **mc-api** shared skill for OpenAPI refresh, discovery policy, and usage examples:
`/home/node/workspace/skills/mc-api/SKILL.md`


## Environment

- **Runtime:** OpenClaw runs **natively on the Pi as user `pi`** — no Docker container. You are running directly on the hardware.
- **Pi hostname:** `wizardly-hugle` (Linux), `openclaw-pi` (Tailscale: `openclaw-pi.tail2d60.ts.net`)
- **Console repo:** `/home/node/workspace/agents/agent-console-dev`
- **Engine repo (read-only reference):** `/home/node/workspace/agents/agent-engine-dev`
- **Org root:** `/home/node/workspace/` (CONTEXT.md, BACKLOG.md, proposals/, etc.)
- **OpenClaw data:** `/home/pi/.openclaw/`

## Native Runtime — What Changed

OpenClaw was migrated from Docker to native systemd on 2026-04-06. Key implications:

- **Direct hardware access** — `/dev/` and network interfaces are accessible without Docker flags. `pnpm dev` and `pnpm test` run directly on the Pi.
- **No container UID mismatch** — files created by the agent are owned by `pi`. No more root-owned workspace files.
- **Restart OpenClaw:** `systemctl --user restart openclaw-gateway`
- **Vite dev server:** `pnpm dev` works as before; connect from browser via Tailscale IP.

## OpenAPI refresh (run before API-heavy work)

```bash
mkdir -p api
curl -fsS "http://mission-control-backend:8000/openapi.json" -o api/openapi.json
jq -r '
  .paths | to_entries[] as $p
  | $p.value | to_entries[]
  | select((.value.tags // []) | index("agent-lead"))
  | "\(.key|ascii_upcase)\t\($p.key)\t\(.value.operationId // "-")\t\(.value[\"x-llm-intent\"] // "-")\t\(.value[\"x-when-to-use\"] // [] | join(\" | \"))\t\(.value[\"x-routing-policy\"] // [] | join(\" | \"))"
' api/openapi.json | sort > api/agent-lead-operations.tsv
```

_(Add browser compatibility notes, Chrome Extension manifest quirks, or local dev observations here.)_

## GitHub Push & PR

`gh` is not available in the sandbox. Use `git` + `curl` with `GITHUB_TOKEN` from `.env`.

### Push a branch
```bash
source .env
git remote set-url origin https://koenswings:${GITHUB_TOKEN}@github.com/koenswings/agent-console-dev.git
git push origin BRANCH_NAME
git remote set-url origin https://github.com/koenswings/agent-console-dev.git
```

### Open a PR
```bash
source .env
curl -s -X POST "https://api.github.com/repos/koenswings/agent-console-dev/pulls" \
  -H "Authorization: token ${GITHUB_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"title\": \"PR TITLE\",
    \"head\": \"BRANCH_NAME\",
    \"base\": \"main\",
    \"body\": \"PR description\"
  }" | python3 -c "import sys,json; print(json.load(sys.stdin).get('html_url','error'))"
```

Replace `agent-console-dev` and `BRANCH_NAME` with the actual values for your repo.
`GITHUB_TOKEN` must be present in `.env` (gitignored, never committed).
