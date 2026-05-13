# Accessibility

The gem leans on the native `<dialog>` element and the Popover API so
most assistive-tech behavior comes from the browser. This page lists
what's automatic, what you're responsible for, and what's known not to
work.

## What the gem gives you

- **Focus management.** Modal and drawer dialogs open via
  `dialog.showModal()`, which moves focus into the dialog and traps it
  inside. `dialog.close()` restores focus to the element that was
  focused before the dialog opened. Popovers and hints use the Popover
  API (`showPopover()` / `hidePopover()`) which provides the same
  restoration. Frame re-renders inside an open overlay preserve the
  dialog node via Turbo morph, so focus survives a server-side
  validation round-trip.
- **ESC dismissal.** Native for modal/drawer (the `cancel` event);
  synthesised in the Stimulus controller for non-modal drawers and
  popovers, where the platform's `cancel` event doesn't fire. Stacked
  overlays only dismiss the topmost layer per press.
- **Labelled dialogs.** `aria-labelledby` is wired to the `<h2>`
  rendered from `overlay_title`. Provide an `overlay_title` on every
  overlay view and screen readers will announce the dialog by name.
- **Triggers signal what they open.** `modal_link_to`,
  `drawer_link_to`, and `popover_link_to` emit
  `aria-haspopup="dialog"`. `hint_link_to` (and overlay links composed
  with `hint: true`) emit `aria-haspopup="tooltip"`. Override with
  `aria: { haspopup: ... }` or `"aria-haspopup" => ...` when a
  different semantic fits.
- **Close buttons are named.** The default chrome's `×` button carries
  `aria-label="Close"`; the glyph itself is wrapped in
  `aria-hidden="true"` so it never reaches AT as "times".
- **Keyboard focus is visible.** The plain theme adds a
  `:focus-visible` outline (`currentColor`) on close buttons; Tailwind
  and Bootstrap themes inherit framework focus styles.
- **Loading announcements.** The placeholder dialog opens with
  `role="status" aria-live="polite"` and a visually-hidden "Loading…"
  text node, so screen readers announce when an overlay starts fetching.
- **Reduced motion.** All animations (open/close, slide-in/out,
  backdrop fade, hint enter/leave, loading spinner) respect
  `prefers-reduced-motion: reduce`.
- **Hint affordances.** Hints render as `role="tooltip"`, link to their
  trigger via `aria-describedby` while visible, skip touch devices, and
  dismiss on focusout / ESC / Turbo navigation. See
  [hints.md](hints.md#accessibility-and-dismissal).

## What you provide

- **An accessible title.** Set `overlay_title` in every overlay view.
  Without it the `aria-labelledby` reference points to a missing
  element and the dialog has no accessible name.
- **Accessible trigger text.** `modal_link_to "Edit", …` reads "Edit,
  has popup, dialog" — verify the visible text on every trigger makes
  sense out of context. Avoid bare icon triggers without `aria-label`.
- **Sensible focus order inside the dialog.** The native focus trap
  keeps focus inside the dialog; the order it cycles through is your
  template's tab order. Keep destructive actions (Delete) away from
  the dialog's first focusable element.

## Known limitations

- **Non-modal drawer inside an open modal is unsupported.** The HTML
  inertness algorithm makes everything outside the topmost modal
  inert, so a `backdrop: false` drawer opened from inside a modal
  renders behind the modal and ignores input. See
  [popovers.md](popovers.md#non-modal-drawer-inside-modal-is-unsupported).
  Popovers opened from inside a modal are auto-promoted to
  `showModal()` to dodge the same trap (the `::backdrop` is rendered
  transparent so the visual stays "popover-like").
- **Animated close mid-stack.** A middle-of-stack `<dialog>` may skip
  its close animation in Chromium/Firefox when a higher dialog is also
  closing. This is a paint quirk, not an a11y blocker — focus and
  semantics are unaffected.
- **`aria-modal="true"` is not set on the native `<dialog>`.** Browser
  modal semantics come from `showModal()` itself; the WAI-ARIA APG
  advises against duplicating the attribute. Some older AT may behave
  differently than modern AT; that's a platform issue, not something
  the gem can paper over.
