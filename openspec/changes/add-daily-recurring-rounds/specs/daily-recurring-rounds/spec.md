## ADDED Requirements

### Requirement: Daily Recurrence Template

A parent SHALL be able to create, edit, and remove a daily recurrence template with Todo title, optional label, one active household assignee, and a daily cadence.

#### Scenario: Template generation and revision boundaries

- **WHEN** a daily template is created, revised, removed, or used to generate a round
- **THEN** The template SHALL generate ordinary Todo records carrying template ID and round key metadata.
- **AND** Creation SHALL begin generation at the next household-local day boundary, not during the already-started day.
- **AND** Editing or removing a template SHALL affect only future generation; removal SHALL retire the template, prevent future Todos, and preserve all already-generated current and historical Todos.

#### Scenario: Parent creates daily template
- **WHEN** a parent creates a valid daily template for a child
- **THEN** no Todo is created for the already-started day and one active generated Todo is eligible at the next household-local day boundary

#### Scenario: Parent edits template after generation
- **WHEN** a parent edits a template after the current round's Todo already exists
- **THEN** the existing Todo remains unchanged and the edited values apply to later generated Todos

#### Scenario: Parent removes template with current Todo
- **WHEN** a parent removes a template after the current Todo was generated
- **THEN** the current Todo remains under ordinary lifecycle rules, history is preserved, and no later Todo is generated

### Requirement: Non-Intrusive Round Rollover
At the end of a household-local day, an incomplete active generated Todo SHALL become `MISSED`; a completed generated Todo remains `COMPLETED`; and a skipped generated Todo remains `SKIPPED`. The next day's generated Todo SHALL be independent. Prior-day generated Todos SHALL NOT appear in the default active list. `MISSED` and `SKIPPED` SHALL be recurrence-outcome states on generated Todo records, not generic archived reasons.

#### Scenario: Missed daily occurrence
- **WHEN** a daily occurrence remains incomplete after its local day ends
- **THEN** it is visible only in history as missed and the next day's occurrence can appear in the active list

### Requirement: Parent Skip and Child History Protection
A parent SHALL be able to invoke the ordinary Archive action on a rollover-bound active generated Todo, which SHALL record `SKIPPED` without a reason rather than generic `ARCHIVED`. Skip SHALL be irreversible. Children SHALL be able to view their own completed, missed, and skipped generated Todo history. Children SHALL NOT alter missed or skipped rounds, but the ordinary completed-Todo undo rule applies to any completed generated round.

#### Scenario: Parent skips current occurrence
- **WHEN** a parent archives a current occurrence
- **THEN** it is recorded as skipped and is removed from the child's active list

#### Scenario: Parent attempts to restore skip
- **WHEN** a parent attempts to return a skipped generated Todo to active
- **THEN** the request is rejected and the Todo remains skipped

### Requirement: Generated Todo Lifecycle

An active generated Todo SHALL support the same parent title, due-date, assignee, label, completion, and confirmed product-deletion rules as an active one-off Todo.

#### Scenario: Generated record lifecycle constraints

- **WHEN** a generated Todo is completed, edited, deleted, undone, reopened, or retained in history
- **THEN** Completed generated Todos SHALL follow the same completed immutability rules as one-off Todos.
- **AND** Historical `MISSED` and `SKIPPED` generated Todos SHALL reject metadata edits.
- **AND** Deleting one generated Todo SHALL NOT change its template or any other round.
- **AND** Editing the due date to any valid date SHALL detach that Todo from automatic round-end rollover while preserving template and round metadata.
- **AND** Undoing or reopening any completed generated Todo SHALL also detach it from rollover and return it to the default active list until completed, skipped, or deleted.

#### Scenario: Parent edits current generated Todo
- **WHEN** a parent edits an active generated Todo
- **THEN** the current Todo changes under ordinary validation and later generated Todos continue to use the template values

#### Scenario: Parent edits generated due date
- **WHEN** a parent changes an active generated Todo's due date to any valid date
- **THEN** the Todo preserves its template/round metadata but no longer becomes missed automatically at the original round end

#### Scenario: Parent reopens prior completed round
- **WHEN** a parent reopens a completed generated Todo from any prior round
- **THEN** it returns to the default active list, is detached from round rollover, and remains active until completed, skipped, or deleted

#### Scenario: Parent deletes one generated Todo
- **WHEN** a parent confirms deletion of one generated Todo
- **THEN** that Todo disappears under ordinary audit-snapshot rules and its template continues generating future rounds

### Requirement: Parent Corrects Missed Outcome
A parent SHALL be able to change a historical `MISSED` generated Todo to `COMPLETED`. The system SHALL replace the missed outcome without retaining it as prior state and SHALL record the correcting parent and correction time as completion actor and timestamp. Children SHALL NOT perform this correction.

#### Scenario: Parent corrects missed Todo
- **WHEN** a parent marks a missed generated Todo completed
- **THEN** it appears as completed with that parent and correction time as completion metadata and does not return to the active list

### Requirement: Idempotent Occurrence Generation
The system SHALL create at most one generated Todo per template and household-local date, using that date as the daily round key. Repeated generation attempts, retries, and concurrent requests SHALL return the same Todo rather than duplicates. Generation SHALL execute server-side without depending on household login activity.

#### Scenario: Generator retries
- **WHEN** generation runs more than once for the same template and date
- **THEN** only one occurrence exists

### Requirement: Current-Round Reconciliation Without Backfill
If scheduled generation fails, server-side reconciliation SHALL create the current round's Todo when it next runs, but SHALL NOT create generated Todos for fully elapsed missing dates. The gap SHALL remain absent from history.

#### Scenario: Generation resumes after multi-day outage
- **WHEN** generation resumes after one or more household-local days were entirely missed
- **THEN** the system creates at most the current day's active Todo and does not backfill elapsed days as missed

### Requirement: Recurrence Tenant Isolation
Every template and generated-Todo operation SHALL verify active household membership and resource ownership server-side. A client-supplied template or Todo identifier SHALL NOT authorize access.

#### Scenario: Cross-household template identifier
- **WHEN** a parent submits a template identifier owned by another household
- **THEN** the request is denied without disclosing the template or its generated Todos

### Requirement: Accessible Routine Views

Routine and history views SHALL identify the recurrence title, date, state, and assignee using visible text and accessible labels.

#### Scenario: Routine history presentation and feedback

- **WHEN** routine or history views display records or operation feedback
- **THEN** Member history SHALL keep ordinary chronological ordering and present each `MISSED` generated Todo with explicit status text and a restrained red warning indicator that is not the sole status signal.
- **AND** The application SHALL NOT add a separate trends page, aggregation, chart, date presets, special missed-first sort, or missed-only filter.
- **AND** Views SHALL provide loading, empty, generation-failure, retry, and reduced-motion feedback states.

#### Scenario: Generation failure
- **WHEN** current occurrences cannot be generated
- **THEN** the parent receives a recoverable error and the UI does not claim that current routine work is complete

### Requirement: Recurrence Removal Cascade
The recurrence capability SHALL extend full child-account removal to delete templates assigned to that child, every generated Todo and recurrence history record associated with the child, and any restricted audit snapshot of those records. No future Todo SHALL be generated for the removed child, and username reuse SHALL remain blocked until the cascade succeeds.

#### Scenario: Parent removes child with recurring work
- **WHEN** a parent confirms full removal of a child with assigned templates and generated Todo history
- **THEN** the templates, generated Todos, recurrence history, and associated audit snapshots are deleted and no later generation targets the child
