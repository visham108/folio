# Folio

A calm, flexible home for everything you read and listen to: print, ebook and audiobooks, with
rereads, editions and stats that are worth looking at.

## What's here

| Area | What it does |
|---|---|
| **Works & editions** | One entry per book, with many editions (paperback, hardcover, ebook, audiobook, translations, retitled releases). You pick which edition is "yours". |
| **Duplicate detection** | When you add a book, Folio checks your library and the shared catalogue for the same book: ISBN first, then fuzzy title/author matching that copes with subtitles, series suffixes, initials and typos. You confirm, and the match becomes a new edition rather than a duplicate. |
| **Quick logging** | Today has one-tap buttons for each book you're reading (+10 / +25 pages, +15 / +30 minutes, or +5 / +10 %), with an undo, plus *Finished*. The progress sheet has −/+ buttons too. |
| **What next?** | Narrows your want-to-read pile by length, format, genre, mood and what you own, then suggests books with the reasons they fit (next in a series, how long they've waited, about how many days at your pace). |
| **Desktop extras** | ⌘K / Ctrl K searches everything (books, authors, series, shelves, screens). Resting the pointer on a book shows a preview card with quick actions. Drag books onto a pile, *Favourites* or one of your shelves. |
| **Rereads** | Every pass through a book is its own *read* with its own dates, edition and rating. You can reread on audio after a print read. |
| **Piles & shelves** | Want to read · Reading · Read · Paused · DNF, plus your own shelves, tags, favourites and "I own this". See them as covers, a list, a table, or spines on a shelf (spine width follows length; arrange by colour). |
| **Smart shelves** | Shelves that fill themselves and appear only when they hold something: Quick reads, Long haul, Next in a series, Ready to listen, Owned not yet read, Waiting over a year, Unfinished business, Your best, Read more than once, and more. |
| **Series** | Every series gets its own page: reading order, how far through you are, what's next, and other volumes already in the catalogue that you can add in one tap. "Next in your series" also shows on Today. |
| **How it felt** | Optional mood tags (adventurous, dark, hopeful, tense…) and pace (slow, medium, fast) for each book, which feed the mood and pace stats. Imported from StoryGraph automatically. |
| **Adding books** | Search Google Books and Open Library, scan the ISBN barcode with your phone camera, photograph the cover, or type it in. |
| **Cover studio** | Photograph a cover and Folio finds the book, straightens the perspective, fixes colour and contrast, and sharpens it. Books without a cover get a generated typographic one. |
| **Tidy data** | Anything typed in is converted to title case: "the left hand of darkness" becomes *The Left Hand of Darkness*, "j.r.r. tolkien" becomes *J.R.R. Tolkien*. Deliberate casing such as "McCarthy" or "NASA" is kept. |
| **Stats** | Books, pages, hours and *combined* (audio converted to page-equivalents, adjustable) by month and by year, split by format; a reading-days heatmap; streaks; goal pace and a race against your goal; pages a day and listening a week; format mix over the years; book lengths; when your books were written; rating against length; finish rate; days to finish by genre; genres over the years; seasonal rhythm; how long books wait on your want-to-read list; series progress; moods and pace; your year as a shelf of covers; a month-by-month reading diary. Every chart has a table view. *Share your year* makes a 1080×1350 picture of the year (dark or light) to download or share. |
| **Import from anywhere** | Drop in a CSV from Goodreads, StoryGraph, LibraryThing or any spreadsheet. Folio recognises the columns (by name, synonyms and the values themselves) and translates statuses, formats, rating scales (5, 10 or 100), date orders, read-date ranges, rereads, narrators and translators. You review and adjust the mapping before anything is added, and books already in the catalogue are matched rather than duplicated. |
| **Shared catalogue, with an owner** | Anyone can add books and editions; people can edit what they added. One super admin can edit or remove anything, merge duplicate books, and see the full change history. Every catalogue change is logged with who made it and the before/after values. |
| **Your data** | Full backup and restore (JSON), plus spreadsheet exports: a Goodreads-format CSV that Goodreads and StoryGraph can import, and a full CSV with one row per read. |
| **Works offline** | Once loaded, Folio opens without a connection. Changes made offline are saved on the device and sync, in order, when you're back online. |

### What's required when adding a book

Only what you need to find it again:

* **Required:** title, at least one author, format, and which pile it goes on.
* **Recommended:** page count (print/ebook) or length (audiobooks), which the stats need. The form says so if they're missing.
* **Optional:** subtitle, series and number, genres, first-published year, publisher, edition date, ISBN/ASIN, language, translator(s), narrator(s), edition note, cover, start/finish dates and rating.

## Running locally

```bash
npm install
npm run dev
```

With no Supabase configured, the app runs in **on-device mode**: everything is stored in the browser
(IndexedDB). Settings → *Load a sample library* fills it with a demo history so you can explore the stats.

## Turning on Google sign-in and sync (Supabase)

1. Create a project at [supabase.com](https://supabase.com) (the free tier is plenty).
2. Run the migrations in `supabase/migrations/` in order (SQL editor, or `supabase db push`). They create
   the tables, row-level security (your reading data is private; the book catalogue is shared), the
   change history, the super admin, input limits and a `covers` storage bucket (images only, 2 MB max).
   The super admin's email is set in `20261014010000_admin_audit.sql`.
3. **Google login:** in Google Cloud Console create an OAuth client (type *Web application*) and add
   `https://<project-ref>.supabase.co/auth/v1/callback` as an authorised redirect URI. Paste the client
   ID and secret into Supabase → Authentication → Providers → Google.
4. Supabase → Authentication → URL Configuration: add your site URL (e.g.
   `https://<you>.github.io/folio/`) and `http://localhost:5173` to the redirect allow-list.
5. Copy `.env.example` to `.env.local` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
   (Supabase → Project Settings → API).

6. **Email sign-in (optional, off by default):** people can also sign in with a 6-digit code sent to their email. Supabase's
   built-in mailer only delivers to your own team, so connect an SMTP service (Authentication → Emails →
   SMTP Settings; Brevo's free plan works with a verified Gmail sender). Then paste
   `supabase/email-templates/sign-in-code.html` into both the **Magic Link** and **Confirm signup** templates,
   with the subject `Your Folio code: {{ .Token }}`. Finally set `VITE_EMAIL_SIGNIN=1` in `.env.production`
   and add email sign-in to the privacy page.

Sessions persist, so you stay signed in until you sign out.

## Tests

```bash
npm test          # unit tests: title case, matching, importer, exporter, merging, stats, series, offline queue
npm run test:e2e  # browser smoke test (desktop + phone) against the production build
```

Both run automatically on every push (`.github/workflows/ci.yml`).

## Keeping it running

- **Database keep-alive:** Supabase pauses free projects after a week without activity.
  `.github/workflows/keepalive.yml` pings the database once a day. If it ever fails, GitHub emails you.
  GitHub suspends scheduled jobs in repositories with no commits for 60 days; re-enable it from the
  Actions tab if that happens.
- **Backups:** the free tier has no automatic backups. Folio reminds you monthly to download a backup
  (Settings → Download backup), and restoring merges into your library without creating duplicates.
- **Google Books searches:** optional `VITE_GOOGLE_BOOKS_KEY` in `.env.production` lifts the anonymous
  rate limit (restrict the key to your site's address in Google Cloud Console).

## Deploying to GitHub Pages

1. Push this repository to GitHub.
2. Repository → Settings → Pages → Source: **GitHub Actions**.
3. The Supabase URL and publishable key live in `.env.production` (they're public by design;
   row-level security protects the data).
4. Push to `main`. The workflow in `.github/workflows/deploy.yml` builds and publishes the site.

The app uses hash routing and relative asset paths, so it works from any sub-path.

## Code map

```
src/
  lib/types.ts            data model: Work → Edition, Entry → Read → LogPoint
  lib/match.ts            fuzzy duplicate / edition matcher
  lib/stats.ts            completions, yearly summaries, heatmap, streaks
  lib/image.ts            cover detection, perspective warp, enhancement
  lib/importer.ts         CSV import with column/value detection
  lib/exporter.ts         Goodreads-format and full CSV export
  lib/series.ts           series ordering and progress
  lib/smartShelves.ts     self-filling shelves
  lib/offline.ts          offline snapshot cache and outbox
  lib/titleCase.ts        title/name casing for typed input
  lib/lookup.ts           Google Books + Open Library search
  lib/localBackend.ts     on-device storage (IndexedDB)
  lib/supabaseBackend.ts  cloud storage and auth
  state/store.tsx         in-memory library with optimistic writes
  pages/                  Today, Library, Book, Series, Add, Stats, Settings, Login
  components/             covers, charts, sheets, cover studio, scanner…
public/sw.js              service worker: app shell offline
supabase/
  migrations/             schema + RLS
```
