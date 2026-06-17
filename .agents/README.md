# Bemoat Agent Entrypoint

This directory is the portable project-level entrypoint for development agents.
Use it when an IDE does not support native Superpowers, Obra, Codex, or Cursor
skill and rule loading.

This is not a replacement for native tools. It is an adapter, registry,
checklist, and fallback layer that points agents back to the repository source
of truth.

## Native Skill Priority

- Cursor: use `.cursor/rules/*` and native Superpowers support first, then this
  directory as a project fallback.
- Codex: use native skills and `AGENTS.md` first, then this directory as a
  project fallback.
- Antigravity: use installed global skills first when available, then this
  directory as the portable project fallback.
- Other IDEs: start here, then read the linked project guidance.

Do not treat a local machine path as the only source of truth for a skill. If a
native skill runtime is available, invoke the installed skill by name. If it is
not available, use the matching Markdown file in `.agents/skills/`.

## Required Reading Order

Before planning, editing, reviewing, or running implementation commands:

1. Read `AGENTS.md`.
2. Read `docs/agent-loop/README.md`.
3. Read the relevant `.agents/skills/*.md` file.
4. For issue work, read `docs/agent-loop/issue-driven-branch-workflow.md`.
5. For starter versus child-project boundaries, read
   `docs/agent-loop/source-of-truth.md`.

## Project Skill Registry

| Skill | Use when |
| --- | --- |
| [`using-superpowers.md`](./skills/using-superpowers.md) | The IDE cannot invoke `superpowers:using-superpowers` natively. |
| [`development-agent.md`](./skills/development-agent.md) | Normal implementation, documentation, or maintenance work. |
| [`issue-workflow.md`](./skills/issue-workflow.md) | A GitHub issue, PR, branch, or URL drives the task. |
| [`regression.md`](./skills/regression.md) | Before reporting completion, choosing validation, or assessing risk. |
| [`payload-cms.md`](./skills/payload-cms.md) | Payload CMS collections, globals, hooks, access, endpoints, migrations, or admin components are in scope. |

## Default Loop

1. Identify the task type and relevant skill.
2. Read the source issue or task prompt.
3. Check the starter versus child-project boundary.
4. Run `git status`.
5. Stop if the working tree is dirty with unrelated changes.
6. Never edit `main` directly for issue work.
7. Create or switch to the dedicated task branch.
8. Make the smallest complete change.
9. Run the required validation.
10. Report changed files, command results, remaining risks, and PR status.

## Stop Conditions

Stop and report before editing or committing when:

- The working tree is dirty before task work starts.
- The task would require secrets, `.env` values, D1 IDs, R2 bucket names,
  Worker names, or Cloudflare production deploys.
- The task requires destructive Payload or D1 schema mutation without explicit
  human approval.
- The change belongs in a child project rather than reusable starter
  infrastructure.
- Required validation fails and cannot be fixed within scope.

