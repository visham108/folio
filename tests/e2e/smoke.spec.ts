import { expect, test, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))

// Errors from the app itself fail the test; blocked third-party images and fonts don't.
function watchErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text())
  })
  return errors
}

// Waits out the page-change animation so counts come from the new screen only.
async function openLibrary(page: Page, pile = '') {
  await page.goto(`/#/library${pile}`)
  await expect(page.locator('h1.display')).not.toHaveText(/Let’s start|Currently/)
  await page.waitForTimeout(500)
}

async function startOnDevice(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: /without an account|on this device/ }).click()
  await expect(page.getByRole('heading', { name: /start your library/i })).toBeVisible()
}

test('core reading flows', async ({ page }) => {
  const errors = watchErrors(page)
  await startOnDevice(page)

  // Sample library → Today, Library, Stats
  await page.goto('/#/settings')
  await page.getByRole('button', { name: /sample library/ }).click()
  await page.goto('/#/')
  await expect(page.getByRole('heading', { name: 'Currently reading' })).toBeVisible()
  await openLibrary(page)
  expect(await page.locator('.tile').count()).toBeGreaterThan(20)
  await page.goto('/#/stats')
  for (const m of ['Pages', 'Hours', 'Combined', 'Books']) await page.getByRole('radio', { name: m }).click()
  await page.getByRole('button', { name: 'Show as table' }).click()
  await expect(page.locator('.data-table')).toBeVisible()

  // Book page: change pile, then remove and undo
  await openLibrary(page, '/read')
  await page.locator('.tile-link').first().click()
  await page.locator('.status-btn').click()
  await page.getByRole('menuitemradio', { name: 'Paused' }).click()
  await expect(page.locator('.status-btn')).toContainText('Paused')
  await openLibrary(page)
  const before = await page.locator('.tile').count()
  await page.locator('.tile-link').first().click()
  await page.getByRole('button', { name: 'Remove from library' }).click()
  await page.locator('.sheet-foot .btn-danger').click()
  await expect(page.locator('.tile')).toHaveCount(before - 1)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator('.tile')).toHaveCount(before)

  expect(errors).toEqual([])
})

test('adding a book tidies typed text and spots duplicates', async ({ page }) => {
  const errors = watchErrors(page)
  await startOnDevice(page)
  await page.goto('/#/settings')
  await page.getByRole('button', { name: /sample library/ }).click()

  await page.goto('/#/add')
  await page.getByRole('button', { name: /Enter it yourself/ }).click()
  await page.getByPlaceholder('The Left Hand of Darkness').fill('the hobit')
  const author = page.getByPlaceholder('Ursula K. Le Guin')
  await author.fill('j.r.r. tolkien')
  await author.press('Enter')
  await expect(page.locator('.match')).toContainText('The Hobbit')

  await page.getByRole('button', { name: /different book/ }).click()
  await page.getByPlaceholder('The Left Hand of Darkness').fill('the name of the wind and rain')
  await page.getByRole('button', { name: 'Add to library' }).click()
  await expect(page.locator('.book-title')).toHaveText('The Name of the Wind and Rain')
  await expect(page.locator('.book-by')).toHaveText('by J.R.R. Tolkien')

  expect(errors).toEqual([])
})

test('importing a StoryGraph export', async ({ page }) => {
  const errors = watchErrors(page)
  await startOnDevice(page)
  await page.goto('/#/settings')
  await page.getByRole('button', { name: 'Import a CSV' }).click()
  await page.locator('.dropzone input[type=file]').setInputFiles(fixture('storygraph.csv'))
  await expect(page.locator('.sheet-head h2')).toHaveText('Import from StoryGraph')
  await page.getByRole('button', { name: 'Import 3 books' }).click()
  await openLibrary(page)
  await expect(page.locator('.tile')).toHaveCount(3)
  await page.locator('.tile-link', { hasText: 'Piranesi' }).click()
  await expect(page.locator('.tl')).toHaveCount(2)

  expect(errors).toEqual([])
})

test('every screen fits the window', async ({ page }) => {
  await startOnDevice(page)
  await page.goto('/#/settings')
  await page.getByRole('button', { name: /sample library/ }).click()
  for (const route of ['/#/', '/#/library', '/#/stats', '/#/stats/all', '/#/add', '/#/settings']) {
    await page.goto(route)
    await page.waitForTimeout(400)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, `${route} scrolls sideways`).toBeLessThanOrEqual(1)
  }
})

test('smart shelves, series, moods and export', async ({ page }) => {
  const errors = watchErrors(page)
  await startOnDevice(page)
  await page.goto('/#/settings')
  await page.getByRole('button', { name: /sample library/ }).click()

  // Smart shelves fill themselves
  await openLibrary(page)
  const smart = page.locator('.pile.smart')
  expect(await smart.count()).toBeGreaterThan(2)
  await smart.first().click()
  await expect(page.locator('.smart-desc')).toBeVisible()
  expect(await page.locator('.tile').count()).toBeGreaterThan(0)

  // Book → series page
  await openLibrary(page)
  await page.getByPlaceholder(/Search/).fill('Dune Messiah')
  await page.locator('.tile-link', { hasText: 'Dune Messiah' }).click()
  await page.locator('.series-eyebrow').click()
  await expect(page.locator('h1.display')).toHaveText('Dune')
  await expect(page.locator('.series-item')).toHaveCount(2)
  await page.locator('.series-link', { hasText: 'Dune Messiah' }).click()

  // Moods and pace stick
  await page.getByRole('button', { name: 'Hopeful' }).click()
  await expect(page.getByRole('button', { name: 'Hopeful' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('radio', { name: 'Fast' }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Hopeful' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('radio', { name: 'Fast' })).toBeChecked()

  // Export
  await page.goto('/#/settings')
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Goodreads \/ StoryGraph CSV/ }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/\.csv$/)

  expect(errors).toEqual([])
})

// Email sign-in is switched off in the deployed build (VITE_EMAIL_SIGNIN); this runs when it's on.
test('signing in with an emailed code', async ({ page }) => {
  test.skip(process.env.VITE_EMAIL_SIGNIN !== '1', 'email sign-in is switched off')
  const errors = watchErrors(page)
  // Stand-ins for Supabase Auth, so no real email is sent.
  await page.route('**/auth/v1/otp*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await page.route('**/auth/v1/verify*', (r) =>
    r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' }) }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Continue with email' }).click()
  await page.getByLabel('Email address').fill('reader@example.com')
  await page.getByRole('button', { name: 'Email me a sign-in code' }).click()
  await expect(page.locator('.email-sent')).toContainText('reader@example.com')
  await expect(page.getByRole('button', { name: /Send a new code in \d+s/ })).toBeDisabled()
  await page.getByLabel('Code').fill('123456')
  await expect(page.getByRole('alert')).toHaveText(/didn’t work/)
  await page.getByRole('button', { name: 'Different email' }).click()
  await expect(page.getByLabel('Email address')).toHaveValue('reader@example.com')
  expect(errors.filter((e) => !/403/.test(e))).toEqual([])
})
