# Tasks

## 1. Command input and durable definitions

- [x] 1.1 Add the `mcp add` command and validated definition type; verify subprocess parser tests cover the explicit delimiter, line continuations, zero/repeated env flags, values containing `=`, empty values, duplicate-key precedence, server flags, spaces/metacharacters, unsafe names, and missing commands without server execution or invalid-input side effects.
- [x] 1.2 Add the versioned `mcp.config` schema and reuse locked atomic storage; verify isolated-state tests cover first save, unrelated records, identical retries with reordered environment keys, conflicting definitions, concurrent processes, corrupt/unsupported state preservation, failed writes, safe dictionary keys, and Unix `0600` file permissions.
- [x] 1.3 Document the syntax, JSON example, `HERA_HOME` behavior, duplicate policy, plaintext environment storage, and shell continuation semantics in README; verify examples parse to the documented definitions and existing registry documentation distinguishes MCP env storage from schedule/plugin records.

## 2. Supported catalog and installed-platform detection

- [x] 2.1 Add bundled root `platform.json` for Codex and Claude Code and a validated catalog loader resolved from the installed module; verify missing/malformed catalog errors, duplicate ids, adapter coverage, and loading outside the repository cwd.
- [x] 2.2 Introduce a separate MCP adapter registry and executable availability checks with `CODEX_BIN` and `CLAUDE_BIN` overrides; verify fake PATH tests cover both/one/no installed platforms, overrides, missing executables, and platform-specific executable resolution, while Claude execution remains unsupported.
- [x] 2.3 Include the catalog in npm package files and document supported versus installed platforms and overrides; verify `npm pack --dry-run` includes `platform.json` and the README does not imply Claude execution support.

## 3. Native registration adapters

- [x] 3.1 Verify Codex user-scope MCP readback and add behavior in isolated CLI configuration, then implement shell-free inspection/registration; verify fixtures and an isolated smoke test preserve exact argv/env, unrelated settings, identical registrations, conflicting names, and readback after ambiguous failure without launching an MCP server.
- [x] 3.2 Verify Claude Code user-scope readback and repeated env option boundaries in isolated CLI configuration, then implement inspection/registration with explicit user scope and stdio transport; verify fixtures and an isolated smoke test distinguish local/project settings from user settings and cover identical/conflicting user registrations, literal argv/env, and unrelated configuration preservation.
- [x] 3.3 Add bounded adapter subprocess handling and sanitized errors; verify fake executable tests cover missing/incompatible CLIs, timeouts, output limits, child failure, and environment values echoed in stdout/stderr without exposing those values in Hera output.
- [x] 3.4 Document native user-scope registration, supported CLI versions actually verified, conflict behavior, and configuration-versus-connectivity semantics; verify documented registration forms match adapter invocation fixtures.

## 4. Save-first selection and outcomes

- [x] 4.1 Wire validation and save before catalog loading, detection, and selection; verify event-order tests prove persistence precedes these actions and save failure prevents all platform calls.
- [x] 4.2 Implement terminal multiple selection using readline with comma-separated platform ids/numbers, no default selection, unavailable-platform reporting, skip, and cancellation; verify interactive tests cover both platforms, one platform, invalid selection, duplicates, skip, EOF, Ctrl-C, and prompt cleanup without unintended registrations.
- [x] 4.3 Implement noninteractive/no-platform save-only behavior and independent selected-platform attempts; verify integration tests cover no waiting on redirected input, late executable disappearance, partial success with nonzero exit, saved-state guidance, and successful identical retry without undoing earlier registrations.
- [x] 4.4 Update command help and README examples with multi-platform selection, noninteractive behavior, recovery, and current MCP scope; verify examples against fake platform CLIs and remove the current README's MCP deferral while retaining other existing scope limits.

## 5. Integration verification

- [x] 5.1 Build and pack the artifact, install into a temporary prefix, and exercise MCP save/selection/registration from an unrelated cwd with isolated state; verify catalog delivery, executable entrypoint, saved JSON, exact native calls, per-platform outcomes, and no modification of normal user platform configuration.
- [x] 5.2 Run typecheck and the full existing and new test suites; verify run, schedule, models, and plugin behaviors remain intact and record the tested OS/runtime/native CLI compatibility and any remaining platform limitations.
