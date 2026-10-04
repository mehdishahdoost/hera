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
| `hera mcp add <name> [--env KEY=value ...] -- <command> [args...]` | Save a stdio MCP server and select installed platforms. |

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

## MCP servers

Save one server definition, then select one or more installed platforms:

```sh
hera mcp add my-server \
  --env API_KEY=value \
  --env REGION=eu \
  -- npx -y some-mcp-package --port 3000
```

Your shell handles the line continuations. Everything after the explicit `--` is the executable and its literal arguments; Hera does not launch the server or interpret a shell script. Environment flags are repeatable, split at the first `=`, allow empty values, and use the last assignment when a key is repeated. Environment keys use letters, digits, and underscores and cannot begin with a digit. Server names use letters, digits, dots, underscores, and hyphens; they cannot begin with a hyphen or be `.` or `..`.

Hera saves versioned JSON in `~/.hera/mcp.config` before offering registration:

```json
{
  "version": 1,
  "servers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "some-mcp-package", "--port", "3000"],
      "env": { "API_KEY": "value", "REGION": "eu" }
    }
  }
}
```

The bundled `platform.json` catalog lists supported platforms: Codex and Claude Code. Hera checks executable availability separately; a catalog entry does not mean the platform is installed. `CODEX_BIN` and `CLAUDE_BIN` override their executable paths. Claude MCP registration does not enable Claude execution, scheduling, models, or plugins in Hera.

In a terminal, enter comma-separated numbers or ids such as `1,2` or `codex,claude`. Nothing is selected by default. Press Enter or type `skip` to keep the saved definition without registration. Missing platforms are reported as unavailable. With no installed platforms or noninteractive input/output, Hera saves and exits successfully without prompting. Ctrl-C during selection leaves the definition saved and cancels registration.

Adapters register in user scope using native `codex mcp add <name> --env KEY=value -- <command> ...` or `claude mcp add --scope user --transport stdio <name> --env KEY=value -- <command> ...`. Existing identical definitions are accepted; conflicting saved or platform user definitions are preserved and reported. Hera attempts every selected platform independently and returns a nonzero exit on partial failure. Repeat the identical command in a terminal to retry; successful registrations remain intact. Avoid concurrent changes to the same platform server through other tools: native configuration calls cannot provide a transaction spanning third-party writers.

Registration confirms configuration, not server connectivity. Claude user configuration is inspected read-only because its native inspection commands can start servers for health checks. HTTP servers, update/removal/list commands, and arbitrary platform extensions are outside this version's MCP scope.

Environment values are plaintext in Hera and platform configuration. On Unix, new Hera state directories use mode `0700` and the registry uses `0600`; Windows relies on profile ACLs. Values passed on your command line may also enter shell history or be visible in process arguments. Hera does not echo environment values or raw native CLI diagnostics.

Native MCP registration was verified in isolated configuration with Codex CLI 0.160.0 and Claude Code 2.1.116 on Linux/Node.js 22.22.0. Windows executable discovery recognizes PATHEXT; native `.cmd`/`.bat` launchers require an executable override because Hera does not evaluate them through a shell. Windows and macOS native registration remain unverified.

## Logs and local state

| Path | Contents |
| --- | --- |
| `~/.hera/schedule.json` | Saved schedules. |
| `~/.hera/plugins.json` | Successful plugin installation records. |
| `~/.hera/mcp.config` | Saved MCP commands, arguments, and explicit environment values. |
| `~/.hera/<provider>/<session-name>.log` | Provider stdout/stderr and execution status markers. |
| `~/.hera/runtime/` | Scheduler ownership, diagnostics, and occurrence records. |
| `~/.hera/providers/codex/marketplaces/` | Staged local plugin marketplaces. |

One-shot runs get generated names such as `run-20261003205842962-ce7bab`. Scheduled runs use the schedule name and append execution records to the same log.

The registries use a JSON envelope with `"version": 1`. Schedule records contain `name`, `provider`, `model`, `prompt`, `cron`, `cwd`, `timeZone`, and `createdAt`. Plugin records contain `provider`, `name`, optional `version`, `sourcePath`, `providerId`, and `installedAt`.

Missing registries are treated as empty. Malformed or unsupported files produce an error and are preserved. Schedule and plugin records do not copy credentials or environments; MCP records store only the environment values explicitly supplied with `--env`.

### Environment variables

- `CODEX_BIN`: override the Codex executable path; defaults to `codex` from `PATH`.
- `CLAUDE_BIN`: override the Claude Code executable path for MCP registration; defaults to `claude` from `PATH`.
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

Codex is the only implemented execution provider. MCP registration supports Codex and Claude Code. Claude execution and automatic startup after reboot are deferred.
# hera
