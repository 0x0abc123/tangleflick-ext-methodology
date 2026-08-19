---
name: update-deps
description: Plan and execute dependency updates for this Bun project — survey outdated packages with `bun outdated`, propose a staged upgrade plan (patch/minor vs major with breaking-change review), then apply it with `bun update` and verify via typecheck + tests. Use when the user wants to update/upgrade/bump dependencies, check what's outdated, or modernize packages.
---

# Dependency update planner & executor

Upgrade dependencies deliberately: survey → plan → confirm → execute in safe batches → verify.
Updates mutate `package.json` and `bun.lock`, so **plan first and get explicit approval before
changing anything.**

## Phase 1 — Survey

```bash
bun outdated
```
This lists Current / Update (within range) / Latest (may cross majors) per package. Cross-check
direct deps in `package.json` vs transitive.

## Phase 2 — Plan

Group the updates and classify each by semver jump (compare Current → target):

- **Patch / minor** (e.g. `1.2.3 → 1.4.0`): generally safe → batch together.
- **Major** (e.g. `2.x → 3.x`): potentially breaking → handle **one at a time**, and review
  the changelog / release notes first (use WebSearch/WebFetch for the package's CHANGELOG or
  GitHub releases). Call out breaking changes relevant to how this repo uses the package.

Pay special attention to packages this repo depends on directly and their integration points:
- `zod` — schemas in `events/` + `src/config/schema.ts` and the codec.
- `kafkajs`, `nats` — the bus adapters (`src/adapters/{kafka,nats}`).
- `typescript`, `@types/bun` — may surface new type errors; expect to run typecheck.

Present a concise plan: which packages, from→to versions, patch/minor vs major, known breaking
changes, and the batching order. **Ask the user to approve before executing.**

## Phase 3 — Execute (in batches)

Do the safe batch first, then majors individually. After **each** batch, verify before moving on.

```bash
# Safe batch (within current semver ranges):
bun update <pkgA> <pkgB> ...

# A single major (crosses the range → use --latest and bump package.json):
bun update --latest <package>
```

After each batch:
```bash
bun run typecheck
bun test
```
- **Green** → keep going to the next batch.
- **Red** → investigate: fix call sites for the breaking change, or roll that package back
  (`git checkout -- package.json bun.lock && bun install`) and report what blocked it. Never
  leave the tree broken.

## Phase 4 — Finalize

```bash
bun audit                        # ensure updates didn't introduce advisories (see /audit-deps)
bun install --frozen-lockfile    # confirm lockfile is consistent (CI uses this)
```

Summarize what changed (package · from → to · notes), what was intentionally skipped and why,
and remind the user to review the `package.json` / `bun.lock` diff before committing. Do **not**
commit unless asked.

## Notes

- `bun update` stays within the semver ranges in `package.json`; `bun update --latest` upgrades
  to the newest and rewrites the range — use it deliberately for majors.
- Preview without writing: `bun update --dry-run`.
- Keep majors isolated so a failure is easy to attribute and revert.
