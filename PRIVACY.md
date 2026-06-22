# Privacy Policy — JobTailor AI

_Last updated: 2026-06-22_

JobTailor AI ("the extension") is a browser extension that generates tailored
resumes and cover letters. This policy explains what data it handles and where
that data goes. The extension has no backend server operated by the developer
and performs no analytics or tracking.

## Data the extension handles

- **Settings you enter** — your Groq API key, selected model, full name, and
  GitHub username.
- **Background text** — the "About You" information you paste (education, work,
  projects, skills, certificates).
- **Job description text** — extracted from the page you're viewing, or pasted
  by you.
- **Generated output** — the resume and cover letter the AI produces.

## Where data is stored

All of the above is stored **locally in your browser** using Chrome's
`storage.local` and `storage.session` APIs. None of it is transmitted to or
stored by the developer. There is no developer-operated server or database.

## Where data is sent

To generate output, the extension sends data directly from your browser to
third-party APIs that you have configured:

- **Groq API** (`api.groq.com`) — receives your background text and the job
  description in order to generate the resume and cover letter. Governed by
  [Groq's privacy policy](https://groq.com/privacy-policy/).
- **GitHub API** (`api.github.com`) — receives your GitHub username to fetch your
  public repositories and READMEs for project detail. Only public data is read;
  no authentication or private-repo access is used.

The host permissions for `api.openai.com` and `api.anthropic.com` are reserved
for optional future providers and are not contacted unless you explicitly select
such a provider.

## Your API key

Your Groq API key is stored only in your browser's local storage and is sent
only to Groq to authenticate generation requests. The developer never receives
it. You can remove it at any time from the Options page.

## Page content access

The extension's content script reads text from the page only when you click
**Extract** (or its shortcut), to capture the job description. It does not read,
log, or transmit page content at any other time, and it sends nothing anywhere
on its own.

## Data retention and deletion

Data persists in your browser until you clear it. To delete everything, remove
your saved values in Options, or uninstall the extension — uninstalling clears
all extension storage.

## Children

The extension is not directed at children under 13 and does not knowingly handle
their data.

## Changes

This policy may be updated; the date above reflects the latest revision.

## Contact

Questions: cs.davidren@gmail.com
