## ADDED Requirements

### Requirement: Parent Todo Editing
A parent SHALL be able to edit the title, date-only due value, and scalar assignee of an active Todo, including an overdue Todo because overdue is derived rather than a lifecycle state. Title SHALL remain non-empty with no product-defined maximum length. Due date SHALL remain optional, date-only, clearable, and allowed in the past. Assignee SHALL remain exactly one active member of the same household. Completed and archived Todos SHALL NOT permit title, due-date, or assignee edits.

#### Scenario: Parent reassigns active Todo
- **WHEN** a parent assigns an active Todo to another active household member
- **THEN** the new assignee sees it in their active list and the former assignee no longer does

#### Scenario: Invalid edit assignee
- **WHEN** a parent attempts to assign an active Todo to a removed or cross-household member
- **THEN** the edit is rejected and the current assignee remains unchanged

#### Scenario: Parent edits completed Todo
- **WHEN** a parent attempts to change title, due date, or assignee on a completed Todo
- **THEN** the edit is rejected and the completed record remains unchanged

### Requirement: Parent Archive and Restore
A parent SHALL be able to archive an active or complete Todo and restore an archived Todo. Archiving SHALL record whether the pre-archive state was active or completed. Restore SHALL return the Todo to that pre-archive state; an active Todo with a past due date SHALL display as overdue after restore. While archived, a Todo SHALL be absent from active lists and SHALL NOT be edited, relabelled, completed, undone, or reopened by any parent or child.

#### Scenario: Parent archives active Todo
- **WHEN** a parent archives an active Todo
- **THEN** it moves to history and the assignee cannot complete it

#### Scenario: Parent restores completed Todo
- **WHEN** a parent restores a Todo that was completed immediately before archival
- **THEN** it returns to completed history with its completion metadata unchanged and does not enter the child's active list

#### Scenario: Parent completes archived Todo
- **WHEN** a parent attempts to complete an archived Todo
- **THEN** the request is rejected and the Todo remains archived

### Requirement: Role-Scoped History
Parents SHALL be able to view household Todo history, providing the first parent-visible completion result after the initial Todo slice. A child SHALL be able to view only completed and archived Todos currently assigned to that child. Children SHALL have no access to another member's history. Profile identity SHALL resolve from the current member profile while that member exists.

#### Scenario: Child opens history
- **WHEN** a child opens history
- **THEN** completed and archived Todos assigned to that child are displayed, with undo available only for the child's own completed Todos and no edit controls

#### Scenario: Parent verifies child completion
- **WHEN** a parent opens household history after a child completes an assigned Todo
- **THEN** the parent sees the completed Todo with its current assignee identity, completion actor, and completion timestamp

### Requirement: Completion Reversal
The completing child SHALL be able to undo their own completed Todo from history, and any parent SHALL be able to reopen a completed household Todo. Undo and reopen SHALL use the same conditional transition from completed to active. The transition SHALL clear completion metadata and return the Todo to the current assignee's active list, where overdue is derived from its due date.

#### Scenario: Child undoes own completion
- **WHEN** a child activates undo on a completed Todo that they completed and that remains assigned to them
- **THEN** the Todo returns to their active list and completion actor/time are cleared

#### Scenario: Child attempts to undo parent completion
- **WHEN** a child attempts to undo a Todo completed by a parent
- **THEN** the request is denied and the Todo remains completed

### Requirement: Explicit Parent Deletion

Only a parent SHALL be able to delete a Todo from the product, including an active, completed, or archived Todo.

#### Scenario: Deletion confirmation and restricted audit retention

- **WHEN** Todo deletion is requested, confirmed, retained for audit, or affected by full account removal
- **THEN** The application SHALL require explicit confirmation and SHALL explain that the Todo disappears from all user-visible lists and history.
- **AND** Deletion SHALL retain a full restricted internal audit snapshot of the deleted Todo and completion metadata.
- **AND** The audit snapshot SHALL NOT appear in product APIs or user interfaces and SHALL be purged when full account removal requires deletion of the associated member's data.

#### Scenario: Parent cancels deletion
- **WHEN** a parent dismisses the deletion confirmation
- **THEN** the Todo remains unchanged

#### Scenario: Parent confirms deletion
- **WHEN** a parent confirms deletion of a Todo
- **THEN** the Todo disappears from all active and history views while a restricted full audit snapshot remains unavailable to product users

### Requirement: Lifecycle Conflict Safety
Edits and lifecycle writes SHALL use conflict detection and SHALL return current state when a Todo changed elsewhere. The application SHALL provide refresh or retry recovery without silently discarding a confirmed edit or transition.

#### Scenario: Concurrent archive and completion
- **WHEN** a parent archives a Todo while a child completes an earlier version
- **THEN** at most one transition succeeds and the other caller receives current state with recovery guidance

#### Scenario: Concurrent parent edits
- **WHEN** two parents submit different edits from the same Todo version
- **THEN** one edit succeeds and the other parent receives the current state without overwriting the first edit
