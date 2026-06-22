# JobTailor AI — Cover Letter & Resume

A Chrome extension that extracts a job description from the page you're on and
generates a tailored, ATS-friendly resume (and matching cover letter) using AI.

It runs entirely in your browser. There is no backend server — generation calls
go straight from the extension to the [Groq](https://groq.com) API using a key
you provide. The Groq free tier costs nothing, so the AI is free.

## Features

- **Resume** — parses your background text, scrapes your public GitHub repos for
  real project detail, and produces a one-page US-Letter resume tailored to the
  job, rendered in a new tab (print to PDF with `Ctrl+P`).
- **Cover letter** — role-specific letter grounded only in your resume facts,
  with selectable tone and length.
- **Job extraction** — pulls the job description from the active tab, or paste it
  manually.

## Install (Load unpacked)

No Chrome Web Store listing required — install directly from the source folder.

1. Download or clone this repo to a folder on disk:
   ```
   git clone https://github.com/davidrencse/resume-tailor-ai.git
   ```
2. Open `chrome://extensions` (works in Chrome, Edge, Brave).
3. Toggle **Developer mode** on (top-right).
4. Click **Load unpacked** and select the `resume-tailor-ext` folder.
5. Pin the extension, or open it with `Ctrl+Shift+Y` (`Cmd+Shift+Y` on macOS).

> Loading unpacked shows a "Developer mode extensions" warning on each browser
> restart — that's expected and harmless.

## Setup

1. Get a free Groq API key at <https://console.groq.com/keys> (no card required).
2. Open the extension's **⚙ Options** page.
3. Paste your Groq key.
4. Fill **About You** with your background — education, work, projects, skills,
   certificates. The more detail, the better the output.
5. (Optional) Set your GitHub username so repos are scraped for project detail.
6. Save.

## Usage

1. Open a job posting in a tab.
2. Open the extension popup.
3. Click **Extract** (or paste the job description) — press `e` as a shortcut.
4. **Generate Resume → New Tab**, or switch to the Cover Letter tab and generate.
5. Print the resume tab to PDF with `Ctrl+P`.

## Models

Uses Groq's free-tier models. Default `llama-3.3-70b-versatile`, with
`llama-3.1-8b-instant` as the rate-limit fallback. Selectable in Options.

## Privacy

See [PRIVACY.md](PRIVACY.md). In short: your data stays in your browser and is
sent only to the AI/GitHub APIs needed to generate output. Nothing is collected
by the developer.

## Permissions

- `storage` — save your settings and background text locally.
- `activeTab` — read the current tab's text when you click Extract.
- `<all_urls>` content script — extract job descriptions from any job site.
- Host access to `api.groq.com` (generation), `api.github.com` (repo scrape),
  and `api.openai.com` / `api.anthropic.com` (reserved for future providers).
