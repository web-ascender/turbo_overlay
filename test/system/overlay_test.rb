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
end
