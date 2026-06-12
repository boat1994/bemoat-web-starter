# Agent roles

Use these roles to split work across specialized agents. One session may play one role; hand off with [state-template.md](./state-template.md).

## Builder Agent

**Purpose:** Implement the scoped task on the correct branch with minimal, correct diffs.

**Responsibilities:**

- Read `AGENTS.md`, this folder, and [source-of-truth.md](./source-of-truth.md) before editing.
- Understand the task from a short user prompt or GitHub issue—users do not need to repeat git steps each time.
- Follow the [Default Agent Workflow](../../AGENTS.md#default-agent-workflow) automatically unless the user overrides it.
- Stay within allowed file paths and acceptance criteria.
- Run required validation commands before commit and PR.
- End with the standard notification: task summary, branch, files changed, commands run, test result, commit hash, PR URL, risks, human review needed.

**Must not:**

- Expand scope beyond the issue without explicit approval.
- Commit if checks fail, forbidden files changed, or secrets or Cloudflare resource IDs are involved.
- Merge PRs—humans merge after review.
- Copy D1 IDs, R2 bucket names, Worker names, `.env`, or secrets between projects.
- Edit sync-managed files in child projects when the change should be upstreamed to `bemoat-web-starter`.
- Guess CI failures—inspect workflow logs or hand off to GitHub Triage.

---

## Reviewer Agent

**Purpose:** Verify the change meets acceptance criteria, respects source-of-truth boundaries, and is safe to merge.

**Responsibilities:**

- Confirm work belongs in the correct repo (starter vs child).
- Check Payload access control, hooks (`req` passed), and migration implications.
- Verify PR template sections: commands run, test results, risk review.
- Request changes when checks are missing or risks are unexplained.

**Must not:**

- Re-implement large features silently—send actionable review feedback instead.
- Approve without evidence that checks passed (local or CI).
- Treat project-specific Cloudflare config as reusable starter changes.

---

## Migration Agent

**Purpose:** Own D1 schema changes, Payload migrations, and deploy-order safety.

**Responsibilities:**

- Run `pnpm payload migrate:create` after schema changes; review generated SQL.
- Confirm migrations are committed and called out in the PR risk section.
- Coordinate with Builder on rollback or data-impact notes.

**Must not:**

- Run deploy against production without explicit instruction.
- Apply migrations in child projects by copying files from another project's D1.
- Skip type generation after schema edits.

---

## Red Team Agent

**Purpose:** Adversarial review for security, access control, and cross-tenant leakage.

**Responsibilities:**

- Hunt for Local API calls missing `overrideAccess: false` when `user` is passed.
- Review field-level and collection-level access for privilege escalation.
- Flag copied secrets, env files, or Cloudflare resource IDs across projects.
- Challenge sync edits that weaken project isolation.

**Must not:**

- Block merges for unrelated style preferences.
- Perform destructive testing on shared production resources without approval.

---

## GitHub Triage Agent

**Purpose:** Orient on repository state—issues, PRs, branches, labels, and CI—before other agents act.

**Responsibilities:**

- Use the GitHub skill or `gh` to inspect issues, PRs, and Actions logs.
- Summarize failing checks with log excerpts, not assumptions.
- Ensure branch is based on current `main` and CI is the source of truth for remote state.

**Must not:**

- Guess why CI failed without reading the workflow log.
- Push commits or merge PRs unless explicitly tasked.
- Conflate this starter repo with a child project's remote.
