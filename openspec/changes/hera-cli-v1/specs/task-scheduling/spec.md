# Spec Delta

## Purpose

Persist named recurring agent tasks and execute them through a local background scheduler that starts automatically when a schedule is registered.

## ADDED Requirements

### Requirement: Register persistent schedules
`hera schedule` SHALL require provider, model, prompt, cron, and name flags and persist each task in `~/.hera/schedule.json`. It SHALL capture the current absolute working directory and local time zone for later execution.

#### Scenario: Register a task
- **WHEN** the user runs `hera schedule --provider codex --model "gpt-6.1" --prompt "Test" --cron "0 9 * * *" --name "daily-test"`
- **THEN** the saved entry contains the supplied values, registration working directory, and time zone

#### Scenario: Invalid task definition
- **WHEN** a required value is empty, the provider is unknown, the cron is not a valid five-field expression, or the name is unsafe for a filename
- **THEN** registration fails without changing saved tasks or starting a scheduler

### Requirement: Unique schedule names
Schedule names SHALL be unique across providers. Registering an identical existing definition SHALL preserve one entry and ensure scheduler startup. Reusing a name with different task fields SHALL fail without overwriting it.

#### Scenario: Recover an existing schedule
- **WHEN** the same registration is issued again with the same execution context
- **THEN** Hera keeps one entry and ensures the scheduler is running

#### Scenario: Conflicting name
- **WHEN** an existing name is registered with a different prompt or provider
- **THEN** Hera reports the conflict and preserves the original definition

### Requirement: Automatic background startup
Successful registration SHALL ensure exactly one scheduler per user is running and has observed the saved task. The scheduler SHALL survive terminal closure. Startup failure SHALL report nonzero status and explicitly identify that the task remains saved but inactive.

#### Scenario: First registration
- **WHEN** a task is registered while no scheduler is running
- **THEN** Hera starts the scheduler in the background and confirms readiness before reporting success

#### Scenario: Concurrent registrations
- **WHEN** two registration commands run concurrently
- **THEN** both tasks remain saved and only one scheduler owns dispatch

#### Scenario: Background startup fails
- **WHEN** the task is persisted but the scheduler fails to become ready
- **THEN** the command reports the saved-but-inactive state and an identical registration can retry startup

### Requirement: No reboot autostart
Hera SHALL NOT install reboot or login startup integration. Saved tasks SHALL remain inactive after reboot until registration starts the scheduler again. List commands and one-shot runs SHALL NOT start it.

#### Scenario: List after reboot
- **WHEN** the computer has rebooted and the user runs `hera list schedule`
- **THEN** saved tasks are displayed with inactive scheduler status and no scheduler is launched

### Requirement: Scheduled execution semantics
The scheduler SHALL launch each future due occurrence once in the saved directory and time zone. It SHALL skip missed occurrences and overlapping occurrences of the same task, preserve provider logs, and not automatically retry failed invocations.

#### Scenario: Daily execution
- **WHEN** a `0 9 * * *` task becomes due in its stored time zone
- **THEN** the scheduler launches the provider with its stored prompt, model, and directory

#### Scenario: Overlapping occurrence
- **WHEN** a task becomes due while its previous invocation is still running
- **THEN** the new occurrence is skipped and the skip is logged

#### Scenario: Resume after downtime
- **WHEN** the scheduler resumes after one or more due times have passed
- **THEN** it schedules future occurrences without replaying the missed ones

#### Scenario: Daylight saving transition
- **WHEN** a stored time zone has a nonexistent or repeated matching local time
- **THEN** nonexistent times are skipped and repeated times execute once per matching real instant, subject to the overlap rule

#### Scenario: Stale scheduler ownership
- **WHEN** a scheduler exits unexpectedly and a registration starts a replacement
- **THEN** stale ownership is recovered without replaying claimed occurrences or overlapping an existing invocation of the same schedule

### Requirement: List and remove schedules
`hera list schedule` SHALL display saved task names, providers, models, prompts, cron expressions, directories, time zones, and scheduler status. `hera schedule remove "name"` SHALL remove the named task and prevent future dispatch while preserving logs and already running invocations.

#### Scenario: Empty registry
- **WHEN** no schedules have been registered
- **THEN** listing reports an empty list successfully

#### Scenario: Remove active schedule
- **WHEN** a schedule is removed while its invocation is running
- **THEN** the invocation can finish, its log remains, and no later occurrence starts

#### Scenario: Unknown name
- **WHEN** removal targets a name that does not exist
- **THEN** Hera exits nonzero and leaves other schedules untouched

### Requirement: Durable schedule updates
Schedule persistence SHALL preserve concurrent successful updates and leave corrupt or unsupported-version data untouched. Removing the final schedule SHALL allow the scheduler to exit once active invocations finish.

#### Scenario: Corrupt registry
- **WHEN** a command encounters invalid schedule data
- **THEN** it reports the problem and does not silently replace the file with an empty registry

#### Scenario: Last task removed
- **WHEN** no saved schedules or active invocations remain
- **THEN** the scheduler exits and a future registration can start it again
