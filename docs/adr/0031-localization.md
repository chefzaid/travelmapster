# ADR 0031: Localization

- Status: Accepted
- Date: 2026-10-26

## Context

The app speaks English only. The roadmap asks for French, Spanish, German and Arabic, with Arabic
read right to left, and for country names from Natural Earth's localized fields. The frontend
is build-free ([ADR 0002](0002-single-service-build-free-frontend.md)), so the approach must work
without a bundler, and the server's own messages (API errors) reach travelers as toasts.

## Decision

- **English is the key.** Modules call `t('Trip saved.')` and `tn(count, '{count} day',
  '{count} days')` from `public/js/i18n.js`. Each language has one flat catalog,
  `public/locales/<locale>.json`, mapping the English text to its translation, with `{name}`
  placeholders and, for counts, the plural forms `Intl.PluralRules` names for that language
  (Arabic has six). A missing entry falls back to the English, so a new string never breaks
  the page. No library: the whole mechanism is a few dozen lines.
- **The pages' own markup** marks text with `data-i18n` and attributes with `data-i18n-attr`
  (such as `aria-label placeholder`); the English stays in the HTML and is translated at
  start-up.
- **Choosing the language.** The browser's languages decide at first (`fr-CA` gives French,
  anything unsupported English); Settings and the landing page offer a choice, kept in this
  browser's storage, and the page reloads in the new language. The choice is per device, like
  the browser's own language.
- **Countries** are named in the interface's language from Natural Earth's `NAME_FR`,
  `NAME_ES`, `NAME_DE` and `NAME_AR`, added to the bundled borders as `names`; a country is
  found by its name in any of the five languages. Town names stay as GeoNames writes them.
- **Dates, numbers and money** follow the interface's language through `Intl`.
- **Server messages** stay in English in the API (its contract,
  [ADR 0019](0019-api-description-and-versioning.md)); the client shows the catalog's
  translation of an error when it has one. Messages with a traveler's own values in them stay
  English.
- **Right to left.** Arabic sets `dir="rtl"` on the page; styles use logical properties
  (`margin-inline-start`, `inset-inline-end`) so the layout mirrors, while the map, dates and
  numbers keep their own direction.
- **Checks.** `scripts/i18n.js` lists every key in the code and the markup; a unit test fails
  when a catalog misses one, keeps one no longer used, or drops a placeholder.

## Consequences

- Translations are drafted by the coding agent and want a native speaker's review before
  launch in each market; corrections are edits to a JSON file.
- Every new interface string needs its translations in the same change, which the test enforces.
- Saved places keep the name they were saved under, in whatever language that was; they are
  still found and counted, as every language's names point to the same country.
