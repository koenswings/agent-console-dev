# TOOLS.md — Pixel, Console UI Developer

## API Credentials
- `BASE_URL=http://172.18.0.1:8000`
- `AUTH_TOKEN` — load from `.env` in this directory (gitignored, never committed)
- `AGENT_NAME=Pixel`
- `AGENT_ID=bd2b264f-4727-4799-8522-66114cc59a1c`
- `BOARD_ID=ac508766-e9e3-48a0-b6a5-54c6ffcdc1a3`
- `WORKSPACE_ROOT=/home/node/workspace`
- `WORKSPACE_PATH=/home/node/workspace/agents/agent-console-dev`
- Required tools: `curl`, `jq`

## Environment

- **Console repo:** `/home/node/workspace/agents/agent-console-dev`
- **Engine repo (read-only reference):** `/home/node/workspace/agents/agent-engine-dev`
- **Org root:** `/home/node/workspace/` (CONTEXT.md, BACKLOG.md, proposals/, etc.)

## OpenAPI refresh (run before API-heavy work)

```bash
mkdir -p api
curl -fsS "http://172.18.0.1:8000/openapi.json" -o api/openapi.json
jq -r '
  .paths | to_entries[] as $p
  | $p.value | to_entries[]
  | select((.value.tags // []) | index("agent-lead"))
  | "\(.key|ascii_upcase)\t\($p.key)\t\(.value.operationId // "-")\t\(.value[\"x-llm-intent\"] // "-")\t\(.value[\"x-when-to-use\"] // [] | join(\" | \"))\t\(.value[\"x-routing-policy\"] // [] | join(\" | \"))"
' api/openapi.json | sort > api/agent-lead-operations.tsv
```

## API discovery policy
- Use operations tagged `agent-lead`.
- Prefer operations whose `x-llm-intent` and `x-when-to-use` match the current objective.
