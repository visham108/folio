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
  // Moods are for books you've started, so use the first book (already read).
  await page.locator('.series-link').first().click()

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

test('reads, piles and shelves behave', async ({ page }) => {
  const errors = watchErrors(page)
  await startOnDevice(page)
  await page.goto('/#/settings')
  await page.getByRole('button', { name: /sample library/ }).click()

  // "Log a read" is only saved when you press Add read; cancelling leaves nothing behind.
  await openLibrary(page, '/want')
  await page.locator('.tile-link').first().click()
  await expect(page.locator('.tl')).toHaveCount(0)
  await page.getByRole('button', { name: 'Log a read' }).click()
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.locator('.tl')).toHaveCount(0)
  await expect(page.locator('.status-btn')).toContainText('Want to read')
  // Logging a finished read moves the book to Read.
  await page.getByRole('button', { name: 'Log a read' }).click()
  const dialog = page.getByRole('dialog', { name: 'Log a read' })
  await dialog.getByRole('radio', { name: 'Finished' }).click()
  await dialog.getByRole('button', { name: 'Add read' }).click()
  await expect(page.locator('.tl')).toHaveCount(1)
  await expect(page.locator('.status-btn')).toContainText('Read')
  // Deleting it asks first, then puts the book back.
  await page.locator('.tl-body').first().click()
  await page.getByRole('button', { name: 'Delete' }).click()
  await page.locator('.sheet-foot .btn-danger').click()
  await expect(page.locator('.tl')).toHaveCount(0)
  await expect(page.locator('.status-btn')).toContainText('Want to read')
  // The status menu closes with Escape.
  await page.locator('.status-btn').click()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)

  // Typing a shelf name quickly keeps every letter; shelves can be renamed and deleted.
  await openLibrary(page)
  await page.getByRole('button', { name: 'New shelf' }).click()
  await page.getByLabel('Shelf name').pressSequentially('summer reads 2026', { delay: 5 })
  await page.getByRole('button', { name: 'Create shelf' }).click()
  await expect(page.locator('h1.display')).toHaveText('Summer Reads 2026')
  await page.getByRole('button', { name: 'Edit shelf' }).click()
  await page.getByLabel('Shelf name').fill('beach books')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('h1.display')).toHaveText('Beach Books')
  await page.getByRole('button', { name: 'Edit shelf' }).click()
  await page.getByRole('button', { name: 'Delete shelf' }).click()
  await page.locator('.sheet-foot .btn-danger').click()
  await expect(page.locator('.pile', { hasText: 'Beach Books' })).toHaveCount(0)

  expect(errors).toEqual([])
})

test('a change survives an immediate reload', async ({ page }) => {
  await startOnDevice(page)
  await page.goto('/#/settings')
  await page.getByRole('button', { name: /sample library/ }).click()
  await openLibrary(page, '/read')
  await page.locator('.tile-link').first().click()
  for (const pace of ['Fast', 'Slow', 'Medium']) {
    await page.getByRole('radio', { name: pace }).click()
    await page.reload()
    await expect(page.getByRole('radio', { name: pace })).toBeChecked()
  }
})

test('bulk edit and per-year goals', async ({ page }) => {
  const errors = watchErrors(page)
  await startOnDevice(page)
  await page.goto('/#/settings')
  await page.getByRole('button', { name: /sample library/ }).click()

  // Select every want-to-read book and make them all ebooks, owned.
  await openLibrary(page, '/want')
  const n = await page.locator('.tile').count()
  await page.getByRole('button', { name: 'Select' }).click()
  await page.getByRole('button', { name: new RegExp(`Select all ${n}`) }).click()
  await page.getByRole('button', { name: 'Edit' }).click()
  const sheet = page.getByRole('dialog', { name: new RegExp(`Edit ${n} books`) })
  await sheet.locator('#bulk-format-mode').selectOption('set')
  await sheet.locator('#bulk-format').selectOption('ebook')
  await sheet.locator('#bulk-owned-mode').selectOption('set')
  // Find and replace across every selected title.
  await sheet.locator('#bulk-title-mode').selectOption('replace')
  await sheet.getByLabel('Title: find').fill('the')
  await sheet.getByLabel('Title: replace with').fill('Thee')
  await sheet.getByRole('button', { name: /Apply 3 changes to/ }).click()
  await page.locator('select[aria-label="Format"]').selectOption('ebook')
  await expect(page.locator('.tile')).toHaveCount(n)
  expect(await page.locator('.tile-title', { hasText: /\bthe\b/ }).count()).toBe(0)

  // A past year gets its own goal; this year's is unchanged.
  const year = new Date().getFullYear()
  await page.goto(`/#/stats/${year - 1}`)
  await page.getByRole('button', { name: /Set a goal|Change goal/ }).first().click()
  await page.getByLabel(`Books to read in ${year - 1}`).fill('30')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.stat-hero-goal .ring-num')).toContainText('/30')
  await page.goto(`/#/stats/${year}`)
  await expect(page.locator('.stat-hero-goal .ring-num')).toContainText('/12')

  expect(errors).toEqual([])
})

test('table of every detail: edit a cell, select rows', async ({ page }) => {
  const errors = watchErrors(page)
  await startOnDevice(page)
  await page.goto('/#/settings')
  await page.getByRole('button', { name: /sample library/ }).click()
  await openLibrary(page)
  await page.getByRole('radio', { name: 'Table of every detail' }).click()
  await expect(page.locator('.ltable tbody tr').first()).toBeVisible()

  // Search narrows the table to one book; change its page count in place.
  await page.getByPlaceholder(/Search/).fill('Piranesi')
  await expect(page.locator('.ltable tbody tr')).toHaveCount(1)
  await page.getByRole('button', { name: /^Pages: .* Change$/ }).click()
  await page.getByLabel('Pages', { exact: true }).fill('245')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Pages: 245. Change' })).toBeVisible()
  await page.reload()
  await page.getByPlaceholder(/Search/).fill('Piranesi')
  await expect(page.getByRole('button', { name: 'Pages: 245. Change' })).toBeVisible()

  // Tick rows and open the bulk editor on them.
  await page.getByPlaceholder(/Search/).fill('')
  await page.locator('.ltable tbody input[type=checkbox]').nth(0).check()
  await page.locator('.ltable tbody input[type=checkbox]').nth(1).check()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Edit 2 books' })).toBeVisible()

  expect(errors).toEqual([])
})

test('progress by page or percent; rename an author everywhere', async ({ page }) => {
  const errors = watchErrors(page)
  await startOnDevice(page)
  await page.goto('/#/settings')
  await page.getByRole('button', { name: /sample library/ }).click()

  // A book being read: update by page, then by percent.
  await page.goto('/#/library/reading')
  await expect(page.locator('h1.display')).toHaveText('Currently reading')
  await page.locator('.tile-link', { hasText: 'The Covenant of Water' }).click()
  await page.getByRole('button', { name: 'Update' }).click()
  const sheet = page.getByRole('dialog', { name: 'Update progress' })
  await sheet.getByLabel('Current page').fill('362')
  await expect(sheet.locator('.prog-big')).toContainText('50%')
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.progress-card')).toContainText('p. 362 of 724')
  await page.getByRole('button', { name: 'Update' }).click()
  await sheet.getByRole('radio', { name: 'Percent' }).click()
  await sheet.getByLabel('Percent read').fill('75')
  await expect(sheet.locator('.prog-big')).toContainText('page 543 of 724')
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.progress-card')).toContainText('75%')

  // A book with no page count: give the total once and it's remembered.
  await page.goto('/#/library/reading')
  await expect(page.locator('h1.display')).toHaveText('Currently reading')
  await page.getByRole('radio', { name: 'Table of every detail' }).click()
  await page.getByPlaceholder(/Search/).fill('The Covenant of Water')
  await page.getByRole('button', { name: /^Pages: 724\. Change$/ }).click()
  await page.getByLabel('Pages', { exact: true }).fill('')
  await page.keyboard.press('Enter')
  await page.getByRole('radio', { name: 'Grid' }).click()
  await page.locator('.tile-link', { hasText: 'The Covenant of Water' }).click()
  await page.getByRole('button', { name: 'Update' }).click()
  await expect(sheet).toContainText('no page count yet')
  await sheet.getByLabel('Current page').fill('100')
  await sheet.getByLabel('Total pages').fill('400')
  await expect(sheet.locator('.prog-big')).toContainText('25%')
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.progress-card')).toContainText('p. 100 of 400')

  // Rename an author on every book that has them.
  await openLibrary(page)
  await page.getByRole('radio', { name: 'Table of every detail' }).click()
  await page.getByRole('checkbox', { name: 'Select all', exact: true }).check()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  const bulk = page.getByRole('dialog', { name: /^Edit \d+ books$/ })
  await bulk.locator('#bulk-authors-mode').selectOption('rename')
  await bulk.getByRole('group', { name: 'Authors to rename' }).getByRole('button', { name: 'Frank Herbert' }).click()
  await bulk.getByLabel('Authors: new name').fill('frank p. herbert')
  await bulk.getByRole('button', { name: /^Apply 1 change/ }).click()
  await page.getByPlaceholder(/Search/).fill('Frank P. Herbert')
  await expect(page.locator('.ltable tbody tr')).toHaveCount(2)

  expect(errors).toEqual([])
})
