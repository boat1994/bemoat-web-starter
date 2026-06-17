# Issue Workflow Skill

Use this when work starts from a GitHub issue, PR, branch, commit, CI run, or
GitHub URL and native GitHub skills are unavailable.

## Required Reading

1. Read the GitHub issue or PR body and comments.
2. Read `AGENTS.md`.
3. Read `docs/agent-loop/README.md`.
4. Read `docs/agent-loop/issue-driven-branch-workflow.md`.
5. Read `docs/agent-loop/source-of-truth.md` when the task touches reusable
   starter infrastructure or child-project sync behavior.

## Required Flow

1. Identify the source issue number and acceptance criteria.
2. Run `git status`.
3. Stop if the working tree is dirty with unrelated changes.
4. Do not edit `main` directly.
5. Create a branch named `<type>/<issue-number>-<short-slug>` from `main`, or
   use the branch name explicitly requested by the user.
6. Make the smallest complete change.
7. Run the required validation.
8. Review the status and diff summary.
9. Commit one focused change when checks pass.
10. Push the branch.
11. Open or update a PR targeting `main`.
12. Include `Closes #<issue-number>` in the PR body.
13. Post an implementation report on the source issue when permissions allow.

## PR Body Must Include

- Summary.
- Changed files.
- Validation commands and exact results.
- Remaining risks.
- Human review notes.
- Issue link or `Closes #<issue-number>`.

## Stop Conditions

- Source issue number is unknown.
- GitHub permissions block required issue or PR operations.
- Checks fail and cannot be fixed safely within scope.
- The task would require production deploys, migrations, secrets, or resource
  IDs without explicit approval.

