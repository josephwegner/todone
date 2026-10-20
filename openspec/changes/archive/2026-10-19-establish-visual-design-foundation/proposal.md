## Why

Todone's product brief makes interaction quality part of the product value: family work should feel clear, gentle, and satisfying rather than administrative or childish. The existing changes specify accessible states and feature behavior, but they do not yet establish enough shared visual language or an iterative design process to keep later screens coherent.

Design should be resolved alongside each vertical slice. A small foundation now gives family management, Todos, history, labels, and recurrence a common starting point while leaving feature-specific decisions with the change that introduces each workflow.

## What Changes

- Establish a light-only "forest at dusk" visual language with deep forest anchors, profile-derived tonal surfaces, mature nature-derived accents, and accessible semantic state colors.
- Define system-first typography, spacing, shape, elevation, Lucide outline-icon, focus, motion, and responsive app-shell rules as reusable design tokens and component contracts.
- Define role-appropriate navigation priorities: children land on canonical `/todos`, which remains an explicit nonfunctional work-in-progress surface until assigned Todos ship, and parents retain a prominent path to create and assign one-off Todos once that capability is available.
- Keep child sign-out reachable from `/todos` and avoid repeating session-restoration screens when a route guard has already resolved the session and page prerequisites.
- Define a server-confirmed Todo completion interaction that rotates among equally special nature-inspired treatments before removing the completed row, without sound, vibration, rarity mechanics, rewards, or delayed access to the next task.
- Require a quick, self-contained HTML reference page for human review before implementing each substantial new UI surface, retain the accepted page as a decision reference, and follow implementation with concise UX journeys that the reviewer exercises in the real app.
- Bring the already-delivered authentication and household-bootstrap surfaces under the shared visual foundation without changing their behavior or security contracts.

## Capabilities

### New Capabilities

- `visual-design-foundation`: Shared visual language, app-shell priorities, completion feedback, and incremental design-review requirements.

### Modified Capabilities

- None. Feature changes retain ownership of their domain behavior and screen-specific interaction decisions.

## Impact

- Depends on the deployable PWA foundation and the product brief's visual direction.
- Becomes a design dependency for remaining family-account, Todo, lifecycle, label, and recurrence UI work.
- Affects shared frontend tokens, primitives, application shell, authentication/bootstrap styling, retained HTML references, screenshot evidence, and visual/accessibility review.
- Adds `@lucide/vue`, the maintained successor to the initially selected `lucide-vue-next`, as the reviewed Vue 3 outline-icon dependency; icons are imported individually so unused icons do not enter the application bundle.
- Adds no rewards, points, streaks, rare/jackpot outcomes, mascots, avatars, task illustrations, sound, vibration, dark mode, or product behavior beyond presentation and interaction feedback. Restrained static nature artwork remains optional when it meets the foundation's quality and accessibility bar.
