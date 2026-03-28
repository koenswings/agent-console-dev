# MEMORY.md

Durable facts and decisions only.
No daily logs. No secrets.

## Current Delivery Status

### Goal
Deliver IDEA Console UI — first working version + architecture doc, via PR for review.

### Current State
- State: Working
- Last updated: 2026-03-19 20:03 Europe/Brussels
- What is happening now: 2 tasks in inbox, both unassigned. Sequencing and assignment needed.
- Key constraint/signal: Architecture doc likely a dependency for UI build task.
- Why blocked (if any): none
- Next step: Assign tasks, set dependency (arch doc → UI build), move to in_progress.

### What Changed Since Last Update
- 2026-03-19: Koen added 2 tasks to board (both inbox, unassigned).
  1. "First version of Console UI from Solution Description outline" (`5629de17`)
  2. "Document Console architecture: Solid.js, Chrome Extension, Engine API contract" (`e9491b4e`)

### Decisions / Assumptions
- Architecture doc should precede UI build (assumption — to confirm with Koen if needed).
- Both tasks unassigned — need to assign to appropriate agent(s).

### Evidence (short)
- `GET /healthz` → `{"ok":true}` (2026-03-19 20:03 UTC)
- Tasks list: total=2, both status=inbox

### Request Now
- Confirm sequencing assumption: arch doc first, then UI build?
- Confirm who executes — assign to Pixel (Console UI Dev) or create specialist?

### Success Criteria
- Architecture doc written and in review.
- Console UI first version PR open for review.
- Both tasks closed with Koen approval.

### Stop Condition
- Both tasks reach `done` with required gates satisfied.


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
- 2026-03-01: BASE_URL is `http://172.18.0.1:8000` — confirmed working.
- 2026-03-01: Heartbeat is not a periodic check-in — see Operational Model above. Only activated for specific external events.
- 2026-03-01: Board `Console Dev` — `require_approval_for_done: true`; all task closures need Koen approval.
- 2026-03-02: Boards list endpoint returns `{"items": [...], "total": N}` — use `.items[]` not `.[]` when parsing with jq.
- 2026-03-20: **One task at a time.** Directive from Koen (via Axle broadcast): do not pick up a new task until current task is fully complete. Supersedes any prior multi-task approach.

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
