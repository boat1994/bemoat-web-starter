# Harness-contract TypeScript migration characterization

<!-- bemoat-task-identity:start -->
```yaml
schema_version: 1
main_issue: "#333"
task_key: "issue-333-harness-contract-batch"
task_issue_strategy: "existing_dedicated_issue"
active_task_issue: "#333"
branch_template: "refactor/333-cursor-harness-contract-batch"
transition_target: "AWAITING_REVIEW_1"
planning_base_sha: "36d2d96de83df7a0a26d49d6e9642304552f856a"
execution_base_rule: "resolve_live_protected_base_at_dispatch"
paired_spec: "docs/superpowers/specs/bemoat-web-starter/issue-333/harness-contract/HARNESS_CONTRACT_SDD_SPEC.md"
paired_plan: null
```
<!-- bemoat-task-identity:end -->

Issue #333 bounded Cursor batch. Characterization-only. Behavior-preserving
port. Do not invent cleaner semantics.

## Fixed candidate base SHA

| Field | Value |
| --- | --- |
| Candidate branch | `refactor/333-cursor-harness-contract-batch` |
| **CURSOR_BATCH_BASE_SHA** | `36d2d96de83df7a0a26d49d6e9642304552f856a` |
| Protected base (`main`) | `dbf0cd80b7c8fdf8d9f2d68c9769ca213b8c4094` |
| PR #339 live head at batch start | `1441a6cc324aa9646888733e525e7d1bc707eb17` |
| Reservation | ACTIVE: `scripts/harness-contract/**` for Cursor |
| Explicitly not reserved | `scripts/guard-harness-contract.mjs` |
| Integration authority | Primary Mission Control owns PR #339 |
| Do not merge into | `refactor/333-campaign-normalize` |
| Do not base on | PR #339 live head `1441a6cc…` |

This SHA is the latest **actually promoted** PR #339 checkpoint recorded in
GitHub issue comment
[5289845099](https://github.com/boat1994/bemoat-web-starter/issues/333#issuecomment-5289845099).
Composer workers MUST checkout this SHA's descendant on
`refactor/333-cursor-harness-contract-batch`. They MUST NOT chase the live PR
head.

`.bemoat/mission-control-overrides.md` does not exist on merged `main`.
Operating policy is
`docs/mission-control/mission-control-guide.md` at the protected base.

Founder Zod mandate:
[issue comment 5244275152](https://github.com/boat1994/bemoat-web-starter/issues/333#issuecomment-5244275152).

---

## Complete folder inventory

Authoritative production files at the candidate base (plus this
characterization commit). Four `.mjs` modules. No subdirectories. No
TypeScript sources yet.

| Path | Lines (approx.) | Node builtins | Intra-folder imports | Exports |
| --- | --- | --- | --- | --- |
| `scripts/harness-contract/child-script-policy.mjs` | 111 | `node:fs.readFileSync`, `node:path.resolve` | none | `CHILD_FACING_HARNESS_PATHS`, `FORBIDDEN_RAW_SCRIPTS`, `extractPnpmRunScripts`, `findForbiddenRawScriptCalls`, `scanChildFacingHarnessFile`, `runHarnessContractGuard`, `getHarnessContractExitCode`, `formatHarnessContractViolations` |
| `scripts/harness-contract/runtime-import-parser.mjs` | 107 | none | none | `parseRuntimeImportSpecifiers` |
| `scripts/harness-contract/managed-runtime-closure.mjs` | 245 | `node:fs` (`existsSync`, `readFileSync`, `readdirSync`, `statSync`), `node:path` (`dirname`, `join`, `posix`) | `./runtime-import-parser.mjs` → `parseRuntimeImportSpecifiers` | `MANAGED_RUNTIME_ROOT_PREFIX`, `ManagedRuntimeDeliveryClosureError`, `isManagedPath`, `isBuiltinOrPackageSpecifier`, `resolveRelativeRuntimeCallee`, `collectManagedRuntimeScriptRoots`, `collectExplicitManagedRuntimeScriptPaths`, `scanManagedRuntimeDeliveryClosure`, `formatManagedRuntimeDeliveryViolations`, `assertManagedRuntimeDeliveryClosure` |
| `scripts/harness-contract/manifest.mjs` | 10 | `node:fs` (`existsSync`, `readFileSync`), `node:path.join` | none | `loadManagedPathsFromManifest` |

Non-exported internals that MUST remain private (do not promote to the public
facade unless the facade already re-exports them — it does not):

| Module | Private symbols |
| --- | --- |
| `child-script-policy.mjs` | `PNPM_RUN_RE` |
| `runtime-import-parser.mjs` | `STATIC_IMPORT_FROM_RE`, `EXPORT_FROM_RE`, `DYNAMIC_IMPORT_START_RE`, `normalizeDynamicImportSourceExpression`, `findDynamicImportInvocations`, `parseExactDynamicImportSpecifier` |
| `managed-runtime-closure.mjs` | `listRegularFiles`, `compareViolations` |

Architecture recording (outside ownership, frozen for this batch):

- `scripts/architecture-contract.json` `transitionalDirectories` includes
  `{ path: "scripts/harness-contract/", migration_status: "transitional" }`.
- `scripts/guards/scripts-architecture.mjs` **requires** that recording and
  that `migration_status` remain `transitional`.
- `scripts/ARCHITECTURE.md` documents the one allowed internal edge and the
  facade `scripts/guard-harness-contract.mjs`.

---

## Dependency graph

```text
scripts/guard-harness-contract.mjs          (FACADE / CLI composition root — NOT owned)
        ├─ re-export + import  child-script-policy.mjs
        ├─ re-export           runtime-import-parser.mjs
        ├─ re-export + import  managed-runtime-closure.mjs
        └─ re-export + import  manifest.mjs
        └─ import              scripts/cli/command-help.mjs
        └─ import              scripts/cli/command-invocation.mjs

scripts/harness-contract/managed-runtime-closure.mjs
        └─ import parseRuntimeImportSpecifiers
              from ./runtime-import-parser.mjs     ← ONLY intra-folder edge

scripts/harness-contract/child-script-policy.mjs    (no intra-folder deps)
scripts/harness-contract/runtime-import-parser.mjs  (no deps)
scripts/harness-contract/manifest.mjs               (no intra-folder deps)

Production consumers import the FACADE only (never scripts/harness-contract/*):
  scripts/guards/pack.mjs
      runHarnessContractGuard, formatHarnessContractViolations
  scripts/guard-pack.mjs
      identity-asserts pack entry === facade functions
  scripts/guards/package-manager.mjs
      CHILD_FACING_HARNESS_PATHS
  scripts/sync-boilerplate.mjs
      assertManagedRuntimeDeliveryClosure  (passed into boilerplate/workflow)
  scripts/boilerplate/filesystem.mjs
      assertManagedRuntimeDeliveryClosure  (default from facade)
```

Allowed internal edge (must remain the only one, or stay equivalent after
port):

```text
scripts/harness-contract/managed-runtime-closure.mjs
  -> scripts/harness-contract/runtime-import-parser.mjs
```

Extracted modules MUST NOT import any approved SCC node. They MAY import Node
builtins and the one intra-directory edge above. They MUST NOT import
`scripts/cli/**`, `scripts/guards/**`, `scripts/boilerplate/**`,
`scripts/mission-control/**`, or the facade.

---

## Coherent implementation clusters

Four behavioral clusters. File ownership is disjoint. Runtime dependency is
not: Cluster D consumes Cluster A's single public function.

### Cluster A — runtime import parser

- **Owned file:** `scripts/harness-contract/runtime-import-parser.mjs`
- **Owned tests:** `tests/int/harness-contract/runtime-import-parser.int.spec.ts`
- **Public contract:** `parseRuntimeImportSpecifiers(content) → { specifiers, unverifiable }`
- **Role:** regex/scan parser of ESM import-like text. No filesystem. No
  stdout. Never throws on well-formed strings (unclosed `import(` is
  unverifiable, not an exception).

### Cluster B — child-script policy

- **Owned file:** `scripts/harness-contract/child-script-policy.mjs`
- **Owned tests:** `tests/int/harness-contract/child-script-policy.int.spec.ts`
- **Public contract:** constants + scan/format/exit helpers listed in the
  inventory.
- **Role:** child-facing `bemoat:*` policy. Reads files. Returns violation
  arrays. Does not `process.exit`. Does not write stdout.

### Cluster C — managed-paths manifest

- **Owned file:** `scripts/harness-contract/manifest.mjs`
- **Characterization tests:** `describe('harness-contract manifest')` in
  `tests/int/harness-contract/facade-exports.int.spec.ts`
  (shared test file; see worker rules).
- **Public contract:** `loadManagedPathsFromManifest(root = process.cwd()) → string[]-like | null`
- **Role:** read `.bemoat/boilerplate-sync-manifest.json` and return
  `managedPaths` or `null`. JSON parse errors propagate.

### Cluster D — managed runtime delivery closure

- **Owned file:** `scripts/harness-contract/managed-runtime-closure.mjs`
- **Owned tests:** `tests/int/harness-contract/managed-runtime-closure.int.spec.ts`
- **Public contract:** prefix constant, error class, path helpers, scan,
  format, assert.
- **Role:** walk managed `scripts/**/*.mjs`, parse imports via Cluster A,
  emit sorted violations, optionally throw
  `ManagedRuntimeDeliveryClosureError`.
- **Depends on Cluster A export** `parseRuntimeImportSpecifiers`.

---

## Safe Composer worker ownership boundaries

Disjoint **file** ownership only. Workers MUST NOT edit another worker's owned
production file.

| Composer worker | Production files | Test files the worker may keep green | Parallel? |
| --- | --- | --- | --- |
| **Worker A — Parser** | `scripts/harness-contract/runtime-import-parser.mjs` | `tests/int/harness-contract/runtime-import-parser.int.spec.ts` | Yes, with B and C |
| **Worker B — Policy** | `scripts/harness-contract/child-script-policy.mjs` | `tests/int/harness-contract/child-script-policy.int.spec.ts` | Yes |
| **Worker C — Manifest** | `scripts/harness-contract/manifest.mjs` | Manifest `describe` in `tests/int/harness-contract/facade-exports.int.spec.ts` (read-mostly; do not rewrite the facade-export assertions) | Yes |
| **Worker D — Closure** | `scripts/harness-contract/managed-runtime-closure.mjs` | `tests/int/harness-contract/managed-runtime-closure.int.spec.ts` | **Serialize after A** |

### Parallel vs serialize

- **A, B, and C are disjoint enough for parallel Composer workers.**
- **D is file-disjoint from B and C, but MUST serialize after A** because it
  statically imports `./runtime-import-parser.mjs` and calls
  `parseRuntimeImportSpecifiers`. If A changes the specifier path or the
  function signature/return shape, D breaks.
- **Preferred alternative if MC wants fully parallel batches:** give A+D to
  one Composer worker. Then three parallel workers (A+D, B, C) with no
  intra-batch import race.

### Compatibility boundary each worker MUST keep

The unowned facade still does:

```js
export { … } from './harness-contract/<module>.mjs'
import { … } from './harness-contract/<module>.mjs'
```

Until Primary MC migrates `scripts/guard-harness-contract.mjs`, each cluster
MUST keep the **existing `.mjs` specifier** resolvable with the **same export
names**. A TypeScript body is allowed only behind that specifier (thin `.mjs`
re-export of `.ts`, or equivalent). Deleting or renaming the `.mjs` file is a
breaking change to the unowned facade.

`tests/int/harness-contract/facade-exports.int.spec.ts` lists extracted
modules by `readdirSync(...).filter(name => name.endsWith('.mjs'))` and
freezes the single internal edge. Adding extra `.mjs` files or extra internal
edges fails that test. Workers MUST NOT add new intra-folder imports.

---

## Authoritative legacy oracle per cluster

The `.mjs` implementation at `36d2d96de83df7a0a26d49d6e9642304552f856a`
(plus characterization tests added on this branch) is the oracle. Tests are
evidence; the `.mjs` source is authority when a test is silent. Do not
"fix" regex false positives, comment matching, or JSON `null` throws.

### Cluster A oracle — `parseRuntimeImportSpecifiers`

**Input:** `content` (expected string; non-strings throw from `String.prototype.matchAll`).

**Output:** `{ specifiers: Array<{ specifier, sourceExpression }>, unverifiable: Array<{ specifier, sourceExpression }> }`.

**Collection order is NOT source order.** All static `import` matches first,
then all `export … from` matches, then all dynamic `import(` invocations.

**Static regex** (`STATIC_IMPORT_FROM_RE`):
`/\bimport\s+(?:type\s+)?(?:[^;]*?\sfrom\s+)?['"]([^'"]+)['"]/g`

Observes:

- `import value, { helper } from './x.mjs'`
- `import './side.mjs'` (side-effect)
- `import type { X } from './t.mjs'`
- `import type Foo from './x.mjs'`
- double or single quotes

Does not observe `import.meta` (`import` not followed by whitespace then a
quote/`from` production in this regex).

**Export-from regex** (`EXPORT_FROM_RE`):
`/\bexport\s+(?:\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?)\s+from\s+['"]([^'"]+)['"]/g`

Observes `export { helper } from`, `export { default } from`, `export * from`,
`export * as ns from`.

Does **not** observe `export type { Bar } from './y.mjs'` (the token after
`export` is `type`, not `{` or `*`).

**Dynamic imports:** scan `import` + optional whitespace/comments + `(`, then
a quote-aware paren matcher. Exact literal specifiers (single quote, double
quote, substitution-free backtick with no `$` or `\`) are verifiable.
Computed expressions, concatenations, `.concat()`, interpolated templates,
conditionals, calls, parenthesized literals `import(('./hidden.mjs'))`, and
escaped quotes inside literals are unverifiable.

Whitespace inside the parentheses around an exact literal is trimmed and
remains verifiable; `sourceExpression` preserves the normalized invocation
text (`whitespace collapsed to single spaces`, then `trim`).

Unclosed `import(` runs to end of content and is unverifiable; the truncated
text is both `specifier` and `sourceExpression`.

Comment stripping is **not** implemented. Import-like text inside `//` and
`/* */` comments can still be observed. That is canonical, not a bug.

No stdout, no stderr, no `process.exit`, no filesystem.

### Cluster B oracle — child-script policy

**Constants (exact order, exact strings):**

`CHILD_FACING_HARNESS_PATHS`:

1. `.github/workflows/ci.yml`
2. `.githooks/pre-commit`
3. `.githooks/pre-push`

`FORBIDDEN_RAW_SCRIPTS`:

`guard:safety`, `guard:cloudflare-env`, `check`, `check:full`, `typecheck`,
`lint`, `build`, `deploy`, `deploy:app`, `deploy:database`, `deploy:dev`,
`preview`, `test:int`, `test`, `generate:importmap`, `generate:types`.

**`extractPnpmRunScripts(content)`:** global regex
`/pnpm run ([a-zA-Z0-9:_-]+)/g`. First token only. `pnpm run lint -- --fix`
→ `['lint']`. Does not match `pnpm lint`, `pnpm exec …`, or quoted
`pnpm run "lint"`. Matches inside comments (`# pnpm run lint`).

**`findForbiddenRawScriptCalls(content, forbidden = FORBIDDEN_RAW_SCRIPTS)`:**
filters extracted names through a `Set` of the provided list. A custom list
**replaces** the default; it does not union.

**`scanChildFacingHarnessFile(relativePath, content)`:** maps each forbidden
name to

```text
{
  type: 'forbidden-raw-script',
  file: relativePath,
  rule: <script>,
  message: 'Child-facing harness must not call non-namespaced script "<script>" — use bemoat:* instead'
}
```

Empty content → `[]`. Does not throw.

**`runHarnessContractGuard({ root = process.cwd(), paths = CHILD_FACING_HARNESS_PATHS, readFile = readFileSync utf8 } = {})`:**

- Iterates `paths` in array order.
- `resolve(root, relativePath)` then `readFile`.
- **Any throw** from `readFile` (including ENOENT) → one
  `missing-child-facing-file` violation
  `{ type, file: relativePath, rule: 'required-path', message: 'Child-facing harness file is missing' }`
  then **continue** (does not abort the scan).
- Otherwise appends `scanChildFacingHarnessFile` results.
- Returns the concatenated array. Never throws on missing files. Never writes
  stdout.

**`getHarnessContractExitCode(violations)`:** `violations.length > 0 ? 1 : 0`.
Does not inspect violation shape.

**`formatHarnessContractViolations(violations)`:**

- Empty → `['Harness contract guard passed.']`
- Non-empty, exact lines:

```text
Harness contract guard failed:

Synced CI and pre-push must call only bemoat:* scripts.
See docs/harness-sync-contract.md.

- [<type>] <file>: <message>
```

Format does **not** sort. Caller order is preserved.

No `process.exit`. CLI exit is the unowned facade.

### Cluster C oracle — `loadManagedPathsFromManifest`

**Path:** `join(root, '.bemoat/boilerplate-sync-manifest.json')` with
`root = process.cwd()` default.

**Missing file:** `existsSync` false → return `null`. Do not throw. Do not
create files.

**Present file:** `JSON.parse(readFileSync(path, 'utf8'))` then
`Array.isArray(manifest.managedPaths) ? manifest.managedPaths : null`.

Observable exceptions (do **not** catch or retarget):

| File body | Result |
| --- | --- |
| missing file | `null` |
| `{ "managedPaths": ["a","b"] }` | `['a','b']` (same array contents; mixed types kept) |
| `{ "managedPaths": [] }` | `[]` |
| `{ "managedPaths": [1, {"x":1}, "ok"] }` | `[1, {x:1}, "ok"]` |
| `{}` / `{ "managedPaths": "nope" }` / `true` / `0` / `[]` | `null` |
| invalid JSON / empty / whitespace | **throws `SyntaxError`** from `JSON.parse` |
| JSON `null` | **throws `TypeError`** (`Cannot read properties of null (reading 'managedPaths')`) |

Extra JSON keys are ignored. No schema check on element types. No stdout.

### Cluster D oracle — managed runtime closure

**`MANAGED_RUNTIME_ROOT_PREFIX`:** `'scripts'`.

**`ManagedRuntimeDeliveryClosureError`:** `extends Error`,
`name = 'ManagedRuntimeDeliveryClosureError'`,
`message = 'Managed runtime delivery closure validation failed'`,
`this.violations = violations`. `assertManagedRuntimeDeliveryClosure` also
sets `error.formatted` to the format helper's string array before throw.

**`isManagedPath(relativePath, managedPaths)`:** true iff some managed entry
equals `relativePath` OR `relativePath.startsWith(managedPath + '/')`.
`scripts/foo` does **not** match `scripts/foobar.mjs`.

**`isBuiltinOrPackageSpecifier(specifier)`:** true if falsy (`''`, `null`,
`undefined`), or starts with `node:` or `#`, or does **not** start with `.`
or `/`. Absolute `/x` is **false** here, but see resolve below.

**`resolveRelativeRuntimeCallee(importerPath, specifier)`:**

- specifier not starting with `.` → `{ kind: 'external', callee: null }`
  (covers `/abs.mjs` and `#x` after the builtin skip, and also `/` because
  scan skips builtins first except `/` which is not builtin, then resolve
  classifies `/` as external and **skips** it — no violation).
- posix-normalize `join(importerDir, specifier)`. If result is `..` or starts
  with `../` → `{ kind: 'escaped', callee: joined }`.
- else `{ kind: 'relative', callee: joined }`.

**`collectExplicitManagedRuntimeScriptPaths(managedPaths)`:** filter
`startsWith('scripts') && endsWith('.mjs')`, then `.sort()`. Directory
 managed paths under `scripts/` are excluded here; they are
roots via the walker.

**`collectManagedRuntimeScriptRoots(root, managedPaths)`:** recursively list
regular files under `scripts/` (missing dir → `[]`), keep `*.mjs` whose
posix-normalized path `isManagedPath`, then `.sort()`. Tests and fixtures
outside `scripts/` are never roots.

**`scanManagedRuntimeDeliveryClosure({ root = cwd, managedPaths = [], readFile, exists, isFile } = {})`:**

1. For each explicit managed `scripts/**.mjs` path, if missing or not a file
   (including a directory named `*.mjs`) →
   `{ type: 'missing-managed-runtime-source', importer: 'managedPaths', callee, specifier }`
   with all three path fields equal to the managed path string.
2. BFS/queue from `collectManagedRuntimeScriptRoots`. Skip already visited.
3. Missing importer file → `missing-relative-runtime-dependency` with
   importer=callee=specifier=importer path.
4. Parse content. Each unverifiable parser entry →
   `{ type: 'unverifiable-dynamic-runtime-import', importer, callee: '<unresolved>', specifier: entry.sourceExpression }`.
5. Each specifier: skip builtins/packages; skip `kind === 'external'`;
   `kind === 'escaped'` → **same unverifiable-dynamic type** with
   `callee: '<unresolved>'` and `specifier: sourceExpression` (the raw
   specifier text, not the joined `../…` path).
6. Relative callee missing/not a file → `missing-relative-runtime-dependency`.
7. Relative callee not `isManagedPath` → `unmanaged-relative-runtime-dependency`.
8. If callee ends with `.mjs` and is managed and not visited, enqueue it
   (non-`.mjs` managed callees are allowed if they exist and are managed, but
   are not scanned further).

Default `managedPaths = []` scans nothing and returns `[]`.

**Sort:** `compareViolations` =
`importer.localeCompare` then `type` then `callee` then `specifier`.
Returned array is sorted. Emission order is not the public contract; sorted
order is.

**`formatManagedRuntimeDeliveryViolations`:** empty →
`['Harness contract guard passed.']` (same success string as child-script
policy). Non-empty:

```text
Harness contract guard failed:

Managed runtime delivery closure must resolve only managed local dependencies.
See docs/harness-sync-contract.md.

- [<type>] importer="<importer>" -> callee="<callee>" specifier="<specifier>"
```

**`assertManagedRuntimeDeliveryClosure`:** scan; if empty return the empty
array (does not throw); else throw `ManagedRuntimeDeliveryClosureError` with
`violations` and `formatted`.

No stdout. No `process.exit`. Mutation: **none** (read-only).

---

## Direct callers / consumers

All production callers go through the unowned facade except tests that
dynamic-import the folder modules directly.

| Caller | Symbols | Notes |
| --- | --- | --- |
| `scripts/guard-harness-contract.mjs` | all public exports re-exported; runtime uses `runHarnessContractGuard`, `getHarnessContractExitCode`, `formatHarnessContractViolations`, `scanManagedRuntimeDeliveryClosure`, `formatManagedRuntimeDeliveryViolations`, `loadManagedPathsFromManifest` | CLI composition. If `loadManagedPathsFromManifest` returns `null`, runtime scan is skipped (`[]`). If runtime violations exist, **only** runtime format is printed (child-facing violations are dropped from stdout). Exit 1 if runtime violations else child-facing exit helper. **Do not modify this file.** |
| `scripts/guards/pack.mjs` | `runHarnessContractGuard`, `formatHarnessContractViolations` | Guard pack entry `id: 'harness-contract'`. Does **not** run the runtime-closure scan. |
| `scripts/guard-pack.mjs` | same, identity check vs pack entry | Throws if pack is not wired to facade functions. |
| `scripts/guards/package-manager.mjs` | `CHILD_FACING_HARNESS_PATHS` | Spreads into `PACKAGE_MANAGER_SCAN_PATHS` plus starter-only `ci-starter.yml`. |
| `scripts/sync-boilerplate.mjs` | `assertManagedRuntimeDeliveryClosure` | Passed into workflow; throws abort sync before copy. |
| `scripts/boilerplate/filesystem.mjs` | `assertManagedRuntimeDeliveryClosure` default import from facade | Called at start of `syncPathsFromSource`. |
| `package.json` `bemoat:guard:harness-contract` | CLI | `node scripts/guard-harness-contract.mjs` |
| `package.json` `bemoat:guard:safety` / `guard:safety` / pack | CLI | pack includes child-facing harness-contract only |

Tests (characterization oracles; not production):

- `tests/int/harness-contract/*.int.spec.ts` (direct folder imports)
- `tests/int/harness-contract-guard.int.spec.ts` (facade)
- `tests/int/scripts-entrypoints-contract.int.spec.ts` (CLI stdout/exit)
- `tests/int/starter-acceptance.int.spec.ts`
- `tests/int/guard-pack.int.spec.ts`
- `tests/int/boilerplate-sync.int.spec.ts`
- `tests/int/cli-tier-b-boundaries.int.spec.ts`
- `tests/int/cli-command-registry.int.spec.ts`
- `tests/int/scripts-architecture.int.spec.ts`

Pinned dogfood fixtures under
`tests/fixtures/starter-only/mission-control/phase1-dogfood/pinned-source/`
are historical snapshots. Do not update them in this batch.

---

## Valid / invalid behavior invariants

Preserve these exactly.

### Shared

- No cluster writes files, mutates git, or calls `process.exit`.
- Success format string for both formatters is exactly
  `Harness contract guard passed.`
- Failure banners differ (child-facing vs runtime closure) and MUST NOT be
  unified.
- Public export names and the facade re-export set MUST remain identical.

### Child-script policy

- Valid: only `bemoat:*` (and non-`pnpm run`) text in the three child-facing
  files → `[]`, exit helper `0`.
- Invalid: any forbidden raw script token → one violation per match, path
  order, exit helper `1`.
- Missing required path → `missing-child-facing-file`, scan continues.
- Custom `paths` / `readFile` are part of the function contract.
- `pnpm run "lint"` is **not** extracted (quoted names are not observed).
- Comment text `pnpm run lint` **is** extracted.

### Runtime import parser

- Valid exact dynamic literals: `'…'`, `"…"`, `` `…` `` without `$` or `\`.
- Invalid/computed dynamic imports: unverifiable, fail-closed, one entry.
- Static+export+dynamic collection order is static, export-from, dynamic.
- `export type { } from` is invisible.
- Import-like text in comments may still parse.

### Manifest

- Missing file → `null` (facade then skips runtime closure).
- Non-array `managedPaths` → `null` (same skip).
- Array including non-strings → returned as-is.
- Invalid JSON → `SyntaxError` (CLI would crash; that is canonical).
- JSON `null` → `TypeError` (do not optional-chain).

### Managed runtime closure

- Live starter `managedPaths` from sync config yields `[]` violations.
- Missing explicit managed `.mjs` → `missing-managed-runtime-source`.
- Missing relative callee → `missing-relative-runtime-dependency`.
- Present but unmanaged relative callee → `unmanaged-relative-runtime-dependency`.
- Computed dynamic import or escaped `../` →
  `unverifiable-dynamic-runtime-import` with `callee: '<unresolved>'`.
- Absolute `/…` specifiers produce **no** violation.
- Empty specifier is treated as builtin → **no** violation.
- Directory named `*.mjs` is missing source, not a traversable root.
- `assert*` throws only when violations exist; success returns `[]`.
- Violation sort key is importer, type, callee, specifier.

---

## Runtime trust boundaries

| Boundary | Module | What crosses | Current handling |
| --- | --- | --- | --- |
| Filesystem JSON | `manifest.mjs` | `.bemoat/boilerplate-sync-manifest.json` | `existsSync` + `JSON.parse`; no element schema |
| Filesystem text | `child-script-policy.mjs` | child-facing CI/hook file bodies | regex; any `readFile` throw → missing-file violation |
| Filesystem tree + text | `managed-runtime-closure.mjs` | `scripts/**/*.mjs` contents and `managedPaths` from JSON or in-process config | regex parse + path rules; injectable `readFile`/`exists`/`isFile` |
| Untrusted source text | `runtime-import-parser.mjs` | file content string | regex; no JSON |
| Function options | all four | `root`, `paths`, `managedPaths`, callbacks | JS defaults; non-iterable `paths`/`managedPaths` throw TypeError from `for…of` |
| Process / CLI | **unowned facade** | argv, env, cwd, stdout, exit | already a CLI contract; out of this batch |
| GitHub/network | none in this folder | — | — |
| Env vars | none in this folder | — | facade `npm_lifecycle_event` only |

`managedPaths` consumed by Cluster D may originate from Cluster C (JSON) or
from `scripts/boilerplate` in-process constants. Treat JSON-origin arrays as
untrusted. Do not assume elements are strings.

---

## Zod obligations

Founder mandate: Zod at genuine trust boundaries; schemas describe **existing**
behavior; no coercion/defaults/stripping that changes acceptance; do not leak
`ZodError` into CLI stdout; no `any` / unchecked casts.

Do **not** add ceremonial Zod to internally constructed violation objects or
to pure compile-time helper types.

### Must-have Zod (or equivalent parse-then-narrow) when porting

1. **`loadManagedPathsFromManifest` (Cluster C) — highest priority.**
   After `JSON.parse`, the value is `unknown`.
   - Preserve: missing file → `null` **before** parse.
   - Preserve: `JSON.parse` `SyntaxError` for invalid JSON (do not catch into
     `ZodError` or `null`).
   - Preserve: JSON `null` → **TypeError on `.managedPaths` access**, not a
     Zod failure and not `null`. Optional chaining would be semantic drift.
   - Preserve: non-array `managedPaths` → `null` (Zod object failure here
     must be translated to `null`, not thrown).
   - Preserve: array elements may be non-strings. **Do not use
     `z.array(z.string())`.** Use `z.array(z.unknown())` (or fail closed to
     Founder if a string-only schema is desired). Mixed-type passthrough is
     frozen.
   - Extra object keys: currently ignored. `z.object({ managedPaths: … }).passthrough()`
     or pick-only is fine because only `managedPaths` is returned.

2. **`scanManagedRuntimeDeliveryClosure` `managedPaths` option (Cluster D).**
   Same element permissiveness as Cluster C when the array came from JSON.
   Do not reject numbers/objects in the array if the current helpers would
   coerce them via `startsWith`/`endsWith`. If implementing Zod, either
   `z.array(z.unknown())` or keep the JS `for` loop and document that
   tightening is Founder-gated.

3. **CLI/facade options** are out of ownership. When the facade is later
   migrated, argv/env Zod belongs there, not in these four modules, unless a
   worker is asked to export schemas for the facade to use.

### Must-not Zod (ceremonial or behavior-changing)

- Do not Zod-parse child-facing file **content** into a structured document.
  The contract is opaque string + regex.
- Do not replace `parseRuntimeImportSpecifiers` with a JS parser that stops
  matching comments or `export type`. Regex false-positives are canonical.
- Do not Zod-validate `readFile`/`exists`/`isFile` callbacks into a narrower
  type that changes throw mapping.
- Do not coerce `root` with `z.string().default(process.cwd())` in a way that
  treats `root: ''` or `root: 0` differently than today (`join`/`resolve`
  coercion). Prefer: if options is omitted, existing defaults; if `root` is
  provided as a non-string, keep current `path` behavior.
- Do not change `getHarnessContractExitCode` to require typed violations;
  `[{ type: 'x' }]` is already an oracle (`scripts-entrypoints-contract`).

### Error translation

If Zod is used on `managedPaths` shape: failure that currently returns `null`
must still return `null`. Failure that currently throws `SyntaxError` or
`TypeError` must still throw those native errors, not `ZodError`. Never print
Zod issues from these modules (they have no stdout today).

### Fail-closed ambiguity (do not "clean up")

**Array element types of `managedPaths`.** Production manifests use strings.
The oracle returns mixed types unchanged. Composer MUST preserve passthrough.
Requesting `z.array(z.string())` is a semantic change and requires Founder /
Mission Control authority — it is not in this batch.

---

## Facade requirements

`scripts/guard-harness-contract.mjs` remains the **only** supported production
import surface.

Frozen facade export set (see `tests/int/harness-contract/facade-exports.int.spec.ts`):

`CHILD_FACING_HARNESS_PATHS`, `FORBIDDEN_RAW_SCRIPTS`,
`MANAGED_RUNTIME_ROOT_PREFIX`, `ManagedRuntimeDeliveryClosureError`,
`extractPnpmRunScripts`, `findForbiddenRawScriptCalls`,
`scanChildFacingHarnessFile`, `isManagedPath`,
`isBuiltinOrPackageSpecifier`, `resolveRelativeRuntimeCallee`,
`parseRuntimeImportSpecifiers`, `collectManagedRuntimeScriptRoots`,
`collectExplicitManagedRuntimeScriptPaths`,
`scanManagedRuntimeDeliveryClosure`,
`formatManagedRuntimeDeliveryViolations`,
`assertManagedRuntimeDeliveryClosure`, `runHarnessContractGuard`,
`getHarnessContractExitCode`, `formatHarnessContractViolations`,
`loadManagedPathsFromManifest`, `isDirectExecution`.

Workers MUST NOT:

- add/remove/rename those exports
- change default parameter behavior the facade relies on
- import the facade from inside `scripts/harness-contract/`
- change the unowned CLI composition:
  - `loadManagedPathsFromManifest(root)` null → skip runtime scan
  - runtime violations non-empty → format runtime lines only, `exitCode = 1`
  - else format child-facing lines and `getHarnessContractExitCode`

Temporary `.mjs` re-exports in `scripts/harness-contract/` are the required
compatibility boundary until the facade file is migrated by a later,
unreserved slice.

---

## Tests to add / change

### Added in this characterization commit

Important legacy behavior that was not previously frozen, added to **existing**
managed int specs (new int files would require unowned `managedPaths` updates):

| File | New coverage |
| --- | --- |
| `tests/int/harness-contract/child-script-policy.int.spec.ts` | `pnpm run` token edges; replacement forbidden list; empty scan; missing-file continue; custom `paths`; `readFile` throw → missing-file |
| `tests/int/harness-contract/runtime-import-parser.int.spec.ts` | static/export/dynamic collection order; side-effect / `import type` / `export *`; `export type` invisible; whitespace-padded dynamic literal; empty / `import.meta` / unclosed `import(` |
| `tests/int/harness-contract/managed-runtime-closure.int.spec.ts` | `isManagedPath` slash prefix; explicit path collect+sort; empty/absolute specifiers; assert success `[]`; directory `*.mjs`; default `managedPaths`; unmanaged `.json` callee |
| `tests/int/harness-contract/facade-exports.int.spec.ts` | `loadManagedPathsFromManifest` missing/valid/non-array/mixed/SyntaxError/TypeError/live starter |

### Already frozen (do not weaken)

- `tests/int/harness-contract-guard.int.spec.ts` — facade-level closure matrix
  including exhaustive unverifiable dynamic-import cases
- `tests/int/harness-contract/facade-exports.int.spec.ts` — public symbol set,
  production importer symbols, acyclic intra-folder edge
- `tests/int/scripts-entrypoints-contract.int.spec.ts` — CLI stdout/exit 0 and 1
- `tests/int/guard-pack.int.spec.ts` — pack identity wiring
- `tests/int/starter-acceptance.int.spec.ts` — live child-facing pass
- `tests/int/boilerplate-sync.int.spec.ts` — managed path presence and live
  closure after sync
- `tests/int/scripts-architecture.int.spec.ts` — transitional directory

### Composer TS workers

- Keep the tests above green. Do not rewrite expected strings to match a
  nicer parser.
- Do not add a new `tests/int/**/*.int.spec.ts` file unless Mission Control
  also updates `scripts/boilerplate/inventory.mjs`,
  `.bemoat/boilerplate-sync-manifest.json`, and the explicit path list in
  `tests/int/boilerplate-sync.int.spec.ts` (all outside this reservation).
- `facade-exports.int.spec.ts` is shared. Worker C may append manifest cases
  only if needed; Workers A/B/D MUST NOT reshape its facade-export or edge
  assertions. After all clusters land, a later unowned facade slice updates
  `.mjs` filters if `.ts` files appear beside re-exports.

---

## Files outside ownership that MUST NOT be modified

Composer workers on this batch MUST NOT modify:

- `scripts/guard-harness-contract.mjs`
- `scripts/guards/**` (including `pack.mjs`, `package-manager.mjs`,
  `scripts-architecture.mjs`)
- `scripts/cli/**`
- `scripts/mission-control/**`
- `scripts/boilerplate/**`
- `scripts/sync-boilerplate.mjs`
- `scripts/guard-pack.mjs`
- `scripts/architecture-contract.json`
- `scripts/ARCHITECTURE.md`
- `.bemoat/boilerplate-sync-manifest.json`
- `.bemoat-boilerplate-sync.json`
- `package.json`
- `docs/harness-sync-contract.md`, `docs/guard-pack.md`, `docs/adr/**`
- `tests/int/harness-contract-guard.int.spec.ts`
- `tests/int/boilerplate-sync*.int.spec.ts`
- `tests/int/guard-pack.int.spec.ts`
- `tests/int/scripts-architecture.int.spec.ts`
- `tests/int/scripts-entrypoints-contract.int.spec.ts`
- `tests/int/cli-*.int.spec.ts`
- `tests/fixtures/**`
- any path under another ACTIVE Cursor lock (`scripts/cli/**` remains
  separately reserved)

This characterization commit may only add/keep tests under
`tests/int/harness-contract/` and this spec file.

---

## Potential integration dependencies

| Dependency | Owner | Risk if this batch changes behavior |
| --- | --- | --- |
| Facade `.mjs` specifiers | unowned facade / later slice | import failures across guard pack, sync, package-manager |
| `assertManagedRuntimeDeliveryClosure` throw | boilerplate sync | sync aborts; `ManagedRuntimeDeliveryClosureError` shape used by callers |
| `CHILD_FACING_HARNESS_PATHS` array identity/order | package-manager scan paths | extra/missing files scanned for npm/yarn |
| `runHarnessContractGuard` / format pair | guard pack | pack identity assertion throws; safety CI fails |
| `loadManagedPathsFromManifest` → `null` skip | facade CLI | missing manifest currently skips runtime closure (does not fail closed as a violation). Changing that would alter CLI exit on old trees. |
| Architecture `transitional` status | scripts-architecture guard | flipping status without moving the directory into destination vocabulary fails the architecture guard |
| `managedPaths` includes `scripts/harness-contract` as a **directory** | boilerplate inventory | folder sync copies all four modules; extra files in the folder sync to children |
| Shared int tests listed individually in inventory | boilerplate-sync contract | new `*.int.spec.ts` files fail CI until inventory/manifest updated |
| PR #339 correction lineage | Primary MC | do not rebase onto live head `1441a6cc`; do not merge into campaign-normalize |

---

## Validation commands

Characterization / later TS slice:

```bash
pnpm exec vitest run --config ./vitest.config.mts \
  tests/int/harness-contract/child-script-policy.int.spec.ts \
  tests/int/harness-contract/runtime-import-parser.int.spec.ts \
  tests/int/harness-contract/managed-runtime-closure.int.spec.ts \
  tests/int/harness-contract/facade-exports.int.spec.ts \
  tests/int/harness-contract-guard.int.spec.ts

pnpm exec vitest run --config ./vitest.config.mts \
  tests/int/guard-pack.int.spec.ts \
  tests/int/scripts-entrypoints-contract.int.spec.ts \
  tests/int/scripts-architecture.int.spec.ts

pnpm run bemoat:guard:harness-contract
pnpm run guard:safety
```

Before PR (code + tests in this starter): `pnpm run check`.

Do not treat `typecheck` alone as proof of preserved behavior.

---

## Acceptance criteria

- [x] Candidate branch created from exact SHA `36d2d96de83df7a0a26d49d6e9642304552f856a`.
- [x] Folder `scripts/harness-contract/**` fully inventoried.
- [x] Direct callers, facade, pack, sync, and architecture integration recorded.
- [x] Observable behavior frozen in this spec and in added characterization tests.
- [x] Zod obligations mapped to real trust boundaries without authorizing
      semantic tightening.
- [x] Composer worker file ownership is disjoint; Cluster D serializes after A
      (or A+D share one worker).
- [x] No TypeScript production migration in this commit.
- [x] `scripts/guard-harness-contract.mjs` unmodified.
- [ ] Composer workers port clusters behind existing `.mjs` specifiers with
      tests green (later).
- [ ] Unowned facade later consumes TypeScript without duplicate business
      logic (later, Primary MC / unreserved slice).

Slice-level Issue #333 criteria that this batch supports but does not close:
characterization-first coverage before language conversion; no unintended
CLI/stdout/exit change; harness contract guards remain passing; no broad
`any` / unchecked cast strategy.

---

## BLOCKED_FOR_MC_RECONCILIATION

None that block **this characterization commit**.

Constraints that later TS workers must not resolve themselves:

1. **Facade specifier freeze.** Workers cannot update
   `scripts/guard-harness-contract.mjs`. Keep `.mjs` entrypoints.
2. **Architecture transitional status.** The directory must remain recorded
   as `transitional`. Moving it into destination vocabulary
   (`scripts/guards/`, `scripts/shared/`, …) is a separate campaign decision.
3. **New shared int specs need inventory.** Do not add
   `tests/int/harness-contract/manifest.int.spec.ts` without MC updating
   managed path lists.
4. **Do not integrate onto PR #339 live head or `refactor/333-campaign-normalize`.**
   Primary MC owns promotion.
5. **`managedPaths` element-type tightening** (`z.array(z.string())`) is
   Founder-gated, not a Composer choice.
