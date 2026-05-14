// Pure decision function for the per-dialog `turbo:submit-end`
// listener installed by the overlay controller. Returns true when
// the overlay should close in response to a form submission's redirect.
//
// Inputs:
//   form          — the submitting <form> element (event.target)
//   dialog        — the overlay <dialog> hosting the controller
//   fetchResponse — event.detail.fetchResponse from turbo:submit-end
//
// Close-on-redirect is the default. Three opt-outs, finest-grained
// wins. None of these short-circuit the others — checking the form
// attribute first means a form-level opt-out works inside an overlay
// whose link did not opt out, and the dialog attribute is meaningless
// for forms outside the dialog (filtered by descendant check first).
//
// 1. Form is not a descendant of this dialog — not our submission.
// 2. Response is not a followed redirect — leave it alone.
// 3. The form opts out via data-turbo-overlay-keep-open-on-redirect.
// 4. The dialog opts out (link helper set keep_overlay_open_on_redirect: true).
export function shouldCloseOnRedirect({ form, dialog, fetchResponse }) {
  if (!form || !dialog) return false
  if (!form.tagName || form.tagName !== "FORM") return false
  if (!dialog.contains(form)) return false
  if (!fetchResponse || !fetchResponse.redirected) return false
  if (form.dataset && form.dataset.turboOverlayKeepOpenOnRedirect === "true") return false
  if (dialog.dataset && dialog.dataset.turboOverlayKeepOpenOnRedirect === "true") return false
  return true
}
