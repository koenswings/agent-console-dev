# MEMORY.md

Durable facts and decisions only.
No daily logs. No secrets.

## Current Delivery Status

### Goal
Console UI v1 — PR open and under active iteration with Koen.

### Current State
- State: Active development — PR #15 open on `feature/console-ui-v1`
- Last updated: 2026-03-30
- PR: https://github.com/koenswings/agent-console-dev/pull/15
- MC task in progress: "First version of Console UI from Solution Description outline" (`5629de17`)

### What has been built (PR #15)
- Solid.js + Chrome Extension MV3, 81 tests passing
- Three deployment modes: dev (Tailscale), extension, production web app from Engine port 80
- Light theme default, dark via `prefers-color-scheme`
- Demo mode: mock store (2 engines, 3 disks, 5 instances), toggled in settings
- Display modes: side panel / popup / standalone window, switched at runtime via ⚙ settings
- Production web mode: auto-detects hostname from window.location, fetches store URL from /api/store-url
- Permission fix: Vite cache in /tmp, build script uses `sudo rm dist` fallback
- Git ownership fix: after every push, run `find .git -user root -exec chown node:node {} \;`

### Blocking Axle
Two Engine changes needed for production web mode (Mode 3):
1. Serve Console `dist/` from Engine HTTP server (port 80)
2. `GET /api/store-url` endpoint
Cross-agent task raised on Axle's board (see session memory for status).

### Next after PR #15 merges
- Architecture doc task (`e9491b4e`) — "Document Console architecture: Solid.js, Chrome Extension, Engine API contract"

### Koen Pi details
- Pi path: `/home/pi/idea/agents/agent-console-dev`
- Tailscale IP: `100.115.60.6`
- Tailscale hostname: `wizardly-hugle.tail2d60.ts.net`
- Engine WS port: 4321
- No App Disk docked; Engine not running yet

### Koen preferences
- Light theme (no dark mode)
- No terminal operations unless necessary
- Prefers `pnpm dev` / `pnpm package` workflow


## Operational Model

**Work cycle trigger:** Every work cycle begins with the CEO (Koen) starting it directly. Nothing moves autonomously without a CEO message.

**Standard cycle:**
1. CEO messages an agent with a task instruction
2. Agent shows plan (plan mode always on) → CEO approves or amends
3. Agent executes → produces: PR / design doc / proposal / report
4. Agent creates a review task for one reviewer agent via MC API (once per task iteration)
5. Pi cron detects the `auto-review` tagged task and auto-triggers the reviewer in an isolated session
6. Reviewer reads the artifact, writes a response, marks task done
7. CEO reviews complete output (primary + review) → approves, amends, or rejects

**Creating a review task (auto-review protocol):**
```
POST /api/v1/agent/boards/{reviewer_board_id}/tasks
{
  "title": "Review: [your task title]",
  "description": "Self-contained context. Review question. ⚠ Depth-1 auto-review: do not create further tasks.",
  "status": "inbox",
  "tags": ["auto-review"]
}
```
Create this task once per task iteration, when your primary output is ready for review.
Reviewer board IDs:
- Axle (Engine Dev):        6bddb9d2-c06f-444d-8b18-b517aeaa6aa8
- Pixel (Console Dev):      ac508766-e9e3-48a0-b6a5-54c6ffcdc1a3
- Beacon (Site Dev):        7cc2a1cf-fa22-485f-b842-bb22cb758257
- Veri (Quality Manager):   d0cfa49e-edcb-4a23-832b-c2ae2c99bf67
- Marco (Programme Mgr):    3f1be9c8-87e7-4a5d-9d3b-99756c35e3a9

**Hard rule — if your session was triggered by an `auto-review` task:**
Read the artifact → write your response to the PR / file → mark task done → stop.
Do NOT create any tasks during this session. No exceptions.

**Heartbeat:** External event polling only (e.g. CI failures, grant deadlines, stale PRs). Not for status reporting. Only activated when a specific external event warrants it.

**Standup:** Optional, CEO-triggered via `/standup` command. Not a daily cron. Run at CEO's discretion — weekly at most.

**Output types:**
- **PR** — code/config/doc change on a feature branch; never merge to main yourself; CEO merges
- **Design doc** — approach decision record before implementation; written to `idea/design/`; auto-reviewed by Veri
- **Proposal** — argument for a new backlog item; written to `idea/proposals/`; CEO merges to create MC task
- **Report** — narrative for human consumption (field update, quality summary); committed directly, no PR

## Durable decisions
- 2026-03-01: BASE_URL is `http://mission-control-backend:8000` (also `http://172.18.0.1:8000`) — both confirmed working.
- 2026-03-01: Heartbeat is not a periodic check-in — see Operational Model above. Only activated for specific external events.
- 2026-03-01: Board `Console Dev` — `require_approval_for_done: true`; all task closures need Koen approval.
- 2026-03-02: Boards list endpoint returns `{"items": [...], "total": N}` — use `.items[]` not `.[]` when parsing with jq.
- 2026-03-20: **One task at a time.** Directive from Koen (via Axle broadcast): do not pick up a new task until current task is fully complete. Supersedes any prior multi-task approach.

## Cross-board task creation

Use `MC_PLATFORM_TOKEN` (from `.env`) with the admin route — NOT the agent route:

```bash
curl -s -X POST "http://mission-control-backend:8000/api/v1/boards/{board_id}/tasks" \
  -H "Authorization: Bearer ${MC_PLATFORM_TOKEN}" \
  -H "Content-Type: application/json" \
  -d @payload.json
```

Agent token (`AUTH_TOKEN`) is board-scoped — 403 for any other board. Always use `MC_PLATFORM_TOKEN` for cross-agent tasks.

## Reusable playbooks
- Bootstrap check: verify curl+jq, create memory/, create today's daily file, hit /healthz, POST /heartbeat, delete BOOTSTRAP.md.

## Telegram Channel

You have a **dedicated Telegram group** for direct communication with the CEO.

- **Bot:** @Idea911Bot
- **CEO Telegram ID:** `8320646468`
- **Your group:** IDEA - Pixel · **Chat ID:** `-5187034968`
- **How it works:** The OpenClaw gateway binds your group to this agent exclusively via a `peer` filter in `openclaw.json`. Messages in your group go only to you; other agents have their own separate groups.

## Communication Standards

**No markdown tables or ASCII art tables in Telegram.** Both render poorly (Mac desktop / iPhone).
Use the `telegram-table` skill (`/home/node/workspace/skills/telegram-table/`) to render tables as PNG images.
For simple label/value lists, use plain bullets instead.
