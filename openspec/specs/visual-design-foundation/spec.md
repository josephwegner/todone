# visual-design-foundation Specification

## Purpose
Establish Todone's shared accessible visual language, role-aware shell, interaction feedback, and incremental design-review contracts for current and future application surfaces.

## Requirements

### Requirement: Mature Nature-Inspired Visual Language
Todone SHALL use one light-only, nature-inspired visual language built from deep forest anchors, profile-derived tonal personal surfaces, warm readable form/settings surfaces, and stable semantic state colors. The visual language SHALL define centralized authored tokens for color, typography, spacing, shape, elevation, iconography, focus, disabled, status, and motion states plus accessible tonal families for every canonical profile color. Framework utilities SHALL resolve through those authored tokens rather than making a stock framework palette the product language. It SHALL feel appropriate to adolescents and adults and SHALL NOT introduce mascots, animals, illustrated task objects, emoji decoration, points, streaks, rewards, rare/jackpot outcomes, sound, or vibration.

#### Scenario: Dense family surface uses the shared language
- **WHEN** a family-management or Todo surface presents primary actions with supporting metadata
- **THEN** the primary task remains visually clear, secondary information uses a predictable lower-emphasis hierarchy, and the screen uses shared semantic tokens rather than a feature-specific theme

#### Scenario: Visual styling communicates state
- **WHEN** color, weight, elevation, or motion reinforces identity, status, selection, success, warning, or error
- **THEN** visible text or semantics communicates the same meaning and the actual combination meets the applicable WCAG 2.2 AA requirement

#### Scenario: Member changes profile color
- **WHEN** a member selects another canonical profile color
- **THEN** their personal header and Todo canvas use the corresponding contrast-checked tonal family while actions, warnings, errors, lifecycle states, and accessible identity text retain their established meaning

#### Scenario: Header artwork is considered
- **WHEN** a design iteration proposes nature artwork beyond the default profile-to-forest gradient
- **THEN** the artwork is static, supplementary, visually reviewed at production quality, and omitted when it would read as generic clip art, childish identity imagery, or essential content

### Requirement: System-Compatible Typography and Components
Todone SHALL use a system-first sans-serif font stack that remains legible and structurally consistent across supported laptop, iPhone, and iPad browsers without requiring a remote font. Shared components SHALL use generous touch targets, restrained rounded geometry/elevation for genuinely bounded controls and surfaces, consistent outline icons, and responsive content hierarchy without clipping long family or Todo content. Active Todo lists SHALL present full-bleed continuous rows rather than a stack of individually floating cards.

#### Scenario: Preferred font is unavailable
- **WHEN** a device renders Todone using a fallback system font
- **THEN** headings, labels, controls, metadata, and Todo rows retain their intended hierarchy without overlap or truncation of essential content

### Requirement: Role-Prioritized Application Shell
The signed-in application shell SHALL use canonical `/todos` as the child landing destination. Until the Todo capability is delivered, `/todos` SHALL identify itself as work in progress and SHALL NOT fabricate data, controls, loading states, or availability. Once delivered, the shell SHALL prioritize assigned active Todos and completion for children. It SHALL provide parents a prominent keyboard-accessible path to create and assign a one-off Todo whenever that capability is available, while preserving clear household/member context and access to available family management and history. Responsive composition SHALL NOT change authorization or hide the only path to an available primary action.

#### Scenario: Child enters the application
- **WHEN** an active child session resolves successfully
- **THEN** the application routes to `/todos`; before Todo delivery it shows only a work-in-progress page, and after Todo delivery it shows that child's assigned active Todos with visually and semantically prominent completion actions

#### Scenario: Parent needs to assign work
- **WHEN** an active parent uses any supported viewport after Todo creation is available
- **THEN** a prominent labelled path to create and assign a Todo is available without navigating through account settings

### Requirement: Accessible Local Sign-Out
The child Todo landing surface SHALL expose a named, keyboard-accessible Sign out button. Sign-out SHALL clear local credentials and private presentation state and replace the route with sign-in even if SDK cleanup fails.

#### Scenario: Child signs out
- **WHEN** a signed-in child activates Sign out from `/todos`
- **THEN** sign-in is shown, local credentials and profile/membership presentation are cleared, and Back or reload cannot restore a private page without authentication

### Requirement: Stable Authenticated Navigation
A page SHALL consume session, membership, and profile prerequisites already resolved by its current route guard without repeating a full-page session-restoration state. Every navigation SHALL retain current authorization checks. Guard results SHALL be handed off only in memory and cleared on sign-out or a new navigation.

#### Scenario: Child moves between Todos and profile
- **WHEN** a child navigates from `/todos` to `/profile` and returns using Back
- **THEN** the destination heading receives focus without a repeated session-restoration screen, and each navigation still checks current membership and profile

### Requirement: Rewarding Server-Confirmed Completion Feedback
Todo completion feedback SHALL begin its celebratory phase only after the server confirms success. The confirmed interaction SHALL provide a brief, local pop and one of a small reviewed family of equally prominent nature-inspired light/shape/motion treatments, resolve the row to an explicitly completed lower-emphasis appearance, and remove it from the active list within a few seconds. The client SHALL select the effect by hashing the stable Todo ID into the approved effect list so retry/reopen behavior is deterministic without persisted reward state. Selection SHALL NOT assign, communicate, collect, or reward rarity. Feedback SHALL NOT use sound, vibration, emoji, scores, streaks, or motion that blocks the next action. A visible labelled control SHALL remain available even if supplementary swipe completion is implemented.

#### Scenario: Completion succeeds
- **WHEN** the server confirms that an authorized actor completed an active Todo
- **THEN** the row presents a brief completion celebration and completed state before leaving the active list, the result is announced, and focus moves to the next useful target

#### Scenario: Completion fails
- **WHEN** the completion write fails
- **THEN** no celebration or removal occurs, the Todo remains actionable, and accessible retry feedback is provided

#### Scenario: Reduced motion is requested
- **WHEN** the user prefers reduced motion and completion succeeds
- **THEN** particles, glitter, translation, scaling, and animated collapse are omitted while the same completion state, announcement, removal, and focus outcome remain available

#### Scenario: Rich completion effect runs
- **WHEN** an accepted nature-inspired completion effect runs on a supported device
- **THEN** it does not delay input, focus, scrolling, confirmed-state presentation, or row removal and its complexity is adjusted when measured browser behavior shows visible jank or long main-thread work

### Requirement: Incremental Design Review
Every change that introduces or materially alters a user-facing surface SHALL include a quick standalone HTML reference presented for human review before final implementation and retained as a decision reference. Exploration SHALL cover the primary compact state, materially different responsive compositions, realistic metadata, and applicable loading, empty, error, success, disabled, conflict, and destructive states. After implementation, review SHALL use the real application with documented UX journeys and SHALL include real implementation screenshots, keyboard/focus behavior, contrast, reduced motion, 320-pixel reflow, and 200-percent zoom. A second post-implementation mockup SHALL NOT be required.

#### Scenario: Feature introduces a new screen
- **WHEN** a change adds a family, Todo, history, label, or recurrence screen
- **THEN** its retained HTML reference and design record identify accepted hierarchy and component behavior before implementation, and its verification supplies direct-app UX journeys plus responsive visual and accessibility evidence before completion
