import { test, expect } from '@playwright/test';

/**
 * Audit 2026-05-13 (P1): scaffolding for the critical-flow E2E that
 * CLAUDE.md mandates (booking creation, payment capture, cancellation).
 * The spec is `test.fixme`'d because it requires infrastructure that
 * doesn't exist yet in repo:
 *
 *   - A long-lived test club seeded with at least one lesson type, one
 *     arena, and a recurring slot. See `docs/e2e-setup.md` for the
 *     seed-script outline.
 *   - Clerk test credentials in env (`E2E_TEST_USER_EMAIL`,
 *     `E2E_TEST_USER_PASSWORD`). Use a Clerk test mode org you don't
 *     mind seeing booking churn in.
 *   - Stripe test-mode keys connected on the test club so the payment
 *     redirect resolves to Stripe's `4242 4242 4242 4242` flow.
 *
 * Once that infrastructure exists, drop the `fixme` and the suite gates
 * deploys against booking-flow regressions. Until then, the tests serve
 * as executable documentation of the assertions the human review pass
 * still covers.
 */
test.describe('booking + payment critical flow', () => {
  test.fixme('rider can sign up, join a public club, book a lesson, and complete payment', async ({
    page,
  }) => {
    // 1. Sign up via Clerk
    await page.goto('/sign-up');
    // ...Clerk's test-mode sign-up flow

    // 2. Land on /discover and pick the test club
    await page.goto('/discover');
    await page.getByRole('link', { name: /jsr.*test.*club/i }).click();

    // 3. Hit Join (open-policy club so no approval gate)
    await page.getByRole('button', { name: /join/i }).click();
    await expect(page).toHaveURL(/\/rider/);

    // 4. Book a slot
    await page.getByRole('link', { name: /book/i }).click();
    await page
      .getByRole('button', { name: /^9:00\b/ })
      .first()
      .click();
    await page.getByRole('button', { name: /confirm/i }).click();

    // 5. Stripe redirect → use 4242 4242 4242 4242
    await page.waitForURL(/stripe\.com|checkout\.stripe/);
    // ...Stripe Checkout's iframe-stuffed form is fragile to scrape; in
    // CI we use Stripe's test-mode pre-filled card via API to avoid
    // DOM brittleness. See docs/e2e-setup.md.

    // 6. Land back at /rider/bookings/[id]?from=payment
    await page.waitForURL(/\/rider\/bookings\/[0-9a-f-]+\?from=payment/);

    // 7. Banner should poll, then show "Payment received"
    await expect(page.getByText(/payment received/i)).toBeVisible({ timeout: 60_000 });
  });

  test.fixme('rider can cancel a paid booking and see the refund banner', async ({ page }) => {
    // Same setup as above, then click Cancel on a paid booking; assert
    // the refund banner appears and the booking's payment status
    // transitions to `refunded`.
    await page.goto('/rider/bookings');
  });

  test.fixme('rider sees the late-cancellation fee on a same-day cancel', async ({ page }) => {
    // Seed a slot < lateCancellationFeePercent threshold, attempt to
    // cancel, assert the fee preview shows the configured percentage.
    await page.goto('/rider/bookings');
  });
});
