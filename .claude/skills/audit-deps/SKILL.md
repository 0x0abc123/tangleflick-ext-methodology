---
name: audit-deps
description: Scan project dependencies for known security vulnerabilities with `bun audit`, interpret the advisories, and recommend/apply remediations. Use when the user wants to check dependencies for vulnerabilities, run a security audit, review CVEs, or asks "are my deps safe / any vulnerabilities".
---

# Audit dependencies for vulnerabilities

Check installed packages against the advisory database and turn the output into a clear,
actionable report.

## Steps

1. **Run the audit.**
   ```bash
   bun audit
   ```
   For reliable parsing, also capture JSON:
   ```bash
   bun audit --json
   ```
   If it reports no vulnerabilities, say so plainly and stop.

2. **Triage each advisory.** For every finding, determine:
   - **Severity** — critical / high / moderate / low.
   - **Package + version range** affected, and the **fixed version** (if any).
   - **Direct vs transitive** — is it in `package.json` (`kafkajs`, `nats`, `zod`,
     `typescript`, `@types/bun`) or pulled in by another package? Check with:
     ```bash
     bun pm ls --all | grep -i <package>
     ```
   - **Reachability (best-effort)** — is the vulnerable code path plausibly used by this repo?
     Note it, but don't downgrade severity on a guess.

3. **Recommend remediation**, most severe first:
   - **Fixed version exists** →
     - direct dep: `bun update <package>` (or `bun update --latest <package>` if the fix is
       outside the current semver range — flag the major bump).
     - transitive dep: update the parent that pulls it in; if none, consider a lockfile
       override.
   - **No fix available** → note the exposure; if not reachable/low risk, you may
     temporarily suppress with justification:
     ```bash
     bun audit --ignore <CVE-ID>   # record WHY and a follow-up to revisit
     ```

4. **Apply fixes only with the user's go-ahead** (this changes `package.json` / `bun.lock`).
   After any change:
   ```bash
   bun install --frozen-lockfile   # sanity: lockfile consistent
   bun run typecheck
   bun test
   bun audit                       # confirm the advisory is cleared
   ```
   If typecheck/tests break, report it; don't leave the tree broken.

## Report format

Summarize as a short table — severity · package · direct/transitive · fixed-in · recommended
action — followed by the exact commands you ran or propose. State the total counts by severity.

## Notes

- CI gating: `bun audit --audit-level=high` exits non-zero only on high/critical — useful to
  add as a CI step if the user wants to fail builds on serious advisories.
- Pair with `/update-deps` when remediation means broader version bumps.
