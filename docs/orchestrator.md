# fp-orchestrate — deterministic shell around `fp run`

`scripts/fp-orchestrate.sh` drives the fp backlog from ticket to merged feature.
It is a **deterministic conductor in front of a stochastic worker**: ticket
selection, ordering, gating and failure handling are pure functions of
`fp issue list --format json` + git + the gate's exit code; the actual work
(`fp run <id>`, which boots Claude Code) is not. The determinism buys
sequencing and failure *containment* — not correctness. Only the gate
(`npm test`) decides correctness.

## The transaction

For each ready ticket:

1. **Select** — the next `todo` leaf whose every dependency is `done`, in
   priority then creation order. Epics (any issue that is another issue's
   parent) are never selected; they are containers, not units of work.
2. **Isolate** — cut `auto/<shortId>` off the integration branch.
3. **Work** — `fp run <id>` on that branch (the non-deterministic step).
4. **Gate** — `npm test`.
5. **Settle** —
   - green → commit, `--no-ff` merge into the integration branch, mark the issue `done`.
   - red → leave the work quarantined on `auto/<shortId>`, comment on the issue,
     and **stop** (fail-fast). The issue is left `in-progress`.

## Why it doesn't "get weird" on failure

The failure path is the design, not an afterthought:

- **A red gate never poisons the next ticket.** Failed work stays on its own
  branch; the integration branch only ever advances through a green merge.
- **`in-progress` is the quarantine marker.** Selection only picks `todo`, so a
  failed ticket is never silently re-picked. `--keep-going` steps over it to the
  next ready ticket; the default stops so a human looks.
- **Fail-fast suits the dependency graph.** A failed S2 would otherwise hand a
  broken base to everything gated on it; better to halt at the first red gate.
- **Re-running is safe.** A clean ticket re-derives its branch from the
  (possibly advanced) integration tip. Nothing is keyed to run order.
- **`fp` writes are best-effort.** A failed status/comment update warns; it
  never crashes the conductor mid-transaction.

## Usage

```bash
scripts/fp-orchestrate.sh --dry-run                 # print the ready queue; touch nothing (always safe)
scripts/fp-orchestrate.sh --parent <shortId>        # scope to one epic's leaves
scripts/fp-orchestrate.sh --once                    # one ticket, then stop
scripts/fp-orchestrate.sh                           # run the whole ready backlog, fail-fast
scripts/fp-orchestrate.sh --keep-going              # quarantine reds, continue
```

Env overrides: `GATE_CMD` (default `npm test`), `WORK_CMD` (default `fp run`),
`MAX_ATTEMPTS` (default 1), `RESET_ON_RETRY` (default 0),
`INTEGRATION_BRANCH` (default: current branch). Requires a **clean working
tree** (it refuses to trample uncommitted work) and `fp`, `git`, `jq`.

### `WORK_CMD` and autonomy

`fp run` boots Claude Code on the issue. Whether the loop is "walk away"
autonomous or "drive each step" assisted depends on how `fp run` behaves
(interactive vs. headless). Swap in any worker that takes an issue id as its
last argument — e.g. a headless `claude -p` invocation — via `WORK_CMD`.

## Caveats — read before trusting it

- **It is only as correct as your dependency edges.** The order is derived from
  `dependencies` in fp, not from prose. Example from the current backlog: the
  PRD says `ilbfufzj` (cache drop-detection) needs `kubbdyeb` (per-session state
  foundation), but no `dependencies` edge encodes that — so the orchestrator
  would happily start drop-detection first. Wire the edges (`fp issue update
  --property` / the deps field) before relying on ordering.
- **The gate is the whole safety story.** If the worker weakens a test to make
  `npm test` pass, the gate passes too. Keep the gate honest (consider adding a
  "no test files weakened" check) and review merges.
- **It assumes the worker stays on its branch.** `fp run` is expected to edit
  within the repo; uncommitted changes are captured into the ticket commit.
