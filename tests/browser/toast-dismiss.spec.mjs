import { openPage } from "./navigation.mjs";
import { test, expect } from "./fixture.mjs";

// Classic scrollbars take space, so any overflow of the notice stack shows a
// bar and moves the notice. jsdom has no layout to catch it.
test.use({
  productionBroker: true,
  channelLifecycle: true,
  soloChannels: ["11111111-1111-4111-8111-111111111111"],
});

function stackGeometry(page) {
  return page.locator(".buzz-toast-viewport").evaluate((viewport) => {
    const notice = viewport.querySelector("[data-sonner-toast]");
    return {
      overflowX: viewport.scrollWidth - viewport.clientWidth,
      overflowY: viewport.scrollHeight - viewport.clientHeight,
      clientWidth: viewport.clientWidth,
      top: notice ? Math.round(notice.getBoundingClientRect().top) : null,
      swiping: notice?.dataset.swiping ?? null,
    };
  });
}

test(
  "pressing, dismissing and showing notices never adds a stack scrollbar",
  {
    tag: "@classic-scrollbars",
  },
  async ({ page, app }, testInfo) => {
    await page.goto(app.origin);
    await openPage(page, "Messages");
    await page
      .getByRole("navigation", { name: "Subscribed channels" })
      .getByRole("button", { name: "Lifecycle channel", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Chat actions", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Archive chat", exact: true })
      .click();
    const notice = page.getByRole("dialog", {
      name: "Chat archived: Lifecycle channel",
    });
    await expect(notice).toBeVisible();
    const viewport = page.locator(".buzz-toast-viewport");
    // Let the entry slide finish so the resting geometry is stable.
    await viewport
      .locator("[data-sonner-toast]")
      .evaluate((toast) =>
        Promise.all(
          toast.getAnimations().map((animation) => animation.finished),
        ),
      );
    const resting = await stackGeometry(page);
    expect(resting).toMatchObject({ overflowX: 0, overflowY: 0 });
    const stack = await viewport.boundingBox();
    const shot = async (name) => {
      await page.screenshot({
        path: testInfo.outputPath(`${name}.png`),
        clip: {
          x: stack.x - 24,
          y: stack.y - 24,
          width: stack.width + 48,
          height: stack.height + 48,
        },
      });
    };
    await shot("0-resting");

    // Pressing an action's label (not its button) starts Sonner's swipe.
    const label = notice
      .getByRole("button", { name: "Undo" })
      .locator(".buzz-button-label");
    const box = await label.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect
      .poll(async () => (await stackGeometry(page)).swiping)
      .toBe("true");
    await shot("1-pressed");
    expect.soft(await stackGeometry(page)).toMatchObject({
      overflowX: 0,
      overflowY: 0,
      clientWidth: resting.clientWidth,
      top: resting.top,
    });

    // Sample every frame of the dismissal and of the follow-up notice's entry.
    // Sonner unmounts an empty stack, so find it afresh on every frame.
    await page.evaluate(() => {
      window.stackSamples = [];
      window.stackSampling = true;
      const tick = () => {
        if (!window.stackSampling) return;
        const stack = document.querySelector(".buzz-toast-viewport");
        if (stack?.querySelector("[data-sonner-toast]"))
          window.stackSamples.push({
            overflowX: stack.scrollWidth - stack.clientWidth,
            overflowY: stack.scrollHeight - stack.clientHeight,
            clientWidth: stack.clientWidth,
          });
        requestAnimationFrame(tick);
      };
      tick();
    });
    await page.mouse.up();
    // Sonner keeps a removed notice mounted, hidden, for 200ms.
    await expect(notice).toBeHidden();
    await shot("2-dismissing");
    const restored = page.getByRole("dialog", {
      name: "Chat unarchived: Lifecycle channel",
    });
    await expect(restored).toBeVisible();
    await expect(notice).toHaveCount(0);
    await viewport
      .locator("[data-sonner-toast]")
      .evaluate((toast) =>
        Promise.all(
          toast.getAnimations().map((animation) => animation.finished),
        ),
      );
    await page.evaluate(() => {
      window.stackSampling = false;
    });
    const samples = await page.evaluate(() => window.stackSamples);
    expect(samples.length).toBeGreaterThan(5);
    for (const sample of samples)
      expect.soft(sample).toEqual({
        overflowX: 0,
        overflowY: 0,
        clientWidth: resting.clientWidth,
      });
  },
);
