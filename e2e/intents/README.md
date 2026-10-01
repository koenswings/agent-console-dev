# Duration-test Intent adapters (idea#166 / #168)

Playwright adapters keyed by Axle [ACTIONS.md](https://github.com/koenswings/agent-engine-dev/blob/feat/duration-tests-phase1-2/test/duration/ACTIONS.md) / proposal snake_case.

## Engine wiring (Axle Phase 3)

Console exports a callable bridge for the duration runner:

```ts
import {
  runDurationIntent,
  hasDurationIntent,
  CONSOLE_INTENT_NAMES,
  intentRegistry,
} from 'idea-console/duration-intents';
// Sibling-clone fallback:
// from '../../agent-console-dev/e2e/intents'

const result = await runDurationIntent({
  action: ctx.action,       // YAML `action:` key
  page,                     // Playwright Page on Console URL
  diskId: ctx.fixtureDisk,
  instanceId: ctx.fixtureInstance,
});
if (!result.ok) { /* fail step / log result.message */ }
```

Replace Engine `uiStub` when `stubUi: false` by calling `runDurationIntent`.
Put thin wrappers under Engine `test/duration/ui/` if preferred — they should
delegate here rather than re-implement selectors.

Package export: `idea-console/duration-intents` → `e2e/intents/index.ts`
(requires path / workspace link to this repo; package is `private`).

## Deferred (not registered)

| Key | Reason |
|---|---|
| `enter_infra_fleet_walk`, `infra_*` | Engine-owned |
| `keep_watching`, `next_resource`, `exit_lesson` | In-App lesson chrome |
| `open_wikipedia_*` | Kiwix deferred |

## Kid pins

See `fixtures.ts` — content IDs + `live` facility/class/lesson (mutable on re-provision).
