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
    assert_selector "dialog.turbo-overlay--popover[open]"
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

  test "re-clicking the same popover_link_to does not duplicate the popover" do
    visit "/"
    click_on "Popover", match: :first
    assert_selector "dialog.turbo-overlay--popover[open]", count: 1

    # The link's overlay id is sticky after the first click; clicking
    # again must tear the existing frame down before spawning a new one
    # (CHANGELOG fix c1486c7).
    click_on "Popover", match: :first
    assert_selector "dialog.turbo-overlay--popover[open]", count: 1
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
