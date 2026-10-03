# Design

## Context

The repository contains OpenSpec configuration and skills but no application, package metadata, tests, or existing specs. See proposal.md for motivation and scope. The user selected npm distribution, automatic scheduler startup on registration, no reboot autostart, explicit command syntax, and home-directory JSON storage.

Read-only inspection found Codex CLI 0.160.0 installed. It exposes `exec`, `plugin add`, `plugin marketplace`, and an experimental `app-server`, but no top-level models-list command or `plugin install` subcommand. Official [app-server documentation](https://learn.chatgpt.com/docs/app-server) describes paginated `model/list`. Official [plugin packaging documentation](https://developers.openai.com/plugins/build/plugins) describes local marketplace entries. These interfaces require adapter-specific handling; no provider operations were performed during planning.

## Goals / Non-Goals

**Goals:** Keep command parsing, scheduling, persistence, and logs independent of Codex. Support provider-native configuration and authentication without Hera making direct inference API calls. Make background execution and concurrent file updates predictable.

**Non-Goals:** Building an agent loop, storing account credentials, implementing Claude in this change, standalone skill/MCP management, OS startup services, remote hosting, and npm publication during implementation.

## Decisions

### Runtime and modules

Use TypeScript compiled to Node.js-compatible JavaScript, Commander for commands, Zod for input and disk validation, Croner for cron evaluation, and Vitest for tests. Use Node built-ins for process spawning and filesystem operations. Publishable package metadata exposes `bin.hera`; select an available package name before publishing. Prefer this to Go because npm distribution is confirmed. Pin and record dependency versions during implementation.

Organize source into CLI handlers, provider registry/adapters, a shared runner/logger, storage, and scheduler modules. Adapters expose execution, model discovery, and plugin installation capabilities; shared records use provider strings and contain no Codex wire types. Only `codex` is registered initially. Unknown providers or unsupported capabilities fail clearly rather than falling back to another provider.

### Exact public commands

```text
hera run --provider codex --model "gpt-6.1" --prompt "Test"
hera schedule --provider codex --model "gpt-6.1" --prompt "Test" --cron "0 9 * * *" --name "daily-test"
hera list schedule
hera schedule remove "daily-test"
hera plugin install --provider codex --path "./my-plugin"
hera list plugins
hera list models --provider codex
```

All shown flags are required for their commands. Preserve model values verbatim; `gpt-6.1` is the user's example, not a promise of availability or an alias Hera should rewrite. Register `schedule` with a creation action and a `remove` subcommand so creation flags are not required for removal. Use `list schedule`, never `schedule list`. MCP commands and `mcp.json` are deferred.

### Execution and logging

Spawn the provider with an argument array, no shell, in the invoking command's working directory. For Codex use noninteractive `exec`, the supplied model, and the prompt on stdin; consume structured output and stderr while preserving both in logs. Preserve provider permission controls and do not inject bypass flags. Reuse provider authentication; never copy credentials into Hera JSON files.

One `run` creates exactly one provider task invocation, waits for completion, flushes logs, and exits. Hera does not retry, schedule, resume, or send another prompt automatically. This does not limit the provider's internal tool calls. Propagate nonzero outcomes, handle spawn failures, and forward termination to the child. Failure to create a log prevents execution; a log failure during execution cancels the child and reports failure.

Proposed naming default: generate `run-<UTC timestamp>-<random suffix>` for ad hoc runs, with no new public flag. Print the session name and log path to stderr. Scheduled executions use the schedule name and append to its log. Include execution IDs, timestamps, stream labels, and completion/exit status to distinguish repeated executions. Keep bounded memory by streaming to `~/.hera/<provider>/<session-name>.log`; do not load full outputs into memory. Keep log filenames inside the provider directory by validating names.

### Persistent state

Use versioned JSON envelopes: `schedule.json` contains `{version: 1, schedules: [...]}` and `plugins.json` contains `{version: 1, plugins: [...]}`. A schedule stores name, provider, model, prompt, cron, absolute cwd, time zone, and creation timestamp. A plugin record stores provider, manifest name/version if present, canonical source path, provider installation identity, installed path if returned, and installation timestamp. Do not store secrets or a copied environment.

Missing files represent empty registries; first writes create them. Corrupt files and unsupported versions fail visibly and remain untouched. Serialize read-modify-write operations with a recoverable cross-process lock, reread under the lock, then write a temporary sibling and atomically rename. Keep runtime ownership/heartbeat information separately under `~/.hera/runtime/`; it is disposable, unlike task definitions. Protect runtime files and state with user-only permissions where supported. JSON fits the requested layout and small local workload; SQLite would change the requested persistence contract.

### Scheduler lifecycle and timing

After validating and saving a new task, registration ensures one detached Node scheduler is running and waits for a bounded readiness acknowledgement. No cron entry, launch agent, service, or login item is installed. Use a singleton lease with an owner token and heartbeat, backed by exclusive acquisition and stale-owner recovery; verify ownership before dispatch. PID alone is insufficient because of reuse. The background process detaches from terminal stdio and persists independently of the CLI parent. Record diagnostics in `~/.hera/runtime/scheduler.log`.

Poll persisted schedules at a short bounded interval (one second proposed) and reconcile additions/removals, also rereading authoritative state before dispatch. Registration waits until its persisted task is observed. If startup or acknowledgement fails, report that the schedule was saved but is inactive; an identical registration retries scheduler startup without duplicating the entry. Reject a reused name with different task fields. This permits recovery after reboot using the same command and avoids adding a public daemon command.

Proposed defaults for review: standard five-field cron; capture the host's IANA time zone and absolute cwd at registration. Compute future instants using that stored zone, including DST. Skip nonexistent local times and run once per matching real instant during repeated local times. Do not replay missed executions after downtime or sleep. Skip a due occurrence if that same schedule is still running and log the skip; independent schedules can execute concurrently. Each occurrence has no automatic retry. Removing a schedule prevents future launches, preserves logs, and lets an already running occurrence finish. Stop an idle scheduler once no schedules or active children remain.

No reboot autostart is installed. Listings and one-shot runs do not start the scheduler. A later registration restarts it and loads all saved tasks. The scheduler is not an exactly-once distributed execution system; crashed occurrences are not replayed. Maintain an occurrence claim and active-child state in disposable runtime storage so lease recovery does not relaunch a claimed occurrence or overlap a still-running child.

### Model discovery

Use a short-lived Codex app-server process over stdio, perform its initialization handshake, request all pages of `model/list`, then close it. Display provider-returned identifiers and names without maintaining a hard-coded model catalog. Treat the result as a provider catalog, not an entitlement guarantee. Apply a bounded discovery timeout and report protocol/version errors rather than scraping terminal menus or querying a model API directly. Keep this protocol inside the Codex adapter and fixture-test it.

### Plugin installation

Validate the local directory and supported manifest before side effects. Copy the package into a Hera-owned marketplace root under `~/.hera/providers/codex/`, with relative entries inside that root. Register that marketplace with `codex plugin marketplace add`, then install its selector with `codex plugin add ... --json`. Preserve unrelated provider configuration and let Codex handle native activation, caches, and trust. Existing hooks are not automatically trusted by Hera.

Only commit an installed record to `plugins.json` once the provider confirms installation. Reinstalling a provider/name updates one record after success rather than appending duplicates. If provider installation succeeds but registry persistence fails, report the partial outcome and make retry converge on the existing installation. Stage and serialize marketplace updates to avoid conflicting plugin installs. `hera list plugins` displays Hera-recorded installations across providers, not a scan of every externally installed plugin. Plugin-contained skills remain provider-managed; no separate skill command is added.

## Risks / Trade-offs

- Provider CLI and experimental protocol changes -> keep version/capability checks, fixture tests, actionable unsupported-version errors, and document the tested Codex version. Validate the local marketplace flow with a harmless skill-only fixture during implementation.
- JSON races or crashes -> locked updates, atomic replacement, corruption preservation, and concurrent-process tests.
- Background process and signal differences by OS -> detached-process lifecycle tests on supported npm platforms; document verified platform coverage in the README before release.
- No reboot or crash supervisor -> saved schedules can remain inactive until registration restarts the scheduler; show running/inactive status in schedule listings.
- Unbounded output retention -> stream rather than buffer; log rotation is deferred and logs remain user-managed.
- Partial provider installation -> report native success separately from registry failure and support retry convergence.

## Migration Plan

This is greenfield: create the package, test its packed tarball in a temporary npm prefix, and initialize home-directory files lazily. Validate with fake providers and a harmless plugin fixture, avoiding paid inference by default. Document installation, provider login prerequisites, commands, log paths, scheduler lifetime, and defaults. Publication is separate. Rollback removes the npm package and stops its scheduler by the documented process identifier; retain user state/logs unless explicitly removed. No startup entries require cleanup.

## Open Questions

- npm package name or scope before publication; the executable remains `hera`.
