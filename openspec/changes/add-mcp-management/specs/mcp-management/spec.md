# Spec Delta

## Purpose

Manage reusable local stdio MCP server definitions and register them with multiple installed agent platforms selected by the user.

## ADDED Requirements

### Requirement: Parse a stdio server definition
`hera mcp add <name> [--env KEY=value ...] -- <command> [args...]` SHALL require a nonempty safe server name and executable after an explicit `--`. It SHALL preserve command arguments literally and SHALL NOT start the MCP server. Shell line continuations SHALL represent one command.

#### Scenario: Continued command with server flags
- **WHEN** the shell supplies `hera mcp add demo -- npx -y package --port 3000` across continued lines
- **THEN** Hera saves executable `npx` and arguments `-y`, `package`, `--port`, `3000` in that order without interpreting shell syntax

#### Scenario: Invalid command input
- **WHEN** the name is empty or outside letters, numbers, dots, underscores, and hyphens, or the delimiter or executable is missing
- **THEN** Hera exits nonzero before saving or calling a platform

### Requirement: Accept repeated environment assignments
Hera SHALL accept zero or more `--env KEY=value` flags before `--`, split each at the first `=`, preserve the remainder including empty values, and require keys matching `[A-Za-z_][A-Za-z0-9_]*`. Repeated keys SHALL use the last supplied value.

#### Scenario: Multiple assignments and equals in values
- **WHEN** the input contains `--env TOKEN=a=b --env REGION=eu --env REGION=us --env EMPTY=`
- **THEN** the saved environment contains `TOKEN` equal to `a=b`, `REGION` equal to `us`, and `EMPTY` equal to an empty string

#### Scenario: Malformed environment assignment
- **WHEN** an assignment lacks `=` or has an invalid key
- **THEN** Hera exits nonzero without saving or performing platform registration

### Requirement: Persist definitions before registration
Hera SHALL save versioned JSON in `~/.hera/mcp.config` with `version: 1` and a `servers` map keyed by name. Each definition SHALL contain `command`, `args`, and `env`. Saving SHALL complete before installation detection and platform selection. Missing state SHALL be treated as empty; invalid or unsupported-version state SHALL remain untouched and cause a nonzero exit.

#### Scenario: First addition
- **WHEN** a valid server is added with no existing registry
- **THEN** Hera saves its definition and reports the saved path before offering registration

#### Scenario: Damaged registry
- **WHEN** an existing registry cannot be parsed or validated
- **THEN** Hera reports the error, preserves its original contents, and makes no platform calls

### Requirement: Preserve saved definitions
Hera SHALL preserve unrelated servers and concurrent successful additions. An identical existing definition SHALL be reusable without duplication and SHALL allow registration again. A conflicting definition under the same name SHALL fail without overwriting saved state or configuring platforms.

#### Scenario: Retry registration
- **WHEN** the same server name, command, arguments, and environment are added again
- **THEN** Hera retains one definition and proceeds to platform selection

#### Scenario: Conflicting server name
- **WHEN** a saved name is supplied with different settings
- **THEN** Hera exits nonzero and preserves the saved definition

#### Scenario: Concurrent different additions
- **WHEN** two processes successfully save different server names
- **THEN** both definitions remain in the registry

### Requirement: Protect stored environment values
On systems supporting Unix permissions, Hera SHALL create the state directory with owner-only access and persist `mcp.config` with mode `0600`. Hera SHALL NOT display environment values in normal output or registration failure messages.

#### Scenario: Secret-bearing definition
- **WHEN** a server containing an API token is saved and registration fails
- **THEN** the registry has owner-only file permissions and Hera's output does not reveal the token

### Requirement: Distinguish support from installation
Hera SHALL ship a `platform.json` supported-platform catalog initially containing Codex (`codex`) and Claude Code (`claude`). Catalog membership SHALL NOT imply installation. Hera SHALL check executable availability separately and offer only available supported platforms for registration.

#### Scenario: Supported platform missing
- **WHEN** both platforms are in the catalog but only Codex is available
- **THEN** Codex is selectable and Claude Code is identified as unavailable

#### Scenario: No platforms installed
- **WHEN** no catalog platform executable is available
- **THEN** Hera reports the saved definition and absence of available platforms, exits successfully, and makes no registration calls

### Requirement: Select multiple platforms after saving
In an interactive terminal, Hera SHALL allow selection of one or more available platforms or skipping all. In a noninteractive session, Hera SHALL save and report that registration was skipped without waiting for input. Cancellation during selection SHALL retain the definition and perform no registration.

#### Scenario: Multiple selection
- **WHEN** the user selects Codex and Claude Code
- **THEN** Hera attempts registration for both selected platforms only

#### Scenario: Skip selection
- **WHEN** the user skips or input is noninteractive
- **THEN** Hera retains the server, makes no registration calls, and exits successfully

#### Scenario: Interrupt selection
- **WHEN** the user interrupts the selection prompt
- **THEN** Hera exits with cancellation status, retains the server, and registers it nowhere

### Requirement: Register through platform-native interfaces
Hera SHALL register selected definitions in each platform's user configuration through its native CLI, preserving unrelated settings and exact command arguments and environment values. It SHALL invoke adapters without shell evaluation. Existing identical user-scope registrations SHALL count as success; differing registrations with the same name SHALL be reported as conflicts without replacement.

#### Scenario: Register with Claude user scope
- **WHEN** Claude Code is selected
- **THEN** the definition is registered in user scope rather than the current project's local configuration

#### Scenario: Existing conflicting platform server
- **WHEN** a selected platform already has a different user-scope server with the same name
- **THEN** Hera reports that platform's conflict without replacing it or modifying unrelated settings

#### Scenario: Literal arguments
- **WHEN** an argument contains spaces, quotes, or shell metacharacters
- **THEN** the platform receives the same argument as one value without Hera evaluating it

### Requirement: Report partial registration outcomes
Hera SHALL attempt all selected platforms independently and report success or failure for each. If any selected registration fails, Hera SHALL exit nonzero, identify that the definition remains saved, and retain successful registrations. Registering again with the identical definition SHALL permit recovery.

#### Scenario: One platform fails
- **WHEN** Codex registration succeeds and Claude registration fails
- **THEN** Hera reports both outcomes, retains the saved definition and Codex registration, and exits nonzero

### Requirement: Keep MCP support independent of execution support
Adding Claude Code to the MCP catalog SHALL NOT implicitly enable Claude execution, scheduling, model discovery, or plugin installation.

#### Scenario: Claude execution still unsupported
- **WHEN** Claude MCP registration is supported but no execution adapter exists and the user requests `hera run --provider claude`
- **THEN** Hera continues to report the unsupported execution provider
