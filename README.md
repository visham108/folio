# Folio

A calm, flexible home for everything you read and listen to: print, ebook and audiobooks, with
rereads, editions and stats that are worth looking at.

## What's here

| Area | What it does |
|---|---|
| **Works & editions** | One entry per book, with many editions (paperback, hardcover, ebook, audiobook, translations, retitled releases). You pick which edition is "yours". |
| **Duplicate detection** | When you add a book, Folio checks your library and the shared catalogue for the same book: ISBN first, then fuzzy title/author matching that copes with subtitles, series suffixes, initials and typos. You confirm, and the match becomes a new edition rather than a duplicate. |
| **Rereads** | Every pass through a book is its own *read* with its own dates, edition and rating. You can reread on audio after a print read. |
| **Piles & shelves** | Want to read · Reading · Read · Paused · DNF, plus your own shelves, tags, favourites and "I own this". |
| **Adding books** | Search Google Books and Open Library, scan the ISBN barcode with your phone camera, photograph the cover, or type it in. |
| **Cover studio** | Photograph a cover and Folio finds the book, straightens the perspective, fixes colour and contrast, and sharpens it. Books without a cover get a generated typographic one. |
| **Tidy data** | Anything typed in is converted to title case: "the left hand of darkness" becomes *The Left Hand of Darkness*, "j.r.r. tolkien" becomes *J.R.R. Tolkien*. Deliberate casing such as "McCarthy" or "NASA" is kept. |
| **Stats** | Books, pages, hours and *combined* (audio converted to page-equivalents, adjustable) by month and by year, split by format; a reading-days heatmap; streaks; goal pace; longest, shortest and fastest reads; ratings, authors and genres; your year as a shelf of covers. Every chart has a table view. |
| **Goodreads import** | Drop in the Goodreads export CSV. Shelves, ratings, reviews, dates and read counts all come across, matched against the catalogue. |
| **Your data** | JSON export/restore at any time. |

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
2. Run the schema: paste `supabase/migrations/20261014000000_init.sql` into the SQL editor, or
   `supabase db push` with the CLI. It creates the tables, row-level security (your reading data is
   private; the book catalogue is shared) and a public `covers` storage bucket.
3. **Google login:** in Google Cloud Console create an OAuth client (type *Web application*) and add
   `https://<project-ref>.supabase.co/auth/v1/callback` as an authorised redirect URI. Paste the client
   ID and secret into Supabase → Authentication → Providers → Google.
4. Supabase → Authentication → URL Configuration: add your site URL (e.g.
   `https://<you>.github.io/folio/`) and `http://localhost:5173` to the redirect allow-list.
5. Copy `.env.example` to `.env.local` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
   (Supabase → Project Settings → API).

Sessions persist, so you stay signed in until you sign out.

## Deploying to GitHub Pages

1. Push this repository to GitHub.
2. Repository → Settings → Pages → Source: **GitHub Actions**.
3. Repository → Settings → Secrets and variables → Actions → **Variables**: add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` (the anon key is meant to be public; row-level security protects the data).
4. Push to `main`. The workflow in `.github/workflows/deploy.yml` builds and publishes the site.

The app uses hash routing and relative asset paths, so it works from any sub-path.

## Code map

```
src/
  lib/types.ts            data model: Work → Edition, Entry → Read → LogPoint
  lib/match.ts            fuzzy duplicate / edition matcher
  lib/stats.ts            completions, yearly summaries, heatmap, streaks
  lib/image.ts            cover detection, perspective warp, enhancement
  lib/goodreads.ts        CSV import
  lib/titleCase.ts        title/name casing for typed input
  lib/lookup.ts           Google Books + Open Library search
  lib/localBackend.ts     on-device storage (IndexedDB)
  lib/supabaseBackend.ts  cloud storage and auth
  state/store.tsx         in-memory library with optimistic writes
  pages/                  Today, Library, Book, Add, Stats, Settings, Login
  components/             covers, charts, sheets, cover studio, scanner…
supabase/
  migrations/             schema + RLS
```
