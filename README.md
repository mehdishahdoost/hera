<p align="center">
  <img src="assets/hera-logo.png" alt="Hera logo" width="600">
</p>

# Hera

Hera is a CLI harness for running and scheduling local AI agent CLIs. It calls the provider's installed CLI rather than an inference API. Codex is the first supported provider; the adapter structure allows additional providers in the future.

## Requirements

- Node.js 20 or newer and npm.
- An installed, authenticated Codex CLI available as `codex` on your `PATH`.
- A model supported by your provider account.

Development has been checked on Linux with Node.js 22.22.0 and Codex CLI 0.160.0. Other platforms still need scheduler lifecycle verification.

## Installation

Build and install from this repository:

```sh
npm install
npm run build
npm pack
npm install -g ./hera-agent-cli-0.1.0.tgz
```

If you already have the built package, install it directly:

```sh
npm install -g /path/to/hera-agent-cli-0.1.0.tgz
```

Confirm the installation:

```sh
hera
hera --version
```

Running `hera` without arguments prints help. Reinstall the package after rebuilding to update your installed CLI.

## Quick start

List the provider's model catalog:

```sh
hera list models --provider codex
```

Use an exact returned model ID in place of `<model-id>`:

```sh
hera run --provider codex --model "<model-id>" --prompt "hi"
```

Hera starts one provider invocation, streams its output, prints the session name and log path, and propagates its exit status. It does not retry the task or create a schedule. Codex output is streamed as JSON events.

Codex invocations include `--skip-git-repo-check`, so tasks can run outside Git repositories. Provider authentication, sandboxing, and execution permissions are managed by the provider CLI.

## Commands

| Command | Purpose |
| --- | --- |
| `hera run --provider codex --model "<model-id>" --prompt "Test"` | Run a task once. |
| `hera schedule --provider codex --model "<model-id>" --prompt "Test" --cron "0 9 * * *" --name "daily-test"` | Register a recurring task and start the scheduler. |
| `hera list schedule` | List saved schedules and scheduler status. |
| `hera schedule remove "daily-test"` | Remove a schedule. |
| `hera plugin install --provider codex --path "./my-plugin"` | Install a local provider plugin. |
| `hera list plugins` | List plugins recorded by Hera. |
| `hera list models --provider codex` | List the provider's model catalog. |

Use `hera --help` or a command's `--help` flag for its available options.

## Scheduling

Register a daily task at 09:00:

```sh
hera schedule --provider codex --model "<model-id>" --prompt "Review this project" --cron "0 9 * * *" --name "daily-review"
```

Cron expressions must contain five fields: minute, hour, day of month, month, and day of week. Hera captures the current working directory and local time zone at registration and uses them for subsequent invocations.

Schedule names are globally unique. Registering an identical schedule again preserves its record and starts the scheduler if needed. Conflicting definitions using the same name are rejected.

Registering a schedule automatically starts a detached background scheduler. It continues after the terminal closes and exits once the final schedule has been removed and active invocations have finished. Removing a schedule keeps its logs and allows an active invocation to finish.

Hera skips missed occurrences, avoids overlapping invocations of the same task, and does not automatically retry failed occurrences.

Hera does not start automatically after a computer reboot. Saved schedules remain on disk; register an identical saved schedule again to restart the scheduler. If startup fails, Hera reports that the schedule was saved but is inactive.

Runtime ownership and diagnostics are stored under `~/.hera/runtime/`. To stop the scheduler manually on Linux, read the PID from `~/.hera/runtime/scheduler.json` and run `kill <pid>`.

## Plugins

Install a local plugin directory:

```sh
hera plugin install --provider codex --path "./my-plugin"
hera list plugins
```

The directory must contain a valid `plugin.json` or `.codex-plugin/plugin.json` manifest with a plugin name. Hera stages a local marketplace under its state directory, calls Codex's plugin installation commands, and records successful installations in `~/.hera/plugins.json`. Activation is managed by Codex.

`hera list plugins` lists Hera's installation records, rather than every plugin installed directly through the provider.

## Logs and local state

| Path | Contents |
| --- | --- |
| `~/.hera/schedule.json` | Saved schedules. |
| `~/.hera/plugins.json` | Successful plugin installation records. |
| `~/.hera/<provider>/<session-name>.log` | Provider stdout/stderr and execution status markers. |
| `~/.hera/runtime/` | Scheduler ownership, diagnostics, and occurrence records. |
| `~/.hera/providers/codex/marketplaces/` | Staged local plugin marketplaces. |

One-shot runs get generated names such as `run-20261003205842962-ce7bab`. Scheduled runs use the schedule name and append execution records to the same log.

The registries use a JSON envelope with `"version": 1`. Schedule records contain `name`, `provider`, `model`, `prompt`, `cron`, `cwd`, `timeZone`, and `createdAt`. Plugin records contain `provider`, `name`, optional `version`, `sourcePath`, `providerId`, and `installedAt`.

Missing registries are treated as empty. Malformed or unsupported files produce an error and are preserved. Credentials and environment variables are not copied into registry records.

### Environment variables

- `CODEX_BIN`: override the Codex executable path; defaults to `codex` from `PATH`.
- `HERA_HOME`: override the home directory used by Hera. State is stored in `<HERA_HOME>/.hera`; useful for isolated testing.

## Troubleshooting

### Unsupported model

If Codex reports that a model is unsupported for your account, run:

```sh
hera list models --provider codex
```

Choose an exact model ID from the returned catalog. Hera forwards your model selection unchanged. The catalog does not guarantee account access to every listed model; the provider's response determines whether the account can use it.

### No output when running `hera`

The current build prints help when invoked without arguments. Rebuild and reinstall the package if an older installation exits silently.

### Provider executable not found

Ensure `codex` is on your `PATH`, or set `CODEX_BIN` to its executable path. Authenticate using the provider CLI before running Hera tasks.

## Development

```sh
npm install
npm run build
npm run typecheck
npm test
```

Run the source CLI during development:

```sh
npm run hera -- --help
```

The npm executable is built at `dist/index.js`.

## Current scope

Codex is the only implemented provider. Claude Code support is planned. Standalone MCP commands and automatic startup after reboot are deferred.
# hera
