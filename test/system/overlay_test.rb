require "application_system_test_case"

class OverlayTest < ApplicationSystemTestCase
  test "modal_link_to opens a dialog and ESC dismisses it" do
    visit "/"

    assert_no_selector "dialog.turbo-overlay--modal[open]"
    click_on "Modal", match: :first

    assert_selector "dialog.turbo-overlay--modal[open]"
    assert_selector "dialog.turbo-overlay--modal [data-test-widget-show='Sprocket']"

    find("dialog.turbo-overlay--modal[open]").send_keys :escape
    assert_no_selector "dialog.turbo-overlay--modal[open]"
  end

  test "drawer_link_to opens a drawer dialog" do
    visit "/"

    click_on "Drawer", match: :first
    assert_selector "dialog.turbo-overlay--drawer[open]"
    assert_selector "dialog.turbo-overlay--drawer [data-test-widget-show='Sprocket']"
  end

  test "popover_link_to opens a non-modal popover anchored to the trigger" do
    visit "/"

    click_on "Popover", match: :first
    assert_selector "dialog.turbo-overlay--popover:popover-open"
    # Popovers position-fixed themselves; with no anchor the controller
    # falls back to centered, so just assert it rendered.
    assert_selector "dialog.turbo-overlay--popover [data-test-widget-show='Sprocket']"
  end

  test "turbo-overlay:shown fires once when an overlay opens" do
    visit "/"
    page.execute_script(<<~JS)
      window._shownCount = 0
      document.addEventListener("turbo-overlay:shown", (e) => {
        window._shownCount += 1
        window._lastShownDetail = e.detail
      })
    JS

    click_on "Modal", match: :first
    assert_selector "dialog.turbo-overlay--modal[open]"

    assert_equal 1,        page.evaluate_script("window._shownCount")
    assert_equal "modal",  page.evaluate_script("window._lastShownDetail.type")
  end

  test "modal_link_to clicked from inside an open modal stacks a second dialog" do
    visit "/"
    click_on "Modal", match: :first      # Sprocket
    assert_selector "dialog.turbo-overlay--modal[open]", count: 1

    within "dialog.turbo-overlay--modal[open]" do
      click_on "Open Flywheel"
    end

    assert_selector "dialog.turbo-overlay--modal[open]", count: 2
    assert_selector "[data-test-widget-show='Sprocket']"
    assert_selector "[data-test-widget-show='Flywheel']"
  end

  test "ESC closes only the top-most overlay in a stack" do
    visit "/"
    click_on "Modal", match: :first
    within "dialog.turbo-overlay--modal[open]" do
      click_on "Open Flywheel"
    end
    assert_selector "[data-test-widget-show='Flywheel']"
    assert_selector "[data-test-widget-show='Sprocket']"

    # send_keys focuses by clicking; any click on the dialog itself
    # would be interpreted as a backdrop click. Send to the top-most
    # dialog (last in DOM order, since overlays append) so the focus
    # click lands on the live content.
    all("dialog.turbo-overlay--modal[open]").last.send_keys :escape

    assert_no_selector "[data-test-widget-show='Flywheel']"
    assert_selector   "[data-test-widget-show='Sprocket']"
  end

  test "popover triggered from inside an open modal renders in the top layer" do
    visit "/"
    click_on "Modal", match: :first
    assert_selector "dialog.turbo-overlay--modal[open]"

    within "dialog.turbo-overlay--modal[open]" do
      click_on "Popover from modal"
    end

    # The popover is opened via `showModal()` when a modal dialog is
    # already open (otherwise the parent modal's inertness blocks it).
    # Either :popover-open or :modal proves it's in the top layer.
    assert_selector "dialog.turbo-overlay--popover:is(:popover-open, :modal)"
    assert_selector "dialog.turbo-overlay--modal[open]"
  end

  test "popover positions correctly when triggered from inside a modal" do
    visit "/"

    # Baseline: the standalone Flywheel popover. Same widget as the one
    # the inside-modal trigger will open, so content (and intrinsic
    # popover width) is identical.
    find("#popover-link-2").click
    assert_selector "dialog.turbo-overlay--popover:popover-open"

    baseline = page.evaluate_script(<<~JS)
      (() => {
        const trigger = document.querySelector("#popover-link-2")
        const dialog  = document.querySelector("dialog.turbo-overlay--popover:popover-open")
        const a = trigger.getBoundingClientRect()
        const d = dialog.getBoundingClientRect()
        return { gapY: d.top - a.bottom, deltaX: d.left - a.left, dWidth: d.width, dLeft: d.left, dTop: d.top }
      })()
    JS
    find("dialog.turbo-overlay--popover:popover-open").send_keys :escape
    assert_no_selector "dialog.turbo-overlay--popover:popover-open"

    # Now open the Sprocket modal and click "Popover from modal", which
    # opens the *same* Flywheel widget as a popover anchored to a link
    # inside the modal.
    click_on "Modal", match: :first
    assert_selector "dialog.turbo-overlay--modal[open]"
    within "dialog.turbo-overlay--modal[open]" do
      click_on "Popover from modal"
    end
    assert_selector "dialog.turbo-overlay--popover:is(:popover-open, :modal)"

    inside_modal = page.evaluate_script(<<~JS)
      (() => {
        const trigger = document.querySelector("dialog.turbo-overlay--modal a[data-turbo-overlay='popover']")
        const dialog  = document.querySelector("dialog.turbo-overlay--popover")
        const a = trigger.getBoundingClientRect()
        const d = dialog.getBoundingClientRect()
        return { gapY: d.top - a.bottom, deltaX: d.left - a.left, dWidth: d.width, dLeft: d.left, dTop: d.top }
      })()
    JS

    # Same widget content → same intrinsic width.
    assert_in_delta baseline["dWidth"], inside_modal["dWidth"], 1.5,
      "popover width differs inside modal (baseline #{baseline["dWidth"]} vs #{inside_modal["dWidth"]})"
    # Anchored vertical gap matches (default offset 4px, bottom placement).
    assert_in_delta baseline["gapY"], inside_modal["gapY"], 1.5,
      "popover vertical gap below trigger differs inside modal (baseline #{baseline["gapY"]} vs #{inside_modal["gapY"]})"
    # Anchored horizontal offset matches (default align: :start, so deltaX should be ~0).
    assert_in_delta baseline["deltaX"], inside_modal["deltaX"], 1.5,
      "popover horizontal offset differs inside modal (baseline #{baseline["deltaX"]} vs #{inside_modal["deltaX"]})"
    # And the absolute deltaX should be zero — popover's left edge aligns with trigger's left edge.
    assert_in_delta 0, inside_modal["deltaX"], 1.5,
      "popover not left-aligned with trigger inside modal (deltaX #{inside_modal["deltaX"]})"
  end

  test "popover with position right inside a right drawer flips left and clears the trigger" do
    visit "/"

    # Open the right drawer (gem default position) on Sprocket. The
    # drawer occupies the right ~24rem of the viewport, so a popover
    # with preferred position :right anchored to a button inside the
    # drawer must auto-flip to :left to stay on-screen — and must not
    # cover the trigger.
    click_on "Drawer", match: :first
    assert_selector "dialog.turbo-overlay--drawer[open]"

    within "dialog.turbo-overlay--drawer[open]" do
      click_on "Right popover"
    end
    # Popovers opened from inside a modal context render via showModal()
    # (so the HTML inertness algorithm doesn't block them); they match
    # :modal instead of :popover-open. Match either state.
    assert_selector "dialog.turbo-overlay--popover:is(:popover-open, :modal)"

    rects = page.evaluate_script(<<~JS)
      (() => {
        const trigger = document.querySelector("#popover-right-from-drawer")
        const dialog  = document.querySelector("dialog.turbo-overlay--popover")
        const a = trigger.getBoundingClientRect()
        const d = dialog.getBoundingClientRect()
        return {
          aLeft: a.left, aRight: a.right,
          dLeft: d.left, dRight: d.right, dWidth: d.width,
          vw: document.documentElement.clientWidth,
          resolved: dialog.dataset.resolvedPosition
        }
      })()
    JS

    # The popover must not overlap the trigger horizontally.
    overlaps_x = rects["dLeft"] < rects["aRight"] && rects["dRight"] > rects["aLeft"]
    refute overlaps_x,
      "popover overlaps trigger horizontally: trigger=[#{rects["aLeft"]}, #{rects["aRight"]}], popover=[#{rects["dLeft"]}, #{rects["dRight"]}] (resolved=#{rects["resolved"]})"

    # The popover must stay inside the viewport.
    assert_operator rects["dLeft"],  :>=, 0,             "popover left edge off-viewport (#{rects["dLeft"]})"
    assert_operator rects["dRight"], :<=, rects["vw"],   "popover right edge past viewport (#{rects["dRight"]} > #{rects["vw"]})"

    # The popover must be content-sized (capped at 22rem = 352px), NOT
    # stretched to fill viewport-minus-left. UA dialog:modal styles
    # use width:auto + inset:0 which, without explicit right:auto on
    # our positioned dialog, causes width to fill the gap. Verify the
    # explicit right:auto override kept the popover at content size.
    assert_operator rects["dWidth"], :<=, 360,           "popover stretched to fill horizontal gap (width=#{rects["dWidth"]})"
  end

  test "clicking inside a popover opened from inside a drawer does not dismiss it" do
    visit "/"
    click_on "Drawer", match: :first
    assert_selector "dialog.turbo-overlay--drawer[open]"

    within "dialog.turbo-overlay--drawer[open]" do
      click_on "Right popover"
    end
    # Popovers opened from inside a modal context render via showModal()
    # (so the HTML inertness algorithm doesn't block them); they match
    # :modal instead of :popover-open. Match either state.
    assert_selector "dialog.turbo-overlay--popover:is(:popover-open, :modal)"

    # Real mouse click at coordinates inside the popover's rect.
    # Without the modal-context popover fix, the parent modal's
    # inertness blocking would route the click to the drawer underneath
    # and the popover would dismiss (because target wasn't inside it).
    rect = page.evaluate_script(<<~JS)
      (() => {
        const d = document.querySelector("dialog.turbo-overlay--popover")
        const r = d.getBoundingClientRect()
        return { x: Math.round(r.left + 10), y: Math.round(r.top + 30) }
      })()
    JS

    page.driver.browser.mouse.click(x: rect["x"], y: rect["y"])

    assert_selector "dialog.turbo-overlay--popover:is(:popover-open, :modal)"
  end

  test "clicking a non-modal drawer link inside a modal drawer does not dismiss the parent" do
    visit "/"
    click_on "Drawer", match: :first
    assert_selector "dialog.turbo-overlay--drawer[open]", count: 1

    within "dialog.turbo-overlay--drawer[open]" do
      click_on "Drawer non-modal"
    end

    # The new non-modal drawer is appended on top; the parent (modal)
    # drawer should remain open underneath. Without the attribute-name
    # decoupling fix, the parent's `backdropClick` handler treated the
    # click on the trigger link as a backdrop click — the trigger
    # carries `data-turbo-overlay-backdrop="false"` to signal the
    # fetch hook to add `X-Turbo-Overlay-Backdrop: false`, and the
    # handler's `hasAttribute("data-turbo-overlay-backdrop")` check
    # matched it.
    assert_selector "dialog.turbo-overlay--drawer", count: 2
    assert_selector "dialog.turbo-overlay--drawer[open]", count: 2
  end

  test "re-clicking the same popover_link_to does not duplicate the popover" do
    visit "/"
    click_on "Popover", match: :first
    assert_selector "dialog.turbo-overlay--popover:popover-open", count: 1

    # The link's overlay id is sticky after the first click; clicking
    # again must tear the existing frame down before spawning a new one
    # (CHANGELOG fix c1486c7).
    click_on "Popover", match: :first
    assert_selector "dialog.turbo-overlay--popover:popover-open", count: 1
  end

  test "server-issued turbo_stream.overlay(:close) dismisses the overlay" do
    visit "/"
    click_on "Modal", match: :first
    assert_selector "dialog.turbo-overlay--modal[open]"

    within "dialog.turbo-overlay--modal[open]" do
      click_on "Save and close"
    end

    assert_no_selector "dialog.turbo-overlay--modal[open]"
  end

  test "before-close fires before closed when an overlay dismisses" do
    visit "/"
    page.execute_script(<<~JS)
      window._events = []
      document.addEventListener("turbo-overlay:before-close", (e) => {
        window._events.push("before-close:" + e.detail.type)
      })
      document.addEventListener("turbo-overlay:closed", (e) => {
        window._events.push("closed:" + e.detail.type)
      })
    JS

    click_on "Modal", match: :first
    assert_selector "dialog.turbo-overlay--modal[open]"

    find("dialog.turbo-overlay--modal[open]").send_keys :escape
    assert_no_selector "dialog.turbo-overlay--modal[open]"

    assert_equal ["before-close:modal", "closed:modal"],
      page.evaluate_script("window._events")
  end

  test "form submit with validation error re-renders the overlay frame in place" do
    visit "/"
    click_on "New widget"
    assert_selector "dialog.turbo-overlay--modal[open]"

    within "dialog.turbo-overlay--modal[open]" do
      click_on "Create"   # blank name → 422 with error
    end

    # Overlay stays open (frame re-render, not stream append) and the
    # error message is visible inside the same dialog. Exercises the
    # `stack.has(id)` branch in overlay_controller's connect() — Turbo
    # replaces the dialog node wholesale, so connect() has to re-open
    # the new node.
    assert_selector "dialog.turbo-overlay--modal[open]", count: 1
    assert_selector "[data-test-error]", text: "Name is required"
  end

  test "hovering a hint-marked link shows the +hint variant after the show delay" do
    visit "/"

    # Hover the hint link for Flywheel — the +hint variant template
    # exposes a `<strong data-test-hint-body>` we can assert on.
    find("a", text: "Hint Flywheel").hover

    # show_delay_ms defaults to 250ms; prefetch + render adds a bit
    # more. Give it some headroom.
    assert_selector "[data-test-hint-body]", text: "Flywheel", wait: 2
  end

  test "data-turbo-confirm renders the gem's themed modal instead of window.confirm" do
    visit "/"

    # window.confirm would block the script and Capybara would hang;
    # if we see the themed modal, the confirm hook is intercepting.
    click_on "Delete Sprocket"

    assert_selector "dialog.turbo-overlay--modal[open]",
      text: "Are you sure you want to delete Sprocket?"

    within "dialog.turbo-overlay--modal[open]" do
      click_on "Cancel"
    end

    assert_no_selector "dialog.turbo-overlay--modal[open]"
  end

  test "backdrop click dismisses the modal" do
    visit "/"
    click_on "Modal", match: :first
    assert_selector "dialog.turbo-overlay--modal[open]"

    # The ::backdrop pseudo isn't directly clickable in Cuprite, but
    # native <dialog> reports backdrop clicks with event.target ===
    # the dialog itself (children clicks have target = child). Click
    # the dialog node at (0,0) — outside the centered content — and
    # backdropClick treats it as a backdrop click.
    page.execute_script(<<~JS)
      const d = document.querySelector("dialog.turbo-overlay--modal[open]")
      d.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    JS

    assert_no_selector "dialog.turbo-overlay--modal[open]"
  end

  test "close: false suppresses the chrome's default close button" do
    visit "/"
    click_on "Modal without close"
    assert_selector "dialog.turbo-overlay--modal[open]"

    # Default chrome renders a `<button aria-label="Close">×</button>`.
    # With close: false on the link helper, the X-Turbo-Overlay-Close
    # header is set to "false", the controller's turbo_overlay_close?
    # returns false, the chrome's `close_button` local is false, and
    # the partial omits the button.
    assert_no_selector "dialog.turbo-overlay--modal[open] [aria-label='Close']"
  end
end
