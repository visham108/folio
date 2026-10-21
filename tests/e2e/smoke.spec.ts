import { expect, test, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))

// The Library opens on spines; most tests here work with the cover grid, so start them there
// (only if no view has been chosen, so switching views within a test still sticks).
test.beforeEach(async ({ page }, info) => {
  if (info.title.includes('spines by default')) return
  await page.addInitScript(() => { try { if (!localStorage.getItem('folio.libraryView.v2')) localStorage.setItem('folio.libraryView.v2', 'grid') } catch { /* blocked */ } })
})

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
  await page.getByRole('button', { name: 'Hopeful', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Hopeful', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('radio', { name: 'Fast' }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Hopeful', exact: true })).toHaveAttribute('aria-pressed', 'true')
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

test('book page shows every detail and changes them in place', async ({ page }) => {
  const errors = watchErrors(page)
  await startOnDevice(page)
  await page.goto('/#/settings')
  await page.getByRole('button', { name: /sample library/ }).click()
  await openLibrary(page)
  await page.locator('.tile-link', { hasText: 'Piranesi' }).click()

  const details = page.locator('.details')
  for (const label of ['Subtitle', 'Original language', 'ISBN', 'ASIN', 'Translators', 'Edition note', 'Owned', 'Added', 'Times read'])
    await expect(details.getByText(label, { exact: true })).toBeVisible()

  // Page count: change it here and the header follows.
  await details.getByRole('button', { name: /^Pages: .* Change$/ }).click()
  await details.getByLabel('Pages', { exact: true }).fill('245')
  await page.keyboard.press('Enter')
  await expect(page.locator('.book-facts')).toContainText('245 pages')

  // Notes changed in the details show in the notes box too.
  await details.getByRole('button', { name: /^Your notes: .* Change$/ }).click()
  await details.getByLabel('Your notes', { exact: true }).fill('Lend to Sam')
  await details.getByLabel('Your notes', { exact: true }).blur()
  await expect(page.locator('textarea.review')).toHaveValue('Lend to Sam')
  await page.reload()
  await expect(page.locator('.details').getByRole('button', { name: 'Pages: 245. Change' })).toBeVisible()

  expect(errors).toEqual([])
})

test('refresh reloads the library and shows when', async ({ page }) => {
  const errors = watchErrors(page)
  await startOnDevice(page)
  await page.goto('/#/settings')
  await page.getByRole('button', { name: /sample library/ }).click()
  await page.goto('/#/')
  const control = page.locator('.refresh:visible').first()
  await expect(control).toContainText(/Last refreshed Today, /)
  await control.getByRole('button', { name: 'Refresh library' }).click()
  await expect(page.getByText('Library refreshed')).toBeVisible()
  await expect(control).toContainText(/Last refreshed Today, /)
  await page.goto('/#/settings')
  await expect(page.locator('.settings-refresh')).toContainText(/Last refreshed Today, /)
  expect(errors).toEqual([])
})

test('library as spines on a shelf; a shareable year card', async ({ page }) => {
  const errors = watchErrors(page)
  await startOnDevice(page)
  await page.goto('/#/settings')
  await page.getByRole('button', { name: /sample library/ }).click()

  // Spines: one shelf per pile on "All", sortable by colour, and each spine opens its book.
  await openLibrary(page)
  await page.getByRole('radio', { name: 'Spines on a shelf' }).click()
  await expect(page.locator('.spine').first()).toBeVisible()
  expect(await page.locator('.spine').count()).toBe(await page.locator('.spine-cell').count())
  await expect(page.getByRole('heading', { name: /Want to read/ })).toBeVisible()
  await page.getByRole('combobox', { name: 'Sort' }).selectOption('colour')
  await page.locator('.spine').first().click()
  await expect(page.locator('.book-title')).toBeVisible()

  // Colour sorting only makes sense for spines, so other views put it back.
  await openLibrary(page)
  await page.getByRole('radio', { name: 'Grid' }).click()
  await expect(page.getByRole('combobox', { name: 'Sort' })).toHaveValue('added')

  // Year card: a picture you can download.
  await page.goto('/#/stats')
  await page.getByRole('button', { name: 'Share your year' }).click()
  await expect(page.locator('.year-card-preview img')).toBeVisible()
  const size = await page.locator('.year-card-preview img').evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])
  expect(size).toEqual([1080, 1350])
  await page.getByRole('radio', { name: 'Light' }).click()
  await expect(page.locator('.year-card-preview img')).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download image' }).click()
  expect((await download).suggestedFilename()).toMatch(/^folio-\d{4}\.png$/)

  expect(errors).toEqual([])
})

async function sampleLibrary(page: Page) {
  await startOnDevice(page)
  await page.goto('/#/settings')
  await page.getByRole('button', { name: /sample library/ }).click()
}

test('log progress in one tap from Today', async ({ page }) => {
  const errors = watchErrors(page)
  await sampleLibrary(page)
  await page.goto('/#/')
  const card = page.locator('.now-card').first()
  const before = await card.locator('.now-progress-row span').first().textContent()
  await card.getByRole('button', { name: /^\+(10|15|5)/ }).first().click()
  await expect(card.locator('.now-progress-row span').first()).not.toHaveText(before!)
  // Undo puts it back.
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(card.locator('.now-progress-row span').first()).toHaveText(before!)

  // The sheet's −/+ buttons move the number, and Finished opens on the rating.
  await card.getByRole('button', { name: 'Update…' }).click()
  const field = page.locator('.prog-fields input').first()
  const start = await field.inputValue()
  await page.locator('.prog-nudge button').last().click()
  await expect(field).not.toHaveValue(start)
  await page.keyboard.press('Escape')
  await card.getByRole('button', { name: 'Finished' }).click()
  await expect(page.getByRole('button', { name: 'Mark as read' })).toBeVisible()
  expect(errors).toEqual([])
})

test('what next? narrows want-to-read and starts a book', async ({ page }) => {
  const errors = watchErrors(page)
  await sampleLibrary(page)
  await page.goto('/#/')
  await page.getByRole('link', { name: 'Help me choose' }).click()
  await expect(page.getByRole('heading', { name: /What next/ })).toBeVisible()
  const count = () => page.locator('.next-card').count()
  const all = await count()
  expect(all).toBeGreaterThan(0)
  await page.getByRole('radio', { name: 'Long haul' }).click()
  expect(await count()).toBeLessThanOrEqual(all)
  await page.getByRole('radio', { name: 'Any' }).first().click()
  const first = page.locator('.next-card').first()
  const title = await first.locator('.next-title').textContent()
  await first.getByRole('button', { name: 'Start reading' }).click()
  await expect(page.locator('.next-card', { hasText: title! }).locator('.next-started')).toBeVisible()
  // Starting a book doesn't reshuffle the list.
  await expect(page.locator('.next-card').first().locator('.next-title')).toHaveText(title!)
  await openLibrary(page, '/reading')
  await expect(page.locator('.tile-title', { hasText: title! })).toBeVisible()
  expect(errors).toEqual([])
})

test('stats has a month-by-month reading diary', async ({ page }) => {
  const errors = watchErrors(page)
  await sampleLibrary(page)
  await page.goto('/#/stats')
  await expect(page.getByRole('heading', { name: 'Reading diary' })).toBeVisible()
  expect(await page.locator('.diary-month').count()).toBeGreaterThan(0)
  expect(await page.locator('.diary-day.l1, .diary-day.l2, .diary-day.l3, .diary-day.l4').count()).toBeGreaterThan(0)
  expect(errors).toEqual([])
})

test('desktop: search everything, hover previews, drag onto a pile', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'keyboard, hover and drag are desktop features')
  const errors = watchErrors(page)
  await sampleLibrary(page)

  // ⌘K / Ctrl K: find a book by author and open it.
  await page.goto('/#/')
  await page.keyboard.press('Control+k')
  const box = page.getByRole('combobox', { name: 'Search Folio' })
  await expect(box).toBeFocused()
  await box.fill('ishiguro')
  await expect(page.getByRole('option').first()).toContainText(/Remains|Klara|Never/)
  await box.press('Enter')
  await expect(page.locator('.book-title')).toHaveText(/Remains|Klara|Never/)
  await page.getByRole('button', { name: 'Search' }).click()
  await page.getByRole('combobox', { name: 'Search Folio' }).fill('stats')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#\/stats/)

  // Hovering a want-to-read book offers to start it.
  await openLibrary(page, '/want')
  const wantBefore = await page.locator('.tile').count()
  await page.locator('.tile-link').first().hover()
  const card = page.locator('.preview-card')
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: 'Start reading' }).click()
  await expect(card).toBeHidden()
  await expect(page.locator('.tile')).toHaveCount(wantBefore - 1)

  // Drag a book onto the Paused pile.
  await openLibrary(page, '/want')
  const title = await page.locator('.tile-title').first().textContent()
  await page.locator('.tile-link').first().dragTo(page.locator('.pile', { hasText: 'Paused' }))
  await expect(page.getByText(/Moved 1 book to Paused/)).toBeVisible()
  await openLibrary(page, '/paused')
  await expect(page.locator('.tile-title', { hasText: title! })).toBeVisible()
  expect(errors).toEqual([])
})

test('offers to reload when a newer version has been deployed', async ({ page }) => {
  const errors = watchErrors(page)
  await startOnDevice(page)
  await expect(page.locator('.update-notice')).toHaveCount(0)
  // Pretend a new build went live: version.json now names a different build.
  await page.route('**/version.json*', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'newer-build' }) }))
  // Refresh lives in the sidebar on desktop and in Settings on every screen size.
  await page.goto('/#/settings')
  await page.getByRole('button', { name: 'Refresh library' }).filter({ visible: true }).first().click()
  const notice = page.getByRole('region', { name: 'Update available' })
  await expect(notice).toContainText('A new version of Folio is ready')
  await expect(notice.getByRole('button', { name: 'Reload' })).toBeVisible()
  // "Not now" hides it until a newer build than that one appears.
  await notice.getByRole('button', { name: 'Not now' }).click()
  await expect(notice).toHaveCount(0)
  expect(errors).toEqual([])
})

test('library sorts every which way, remembers it, and heads each series', async ({ page }) => {
  const errors = watchErrors(page)
  await startOnDevice(page)
  await page.goto('/#/settings')
  await page.getByRole('button', { name: /sample library/ }).click()
  await openLibrary(page)
  await page.getByRole('radio', { name: 'Grid' }).click()
  const sortBox = page.getByRole('combobox', { name: 'Sort' })

  // Title, A to Z, then reversed.
  await sortBox.selectOption('title')
  const first = await page.locator('.tile-title').first().textContent()
  await page.getByRole('button', { name: /^Order: A → Z\. Reverse$/ }).click()
  await expect(page.getByRole('button', { name: /^Order: Z → A\. Reverse$/ })).toBeVisible()
  expect(await page.locator('.tile-title').first().textContent()).not.toBe(first)

  // Series: a heading per series, volumes in order; the choice survives a reload.
  await sortBox.selectOption('series')
  const dune = page.locator('.lib-group', { has: page.getByRole('link', { name: 'Dune', exact: true }) })
  await expect(dune.locator('.tile-title')).toHaveText(['Dune', 'Dune Messiah'])
  await expect(page.locator('.lib-group-head').last()).toContainText('Not in a series')
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Sort' })).toHaveValue('series')
  await page.getByRole('radio', { name: 'List' }).click()
  await expect(page.locator('.tgroup').first()).toBeVisible()

  for (const s of ['activity', 'genre', 'format', 'pile', 'started', 'published', 'progress', 'timesRead', 'publisher', 'length', 'rating', 'author', 'finished', 'added']) {
    await page.getByRole('combobox', { name: 'Sort' }).selectOption(s)
  }
  expect(errors).toEqual([])
})

test('the library opens on spines by default, first in the view picker', async ({ page }) => {
  const errors = watchErrors(page)
  await startOnDevice(page)
  await page.goto('/#/settings')
  await page.getByRole('button', { name: /sample library/ }).click()
  await openLibrary(page)
  await expect(page.locator('.spine-shelf').first()).toBeVisible()
  const views = page.getByRole('radiogroup', { name: 'View' }).getByRole('radio')
  await expect(views.first()).toHaveAccessibleName('Spines on a shelf')
  await expect(views.first()).toBeChecked()
  // Another view, once chosen, is remembered.
  await page.getByRole('radio', { name: 'Grid' }).click()
  await page.reload()
  await expect(page.getByRole('radio', { name: 'Grid' })).toBeChecked()
  expect(errors).toEqual([])
})
