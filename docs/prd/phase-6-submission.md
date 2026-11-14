# Phase 6 — Deploy, project page, deck, video, submit

> Read [`00-contracts.md`](00-contracts.md) first. File formats, coordinates and units are defined there and override anything below.

**Owner:** Archisha (deck, text, video) + Dev (deploy, final submit). **Branch:** `archisha/p6-submission`. **Window:** hours 20–30, but the deck skeleton, `docs/submission.md` and `docs/references.md` are kept current from the start.

## Hard rules (breaking any makes the project ineligible)

- Submit before **Sunday 15 Nov, 23:59 local**. Resubmitting is allowed; the last save counts.
- Deck: **7 slides maximum**, including title and intro. Video: **30 seconds maximum**.
- Everything in English (a video may be spoken in another language with English subtitles).
- Every link opens without login. Test in a private window.
- All external data, code, text and images listed in References.
- No NASA logos, flags or mission identifiers in anything we made. AI-generated images or video would need a visible watermark — we use none.
- No images, video or audio of anyone under 18.
- All team members registered at the same event and shown on the team page.

## Fixed points

- **Hour 14:** first public deploy, however rough.
- **Sunday 18:00:** first real "Submit for Judging" with whatever exists.
- **Sunday 22:00:** code freeze. After this: links, text, final submit only.

## Deliverables

1. **Deploy:** static build on a public host; tiles on the same host or a public bucket. If it is a new domain, request a FortiGuard web-filter classification (education / web-based application).
2. **Project page text** in `docs/submission.md`, one section per form field:
   - Project name; high-level summary (what, how it answers the challenge, why it matters).
   - Detailed description, as direct answers to: what exactly does it do; how does it work; what benefits does it have; what do we hope to achieve; what tools, languages, hardware and software did we use. Include the validation number, the stated limits, and one screenshot per view (page accepts JPG/PNG/GIF up to 10 MB).
   - Use of AI: where and how AI tools were used.
   - NASA data: specific datasets and what each is used for.
   - Space Agency Partner data and other references: from `docs/references.md`.
3. **Deck (the demo link), 7 slides:** title, team and challenge · the problem at walk scale · the layered map · route and budgets · walk and visor · validated on an unseen site · data sources and what comes next. Must show team name, member names and the challenge chosen. Few words, large type, real screenshots.
4. **Video, ≤30 s** (linked from the deck and the project site). Proposed shots, to confirm with Dev before recording: layers stack up · stops dropped, route draws with budgets · walk and visor with rover photos · switch to Jezero. Follows the guide's beats: who we are, the challenge, the name, how it works, what it could become.

## Done when

- Every link opened logged-out by someone other than its author.
- Slide count ≤ 7 and video length ≤ 30 s, both checked.
- References compared against `docs/references.md`, `app/package.json` and the Python environment.
- "Submit for Judging" clicked and the confirmation banner seen.

## Additions (contracts v1)

- Partner agencies to credit, each confirmed against the instrument's official page before submission: ESA (Mars Express), Spain (REMS, MEDA), Canada (APXS), and UAE (Hope) only if used.
- App on Vercel, tiles on Cloudflare R2, both on personal accounts.
