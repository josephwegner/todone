## Context

The product brief asks for a clear and rewarding family task experience inspired most strongly by Clear's focused interaction model, while the denser family-list reference demonstrates how secondary metadata can remain gentle. Todone must support meaningful account, assignment, lifecycle, and recurrence detail, but that complexity should not dominate the primary task.

The foundation is light-mode-only in the platform sense, but it is not uniformly pale. Deep forest may anchor navigation and actions while the signed-in member's canonical profile color supplies accessible tonal variants for atmospheric headers and full-bleed list surfaces. Warm neutrals remain available for forms and dense settings. The result should feel mature, natural, and casual—not like a children's rewards product.

## Goals / Non-Goals

**Goals:** a coherent visual language, low-friction role-based shell, reusable component anatomy, satisfying accessible completion feedback, representative mockups, and design iteration inside every later vertical slice.

**Non-Goals:** pixel-locking every future screen, dark mode, a required bespoke illustration library, mascots, animals, task illustrations, points, streaks, rewards, rare/jackpot animation outcomes, sound, vibration, decorative gamification, or adopting every pattern shown in an inspiration screenshot.

## Visual and UX Direction

### Visual character and tokens

- Use a light-only "forest at dusk" composition: deep evergreen anchors common navigation/actions while the current member's canonical profile color may generate a coordinated family of light, mid, deep, muted, and on-color tonal tokens for their personal header and full-bleed Todo canvas. Warm neutral surfaces carry forms and settings where sustained reading benefits from less color.
- Start shared semantic exploration from bark text `#2E2925`, muted bark `#6F675F`, evergreen action `#1F563F`, warm canvas `#F6F1E8`, paper `#FFFCF6`, warm border `#D8CEC0`, and rust warning `#A44232`. Define and contrast-check a tonal family for each canonical profile color rather than applying the stored base hex directly as a large background. These are candidate tokens, not permission to scatter literal values through components.
- Make authored CSS custom properties the source of truth for Todone's semantic and per-profile tonal system. Map Tailwind theme names to those properties for layout and component ergonomics, but do not consume Tailwind's stock color palettes directly in application components. Runtime profile selection sets named tonal properties; it never generates an unreviewed arbitrary palette in a component. This keeps the implementation convenient without surrendering the intentionally designed palette to framework defaults.
- Profile-derived atmosphere is identity, not state. A member's self/home surface uses that signed-in member's tonal family. A parent household shell retains the parent's global atmosphere, while a selected child's name-plus-color may tint the scoped member context and Todo canvas so the target remains obvious. Keep success/warning/error/action semantics stable across profiles, and ensure that changing profile color never makes controls or lifecycle states change meaning.
- Prefer a simple, high-quality profile-to-forest gradient in the default header. Optional static SVG nature artwork may use restrained trail, tree-line, canopy, ridge, or topographic forms only after visual review confirms that it feels intentional and mature. Do not ship generic clip art, faux-retro scenery, animals, mascots, or low-detail illustration merely to fill space.
- Use a system-first friendly sans-serif stack such as `Avenir Next`, `Avenir`, `Segoe UI`, `Inter`, `system-ui`, and `sans-serif`, with platform fallbacks and no required remote font. Favor clear sentence case, moderate weight, and compact metadata rather than cartoon display lettering or all-caps decoration.
- Use generous touch targets and internal whitespace. On compact layouts, prefer continuous full-width page/list surfaces with separators and tonal hierarchy over nested rounded cards; use the same treatment for ordinary page-level forms that do not need dialog-like containment. Reserve genuinely bounded surfaces for focused secondary detail and dialogs. Desktop may add restrained bounding/elevation when it improves scanability without recreating every row as a card.
- Use `@lucide/vue`, the maintained successor to the initially selected `lucide-vue-next`, as the consistent outline icon family. Import icons directly by name for tree shaking, inherit color from semantic text/control tokens, and wrap repeated icon anatomy in a small shared primitive where useful. Label icon-only actions accessibly and hide decorative icons from assistive technology. Avoid emoji, clip art, illustrated task objects, animals, and identity imagery that makes the experience feel aimed at young children.
- Full-bleed Todo rows may use subtle profile-derived gradients or dappled-light texture to make the list feel organic and reinforce horizontal completion. Resting motion must remain low-contrast and non-essential; prefer motion that responds to hover, focus, press, or drag over simultaneous high-activity animation across the whole list, and remove it under reduced motion.

### Information hierarchy and app shell

- The child's signed-in landing route is `/todos`. Until the first Todo vertical slice is implemented, that route renders only a clearly labelled work-in-progress page with ordinary shell/account access and no fabricated Todo data, disabled task actions, completion controls, or suggestion that Todo behavior is available. The real surface later prioritizes assigned active Todos and exposes completion as the strongest repeated action.
- The parent's signed-in shell keeps household/member context clear and provides a prominent, persistent, keyboard-accessible path to create and assign a one-off Todo. Family management and history are reachable without competing with the primary create/view workflow.
- Compact layouts use one primary column. Navigation remains recognizably link-like and exposes a visible current-route state; reference-only state switchers are not product tab bars. Medium and wide layouts may reveal supporting context or persistent navigation only when the same reading order and primary action remain clear.
- Present essential Todo information first: title, completion control, and due state. Assignee, label, recurrence, actor, and lifecycle metadata use predictable secondary positions and progressive disclosure where an action does not require all details at once.

### Completion feedback

- Completion remains a server-confirmed state transition. Pressed and submitting feedback may begin immediately, but celebration begins only after the server confirms success.
- On confirmation, the completion control gives a quick scale/settle "pop" and the row plays one of a small reviewed family of equally special nature-inspired treatments, such as a leaf gust, firefly drift, sunbeam wipe, rain ripple, or dappled-light bloom. Effects use abstract SVG/CSS shape, light, and motion—no emoji, score, streak, sound, or vibration.
- Completion variety is not a lottery. Do not label, rank, collect, or assign rarity to effects. Select the effect by hashing the stable Todo ID into the approved effect list; retries and reopened completion of the same Todo therefore use the same treatment without storing reward state. Keep every effect comparable in duration, prominence, and quality.
- The row then resolves to a clearly completed, lower-emphasis state with visible completion text/check treatment before fading or collapsing out of the active list. The entire confirmed celebration and removal takes no more than a few seconds and never blocks interaction with the next Todo.
- Swipe may be offered as a supplementary pointer/touch shortcut when it proves reliable, but a visible, labelled completion control remains the canonical keyboard, screen-reader, and pointer action.
- With reduced motion, omit translation, scaling, particles, glitter, and collapse animation. Confirm completion through an immediate state/text change and remove the row while preserving the same announcement and focus outcome.
- If the write fails, do not play celebration or remove the row. Restore the actionable state in place with retry and useful focus.
- Modern target devices can comfortably render richer local SVG/CSS completion effects when few run at once. Prefer composited transforms and opacity, but judge complexity by measured interaction responsiveness, smooth scrolling, battery-conscious duration, and absence of long main-thread work rather than an arbitrary particle limit. An effect must never delay focus, input, server-state presentation, or row removal.

### Incremental design process

- Before implementing a substantial new screen or interaction, create a quick, self-contained HTML reference page under `docs/ux/references/` for the primary compact state and any materially different medium/wide composition. The page is a deliberately disposable-quality design aid, is not wired into the production application, and is presented to the product owner for human review before final implementation begins.
- Review hierarchy, role-appropriate actions, realistic metadata, loading/empty/error/success/disabled states, destructive controls, and long-content behavior before final component styling.
- Retain the accepted HTML page as a decision reference rather than a production artifact or immutable visual snapshot. Record accepted anatomy and behavior in the owning change's `design.md`; keep visual constants in the foundation rather than copying feature-specific palettes.
- After implementation, review the real application rather than rebuilding a second mockup. Provide concise role- and route-based UX journeys with setup, actions, and expected results so the product owner can exercise the changed surfaces directly. Engineering review still captures real screenshots at compact, medium, and wide targets and checks 320-pixel reflow, 200-percent zoom, reduced motion, keyboard focus, and representative long names/content before verification completes.
- The foundation owns shared tokens and primitives. Each feature change owns the mockups, component composition, interaction details, and visual acceptance evidence for the surfaces it introduces.

### Accepted reference decision

The product owner accepted `docs/ux/references/visual-design-foundation.html` on 2026-08-23 as the direction for this foundation. The accepted anatomy is a deep-forest app anchor, a gradient-only personal header, continuous profile-tonal Todo canvas, warm bounded secondary surfaces, and a restrained parent context. Fine-grained visual feedback is intentionally deferred to production implementation review; this reference remains the decision record rather than a production snapshot.

## Token Decisions (Tasks 1.2 and 2.1)

`src/assets/main.css` is the visual-token source of truth. Tailwind aliases only these CSS custom properties in `tailwind.config.js`; application components do not use Tailwind's stock palette as their product palette.

| Token family | Values and use |
| --- | --- |
| Readable warm surfaces | bark `#2E2925`, muted bark `#6F675F`, canvas `#F6F1E8`, paper `#FFFCF6`, border `#D8CEC0` |
| Stable semantic colors | evergreen action `#1F563F`, deep evergreen `#143D2E`, success `#28624A`, danger `#A44232`, focus `#216F4F` |
| Shape, elevation, motion | control radius `0.7rem`, surface radius `1.15rem`, surface shadow `0 12px 30px rgb(46 41 37 / 0.1)`, fast interaction duration `150ms`, standard duration `220ms` |
| Profile atmosphere | each canonical profile has named `light`, `mid`, `deep`, `muted`, and `on-color` properties. Runtime sets only `data-profile-color`; it never supplies ad-hoc component colors. |

The reviewed deep profile colors are pine `#20543C`, fern `#3F642F`, moss `#59692F`, clay `#93472F`, cedar `#734835`, marigold `#7D5200`, lake `#245E6D`, and dusk `#5D4163`. Their `on-color` text against paper is respectively 8.56:1, 6.67:1, 5.88:1, 6.44:1, 7.57:1, 6.66:1, 7.08:1, and 8.54:1. Bark against canvas is 12.78:1; action, success, and danger against paper are 8.33:1, 6.98:1, and 6.02:1. These representative text combinations meet WCAG 2.2 AA normal-text contrast before the browser/forced-colors review in task 3.3.

## Risks / Trade-offs

- A dark anchor color can make the product distinctive but can also overpower dense pages. Reserve deep surfaces for hierarchy and focus, leaving reading surfaces warm and quiet.
- Celebration can become distracting when many Todos are completed quickly. Keep it short, local to the completed row, interruptible by continued work, and absent in reduced-motion mode.
- Profile-derived large surfaces require a tested tonal family for all eight colors; direct base-color fills would make some profiles too aggressive or fail contrast.
- Optional nature artwork can quickly become cheesy or inconsistent. The default gradient is sufficient, and illustration is accepted only when reviewed at production quality rather than treated as required decoration.
- System fonts vary by platform. The hierarchy must remain sound across the fallback stack instead of relying on one font's exact metrics.
- Reference mockups can become stale. Requirements and accepted component anatomy remain authoritative; feature reviews update the design record when implementation reveals a better accessible solution.

## Existing Implementation Inventory (Task 1.1)

This inventory records the implementation immediately before the visual foundation work. It identifies the present reusable patterns, constraints that styling must preserve, and intentional gaps for later foundation tasks; it does not approve the existing visual language.

| Surface | Current implementation | Foundation implication and non-regression constraints |
| --- | --- | --- |
| Application shell | `src/App.vue` provides the sole `h1`, a visible-on-focus skip link, a bounded header/main layout, and `RouterView`. It currently uses a small `leaf` Tailwind extension and stock `stone` utilities. | Keep one descriptive `h1`, the skip-link target, semantic header/main landmarks, stable DOM order, and responsive horizontal padding. Replace stock palette use through semantic token aliases rather than component-local palette substitutions. |
| Global CSS | `src/assets/main.css` sets light color-scheme, a system sans stack, body reset, skip-link treatment, and a global reduced-motion override. | Preserve light-only behavior, the system-first stack, the visible focused skip link, and reduced-motion protection. Task 1.2 must replace literals with authored tokens and extend—not weaken—the motion contract. |
| Auth, household bootstrap, profile, and family directory | `src/components/ProductionBootstrap.vue` owns the existing route surfaces and currently defines scoped `field`, `primary`, `secondary`, `link`, `error`, profile-color-option, swatch, and member-card classes. The same component repeats rounded bordered paper-card anatomy for every route surface. | Promote shared control anatomy only after token design and reference review. Preserve native controls, persistent visible labels, submit/disabled behavior, `aria-invalid` associations, Entry Code versus account-password distinction, no-secret route/history policy, and session/onboarding state transitions. Do not turn this component-local screen state back into page navigation. |
| Status, loading, errors, and focus | Bootstrap reserves a status region, uses `aria-live`, marks replaced content busy, exposes retry/error states, focuses invalid fields, and route changes focus the destination heading. | Preserve reserved ordinary-loading space, polite status behavior, retriable errors, field focus, and route-heading focus. Later work must add an error-summary pattern where needed without duplicate/noisy announcements or background-refresh focus jumps. |
| Profile identity | Profile colors are the eight stable IDs in `shared/profilePalette.ts`; the setup and directory currently render their stored hex values directly as small swatches via inline style. | The stored colors remain identity values and small swatches may retain their exact base hue. Task 1.2 must supply reviewed named tonal families for large personal surfaces; semantic success/warning/error/action colors must never derive from profile color. |
| Child placeholder | `src/components/TodoPlaceholder.vue` repeats the current rounded paper-card anatomy and focuses its `h2` after mount. It intentionally has no Todo data, API calls, or controls. | Task 2.2 may restyle the shell/placeholder, but must keep `/todos` honest: no fabricated task rows, disabled completion affordances, or implied Todo availability. Preserve its heading focus and canonical child landing route. |
| Responsive behavior | The shell has `max-w-5xl` gutters; content cards use `max-w-xl`; family members become a two-column grid at `sm`; form controls use a minimum 44px height. | The foundation can introduce compact/medium/wide composition but must retain one-column readable compact flow, 44px targets, long-content wrapping, and identical DOM/keyboard order at every breakpoint. |
| Existing verification | Component tests assert form labels, focus, secret clearing, validation, profile selection, and status behavior. Browser and accessibility suites assert shell landmarks, one `h1`, skip-link operation, route focus/titles, reduced motion, child WIP safety, and WCAG scans across supported browsers/viewports. | Visual work must preserve these semantics and expand coverage for tokens, long-content reflow, and the revised responsive shell. Screenshot changes require meaningful review rather than blind acceptance. |

### Consolidation targets

- The `leaf` extension, stock `stone`/`red` utilities, global CSS literals, and the repeated card/control styles are the main duplicate visual patterns. Task 1.2 owns their tokenized replacement; task 2.1 owns reusable primitive implementation.
- There is currently no signed-in navigation primitive, icon system, profile tonal CSS contract, semantic success token, or foundation-level status/confirmation component. These are deliberate foundation work, not reasons to add feature navigation or fake Todo interactions now.
- `ProductionBootstrap.vue` remains one compatibility component for established surfaces. Future feature pages should compose named shell/control/status primitives instead of copying its scoped classes; splitting its domain behavior is outside this visual-only task unless a later vertical slice requires it.

## Shared Component Contracts (Task 1.4)

| Pattern | Contract | Accessibility and extension rules |
| --- | --- | --- |
| App shell | One semantic header, one main landmark, a skip link, an optional compact nav region, and route content. The forest anchor establishes navigation while route content chooses warm or personal surface. | The app title remains the sole `h1`; routes retain their own focused `h2` until route components own page headings. Navigation never changes authorization or reading order by breakpoint. |
| Bounded surface | `surface-card` is a warm paper container with quiet border, restrained elevation, consistent responsive padding, and no fixed content height. | Use it for focused secondary forms, account settings, errors, and dense detail—not full-bleed Todo rows, compact page scaffolding, or ordinary compact page-level forms. Long text, errors, and zoom must expand it normally. |
| Form field | A native input/select with a visible label, a 44px minimum target, semantic border/background/text tokens, focus ring, disabled state, and adjacent field guidance/error. | Preserve `autocomplete`, `required`, `aria-invalid`, and `aria-describedby`; never replace native fields with an inaccessible visual clone. |
| Actions | Links perform navigation and retain recognizable text-link anatomy, including in compact layouts. `button-primary` is reserved for a confirmed mutation or form submit; `button-secondary` is an outlined alternative; `button-link` is a low-emphasis navigation/cancel action. | Every action remains visibly named unless its accessible name makes an icon-only use unambiguous. Disabled styling never substitutes for explanatory text. |
| Status and feedback | A reserved `status-region` is polite by default; `status-region--error` uses stable semantic danger text/background/border. Loading uses a reserved busy region rather than layout-moving text. | Do not announce secrets or repeat the same outcome in multiple regions. Errors that block a submitted task later gain an error-summary contract with focused links to fields. |
| Member identity and metadata | Member identity is display name plus color swatch; metadata uses sentence case, normal text labels, and secondary text token. | Color never carries the role, status, selection, or identity alone. Use a definition list for labeled account facts. |
| Profile-tone surface | `data-profile-color` supplies named light/mid/deep/muted/on-color variables. It may tint personal headers, member context, and future Todo canvases. | Stored profile hex stays a small swatch only. Semantic action/success/warning/error never inherit profile variables. |
| Todo row | A future Todo row is a continuous full-bleed list item: visible completion control, title, due state, and secondary metadata in a predictable order. | This contract does not authorize placeholder controls or fake data. Completion feedback remains separately owned by the first Todo slice. |
| Lucide icons | Import only the named icon from `@lucide/vue`, inherit semantic color, and use the shared 20px/24px sizing contract. | Decorative icons are `aria-hidden="true"`; icon-only controls require an accessible name. Never dynamically import the catalog or use emoji as an icon substitute. |

## Migration Plan

- Complete `manage-family-accounts` task 3.4 first: introduce the canonical router, guarded route map, and the child `/todos` work-in-progress landing page without restyling or adding family-account behavior.
- Add semantic tokens and shared primitives without changing domain behavior.
- Apply the foundation first to the app shell and existing authentication/household-bootstrap surfaces, preserving their tested flow and focus behavior.
- Use the first family-management and Todo screens to validate density, role navigation, Todo anatomy, and completion motion before later lifecycle, label, and recurrence surfaces extend them.
- Roll back individual visual primitives independently if they fail contrast, motion, or responsive review; no data migration is involved.

## Production review corrections (2026-10-19)

The owner accepted the existing aesthetics during real-app testing and requested a child sign-out control after finding none on `/todos`. Add a named secondary action to the existing Todo work-in-progress surface; this is a narrow correction, not a new page or a Todo action. Reuse fail-safe local sign-out cleanup, remove membership/profile presentation, and replace the route with sign-in even if SDK cleanup throws. No remote sign-out contract is introduced.

The owner also reported repeated session-restoration screens during navigation. The route guard already restores authentication and fetches current membership/profile; a newly mounted bootstrap page repeats that work. Hand off the successful guard result to the destination component once, in memory, keyed by route name. Do not persist it, put it in browser history, or use it to skip the next guard's authorization checks. Clear it on a new navigation and sign-out. Initial restoration and recoverable-error paths remain honest; page-specific directory loading retains its own loading/error states. The current page stays visible while the next guard resolves.
