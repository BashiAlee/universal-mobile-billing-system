import { expect, type Page } from '@playwright/test'

export const USER = 'admin'
export const PASSWORD = 'admin-pass-1'

/** Gets past the first-run "Create your account" screen or the "Sign in" screen, whichever is showing. */
export async function signIn(
  page: Page,
  username = USER,
  password = PASSWORD,
  waitForApp = true
): Promise<void> {
  const create = page.getByRole('heading', { name: 'Create your account' })
  const signin = page.getByRole('heading', { name: 'Sign in' })
  await expect(create.or(signin)).toBeVisible()
  if (await create.isVisible()) {
    await page.getByLabel('Username').fill(username)
    await page.getByLabel('Password (at least 6 characters)').fill(password)
    await page.getByLabel('Repeat password').fill(password)
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.getByLabel('I have written it down').check()
    await page.getByRole('button', { name: 'Continue' }).click()
  } else {
    await page.getByLabel('Username').fill(username)
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  }
  if (waitForApp) await expect(page.getByText('Signed in as')).toBeVisible()
}
