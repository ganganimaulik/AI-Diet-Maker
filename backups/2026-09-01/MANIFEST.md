# Database backup — 2026-09-01

Sanitized snapshot of the `diet-maker` MongoDB Atlas database.

> **This is a redacted backup, safe for a public repo.**
> It is *not* a complete disaster-recovery image — every credential and every
> WhatsApp identifier has been stripped. After restoring you must re-enter your
> API keys in Settings and re-link WhatsApp by scanning a new QR code.

## Files

| File | Documents | Size |
|------|-----------|------|
| `cachedresponses.json` | 7 | 724.0 KB |
| `configs.json` | 1 | 20.1 KB |
| `contacts.json` | 11 | 1.5 KB |
| `generationjobs.json` | 7 | 887.9 KB |
| `schedulers.json` | 1 | 0.7 KB |
| `verificationresults.json` | 0 | 0.0 KB |
| `whatsappstates.json` | 1 | 0.3 KB |

## Included in full

- **`configs.json`** — the important one. Meals, ingredients, custom splits,
  `dailyVariables`, `dailySplits`, global targets (calorie target, olive oil,
  sodium/potassium ratio), model + verification settings.
- **`cachedresponses.json`** — generated diet plan text per day, with `configHash`.
- **`generationjobs.json`** — generation job records including plan and thinking text.
- **`verificationresults.json`** — plan verification verdicts (currently empty).
- **`schedulers.json`** — schedule time, timezone, enabled flag, last-sent state, retry state.
- **`whatsappstates.json`** — connection status and `authFailureCount` only.

## Redacted — replaced with `<REDACTED>`

Credentials:

| Collection | Fields |
|---|---|
| `configs` | `apiKey`, `fireworksApiKey`, `enterpriseApiKey`, `enterpriseServiceAccountJson`, `huggingFaceToken`, `enterpriseProjectId` |
| `whatsappstates` | `qr`, `connectedPhone`, `connectedName` |

WhatsApp identifiers (phone numbers of real people):

| Collection | Fields |
|---|---|
| `contacts` | `id`, `name` — all 11 documents |
| `schedulers` | `recipientId`, `recipientName`, `userRecipientId`, `userRecipientName` |

`contacts` is only a cache of the WhatsApp address book; it re-syncs
automatically once WhatsApp is linked again, so nothing is lost by redacting it.
The scheduler recipients must be re-picked from the dropdown after a restore.

## Excluded entirely — not present in any file here

| Collection | Documents | Why |
|---|---|---|
| `whatsapp-RemoteAuth-session.files` | 1 | WhatsApp login session (GridFS) |
| `whatsapp-RemoteAuth-session.chunks` | 76 (~19 MB) | WhatsApp login session payload (GridFS) |

These hold the live WhatsApp authentication session. Publishing them would let
anyone take over the linked WhatsApp account, so they are never exported.

## Restoring

Each file is an array of MongoDB Extended JSON documents.

```bash
mongoimport --uri="$MONGODB_URI" --collection=configs --file=configs.json --jsonArray --drop
```

Restore `configs` first, then re-enter API keys in the app's Settings tab and
re-link WhatsApp from the Connections tab.
