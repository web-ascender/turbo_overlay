// Pure-function tests for shouldCloseOnRedirect.
//
//   node --test test/js/submit_close.test.js
//
// Decision function used by the per-dialog turbo:submit-end listener.
// Inputs are real-shape duck types for form, dialog, and fetchResponse.

import test from "node:test"
import assert from "node:assert/strict"
import { shouldCloseOnRedirect, isSamePageRedirect } from "../../app/javascript/turbo_overlay/submit_close.js"

function makeForm({ keepOpen = false } = {}) {
  return {
    tagName: "FORM",
    dataset: keepOpen ? { turboOverlayKeepOpenOnRedirect: "true" } : {}
  }
}

function makeDialog(form, { keepOpen = false } = {}) {
  return {
    dataset: keepOpen ? { turboOverlayKeepOpenOnRedirect: "true" } : {},
    contains: (node) => node === form
  }
}

function fetchResponse({ redirected = true } = {}) {
  return { redirected }
}

test("closes when a descendant form's submit follows a redirect", () => {
  const form = makeForm()
  const dialog = makeDialog(form)
  assert.equal(
    shouldCloseOnRedirect({ form, dialog, fetchResponse: fetchResponse() }),
    true
  )
})

test("does not close when fetch did not follow a redirect", () => {
  const form = makeForm()
  const dialog = makeDialog(form)
  assert.equal(
    shouldCloseOnRedirect({ form, dialog, fetchResponse: fetchResponse({ redirected: false }) }),
    false
  )
})

test("does not close when fetchResponse is missing", () => {
  const form = makeForm()
  const dialog = makeDialog(form)
  assert.equal(
    shouldCloseOnRedirect({ form, dialog, fetchResponse: null }),
    false
  )
})

test("does not close when form is not a descendant of the dialog", () => {
  const form = makeForm()
  const otherForm = makeForm()
  const dialog = makeDialog(otherForm)   // dialog contains otherForm, not form
  assert.equal(
    shouldCloseOnRedirect({ form, dialog, fetchResponse: fetchResponse() }),
    false
  )
})

test("does not close when form opts out via data attribute", () => {
  const form = makeForm({ keepOpen: true })
  const dialog = makeDialog(form)
  assert.equal(
    shouldCloseOnRedirect({ form, dialog, fetchResponse: fetchResponse() }),
    false
  )
})

test("does not close when dialog opts out via data attribute", () => {
  const form = makeForm()
  const dialog = makeDialog(form, { keepOpen: true })
  assert.equal(
    shouldCloseOnRedirect({ form, dialog, fetchResponse: fetchResponse() }),
    false
  )
})

test("does not close when event target is not a form (e.g. button)", () => {
  const form = { tagName: "BUTTON", dataset: {} }
  const dialog = { dataset: {}, contains: () => true }
  assert.equal(
    shouldCloseOnRedirect({ form, dialog, fetchResponse: fetchResponse() }),
    false
  )
})

test("does not close when form is missing", () => {
  const dialog = { dataset: {}, contains: () => true }
  assert.equal(
    shouldCloseOnRedirect({ form: null, dialog, fetchResponse: fetchResponse() }),
    false
  )
})

test("does not close when dialog is missing", () => {
  const form = makeForm()
  assert.equal(
    shouldCloseOnRedirect({ form, dialog: null, fetchResponse: fetchResponse() }),
    false
  )
})

// ---- isSamePageRedirect ----

function dialogWith(openerUrl) {
  return openerUrl
    ? { dataset: { turboOverlayOpenerUrl: openerUrl } }
    : { dataset: {} }
}

function fetchResponseWithUrl(url) {
  return { redirected: true, response: { url } }
}

test("same-page: identical pathname matches", () => {
  assert.equal(
    isSamePageRedirect({
      dialog: dialogWith("https://example.test/things"),
      fetchResponse: fetchResponseWithUrl("https://example.test/things")
    }),
    true
  )
})

test("same-page: same pathname with different query string matches", () => {
  assert.equal(
    isSamePageRedirect({
      dialog: dialogWith("https://example.test/things"),
      fetchResponse: fetchResponseWithUrl("https://example.test/things?filter=new")
    }),
    true
  )
})

test("same-page: differing pathname does not match", () => {
  assert.equal(
    isSamePageRedirect({
      dialog: dialogWith("https://example.test/things"),
      fetchResponse: fetchResponseWithUrl("https://example.test/widgets")
    }),
    false
  )
})

test("same-page: cross-origin does not match", () => {
  assert.equal(
    isSamePageRedirect({
      dialog: dialogWith("https://example.test/things"),
      fetchResponse: fetchResponseWithUrl("https://other.test/things")
    }),
    false
  )
})

test("same-page: opener URL missing returns false", () => {
  assert.equal(
    isSamePageRedirect({
      dialog: dialogWith(null),
      fetchResponse: fetchResponseWithUrl("https://example.test/things")
    }),
    false
  )
})

test("same-page: response URL missing returns false", () => {
  assert.equal(
    isSamePageRedirect({
      dialog: dialogWith("https://example.test/things"),
      fetchResponse: { redirected: true, response: {} }
    }),
    false
  )
})

test("same-page: trailing-slash and hash difference still matches", () => {
  assert.equal(
    isSamePageRedirect({
      dialog: dialogWith("https://example.test/things"),
      fetchResponse: fetchResponseWithUrl("https://example.test/things#anchor")
    }),
    true
  )
})

test("same-page: malformed opener URL returns false", () => {
  assert.equal(
    isSamePageRedirect({
      dialog: dialogWith("::::not-a-url"),
      fetchResponse: fetchResponseWithUrl("https://example.test/things")
    }),
    false
  )
})
