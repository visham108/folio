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
