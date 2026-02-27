# HEARTBEAT.md — Console UI Developer

Periodic checks to run during heartbeat polls (2-4 times per day):

## Check: Open PRs
- Are there open PRs on the `agent-console-dev` repo that need attention?
- Has the Quality Manager left review comments that need a response?

## Check: Engine API changes
- Have there been recent commits to `agent-engine-dev/` that affect the API the Console depends on?
- If yes, flag for the next active session to assess impact.

## Check: Backlog
- Are there newly approved items in `../../BACKLOG.md` under "Console UI"?
- Note any new items in today's memory file.

## Check: Memory
- Review and distil recent memory files into `MEMORY.md`

---
_Keep this file small. Heartbeats should be fast._
