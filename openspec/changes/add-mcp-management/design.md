# Design

## Context

See proposal.md for motivation. `src/cli.ts` uses Commander 15; `src/storage.ts` provides Zod-validated envelopes, locking, atomic JSON replacement, and `HERA_HOME` isolation. The provider registry contains only Codex and requires execution, model, and plugin capabilities. There is no interactive selection utility or supported-platform catalog. README and the in-flight `hera-cli-v1` artifacts defer MCP; this change supersedes that MCP deferral without editing those historical planning artifacts.

Read-only inspection of installed `codex mcp add --help` confirms repeated `--env` and a command following `--`. Installed `claude mcp add --help` exposes stdio transport, environment values, and `--scope user`; its default scope is local. No registrations were made during planning. Native readback formats and conflict inspection need version-specific verification during implementation with isolated configurations.

## Goals / Non-Goals

**Goals:** Reuse Hera's durable state conventions; preserve argv boundaries; separate a packaged support catalog from runtime availability; make registration recoverable across partial failures.

**Non-Goals:** Expanding the execution-provider contract to require Claude run support, evaluating shell scripts, launching servers for health checks, arbitrary user catalog extensions, or changing transport scope beyond stdio. Platform registration confirms configuration, not MCP connectivity.

## Decisions

### Command parsing and environment values

Add `mcp add` to Commander, with repeated environment options before an explicit delimiter and untouched variadic argv after it. Validate the delimiter independently if Commander discards it. The shell resolves line continuations; Hera never tokenizes a command string. Use shell-free process spawning for adapters. Splitting or evaluating a command string would lose quoting and introduce unintended execution.

Split each environment assignment at its first `=`; allow empty values, reject invalid keys, and use last assignment wins for repeated keys. Restrict server names to `[A-Za-z0-9._-]+`, excluding `.` and `..`; apply a common validated contract to both adapters.

### Registry and duplicate policy

Use `statePath("mcp.config")` and a Zod envelope `{version: 1, servers: Record<string, {command: string, args: string[], env: Record<string,string>}>}`. The extension does not change the JSON format. Reuse or extract shared lock/read/atomic-write helpers without altering existing schedule and plugin semantics. Compare environments independent of key order, with ordered argv comparison. Identical additions proceed to selection; conflicts fail without overwrite. An overwrite flag and update command are deferred.

Create private files and directories, retain atomic replacement and corrupt-file preservation, and use maps or safe own-key handling when building the server dictionary. Saving is the commit point before selection: subsequent skips, interruptions, detection failures, or registration failures cannot remove the definition. Store no registration-success ledger in this version; native readback supplies retry reconciliation.

### Packaged platform catalog and separate adapters

Bundle root `platform.json` with version 1 and entries `{id, name, executable}` for `codex` / `Codex` / `codex` and `claude` / `Claude Code` / `claude`. Resolve it relative to the installed module, not cwd, and include it in npm's shipped files. Validate unique supported ids and adapter coverage. A malformed bundled catalog is an actionable packaging error; if encountered after saving, report the saved state explicitly.

Use a dedicated MCP adapter registry keyed by catalog ids, outside the execution provider registry. JSON owns the support list and display metadata; adapters own executable-specific detection, readback, and registration. Putting invocation templates into JSON would mix data with argument and conflict logic. Honor existing `CODEX_BIN` and add an analogous `CLAUDE_BIN` override; overrides affect availability detection and registration consistently.

Check executable availability using platform-aware PATH resolution, including Windows executable extensions. Availability is a candidate check only: incompatible versions can fail registration and must produce per-platform errors. Detecting support solely from configuration files would miss installed CLIs or mistake stale configuration for an installation.

### Interactive flow

After saving, display the saved path, detect catalog platforms, show missing platforms as unavailable, then offer an unselected multiple-choice list and explicit skip. Use a small readline-based numbered selection supporting comma-separated ids/numbers and validation, avoiding a new terminal UI dependency. No platforms or non-TTY stdin/stdout means save-only success with a clear message. Interrupting the prompt exits nonzero with no platform mutation. Detection and prompt handles must close cleanly.

### Native user-scope registration and retry reconciliation

Adapters use native read-only inspection to establish whether the user-scope name is absent, identical, or conflicting before registration. Verify the installed native readback commands/formats in isolated state; inspect structured user configuration read-only when a native command cannot distinguish user scope. Never print unredacted readback or environment-bearing child output. Config inspection must not execute or expand configuration values.

Codex registration maps to `codex mcp add <name> --env KEY=value ... -- <command> <args...>`. Claude maps to `claude mcp add --scope user --transport stdio --env KEY=value ... <name> -- <command> <args...>` with verified environment-option boundaries. Shell-free argument arrays preserve all values. Native CLI mutation preserves platform conventions; direct TOML/JSON writes would require owning provider-specific migrations and locking.

An identical user registration succeeds without mutation; a different one fails without replacement. Bound subprocess runtime and capture sizes. A failed or timed-out call is reconciled through readback where possible because a child may have written before failure. Attempt each selected platform independently, retain successes, and exit nonzero on any failure with saved-state guidance. Do not automatically roll back successful platforms. Recheck conflicts immediately before mutation; native CLI calls cannot provide a cross-process transaction with third-party writers.

### Secret handling

Registry replacement uses mode `0600` and new state directories `0700` on Unix. Values are persisted as supplied rather than encrypted: encryption would require a separate key-management design. Do not log command lines or raw native diagnostics containing secrets; redact environment values in errors, including values echoed by child processes. The README should explain plaintext local storage and shell-history implications. Windows access protection relies on the user's profile ACLs; do not claim Unix modes enforce Windows ACLs.

## Risks / Trade-offs

- Native CLI versions and readback schemas change -> fixture-based adapters, explicit unsupported-version errors, bounded calls, and isolated real-CLI smoke checks.
- A executable disappears after detection -> retain the definition, report a per-platform failure, continue other selected registrations.
- Platform mutation and Hera persistence are not one transaction -> save first, report each outcome, and reconcile identical retries.
- Third-party concurrent edits can race a native registration -> recheck immediately before mutation and document the absence of a transaction spanning external writers.
- Secrets reach native CLI argv and local config -> private state, no diagnostic echo, and explicit documentation; no promise of encrypted storage.
- Existing v1 documentation says MCP is deferred -> update current README and acceptance checks affected by the new feature; keep other v1 scope boundaries intact.

## Migration Plan

No registry migration is required: an absent `mcp.config` starts empty. Ship the catalog alongside the compiled entrypoint and verify installation outside the source tree. Existing schedules/plugins remain unchanged. Rolling back Hera retains the new registry and platform registrations; older Hera ignores the registry. Native registrations are removed manually through platform commands if needed, since removal is outside this change.
