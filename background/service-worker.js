const DEFAULT_SETTINGS = {
  groqApiKey: "",
  model: "llama-3.3-70b-versatile", // confirmed available on free tier
  fullName: "",
  githubUser: "" // optional; if empty we parse it from the About You text
};

// Groq decommissioned these — a stale saved setting pointing at one 400s every call,
// silently failing generation and leaving the user on an old tab. Auto-correct to default.
const DEAD_MODELS = new Set([
  "mixtral-8x7b-32768",
  "gemma2-9b-it",
  "gemma-7b-it",
  "llama3-70b-8192",
  "llama3-8b-8192",
  "llama2-70b-4096",
  "qwen/qwen3-32b", // thinking model — burns max_tokens on reasoning, truncates JSON
  "meta-llama/llama-4-maverick-17b-128e-instruct", // 404 — not on free tier
  "meta-llama/llama-4-scout-17b-16e-instruct"      // 404 — not on free tier
]);

async function getSettings() {
  const stored = await chrome.storage.local.get("settings");
  const s = { ...DEFAULT_SETTINGS, ...(stored.settings ?? {}) };
  if (!s.model || DEAD_MODELS.has(s.model)) {
    console.warn(`Model "${s.model}" invalid/decommissioned — using ${DEFAULT_SETTINGS.model}`);
    s.model = DEFAULT_SETTINGS.model;
  }
  return s;
}

// ── GitHub scraper ──────────────────────────────────────────────────────────
// Pull the user's public repos + README excerpts so the AI has rich, real project
// source material instead of the thin one-liners in the About You text.

function extractGithubUser(text) {
  const m = String(text || "").match(/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)/i);
  return m ? m[1] : null;
}

async function fetchGithubReadme(user, repo) {
  try {
    const res = await fetch(`https://api.github.com/repos/${user}/${repo}/readme`, {
      headers: { "Accept": "application/vnd.github.raw+json" }
    });
    if (!res.ok) return "";
    const txt = await res.text();
    // Strip markdown noise, collapse whitespace, cap length.
    return txt.replace(/```[\s\S]*?```/g, " ").replace(/[#>*_`|-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 1200);
  } catch { return ""; }
}

// Repos that are not real software projects — skip outright.
const JUNK_REPO_RE = /^(resume|cv|curriculum|portfolio|dotfiles|\.?config|configs?|setup|test|tests|temp|tmp|scratch|sandbox|hello[-_]?world|learning|notes|playground|practice)$/i;

async function fetchGithubProjects(user, max = 6) {
  const res = await fetch(`https://api.github.com/users/${user}/repos?sort=pushed&per_page=100`, {
    headers: { "Accept": "application/vnd.github+json" }
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  let repos = await res.json();
  if (!Array.isArray(repos)) return [];

  // First filter: real-project candidates only.
  const candidates = repos.filter(r =>
    r && !r.fork && !r.archived && !r.is_template &&
    r.name.toLowerCase() !== user.toLowerCase() && // profile-README repo
    !JUNK_REPO_RE.test(r.name)
  )
  // Take a generous candidate pool by stars+recency, then refine with README content.
  .sort((a, b) => (b.stargazers_count - a.stargazers_count) || (new Date(b.pushed_at) - new Date(a.pushed_at)))
  .slice(0, 14);

  const readmes = await Promise.all(candidates.map(r => fetchGithubReadme(user, r.name)));

  // Score by real-project signal: description + README substance + topics + stars.
  const scored = candidates.map((r, i) => {
    const readme = readmes[i];
    const desc = r.description || "";
    const topics = Array.isArray(r.topics) ? r.topics : [];
    const score =
      (desc ? 2 : 0) +
      (readme.length > 300 ? 3 : readme.length > 80 ? 1 : 0) +
      Math.min(topics.length, 3) +
      (r.language ? 1 : 0) +
      Math.min(r.stargazers_count, 5);
    return { r, readme, desc, topics, score };
  })
  // Drop placeholders: no description AND no real README.
  .filter(x => x.desc || x.readme.length > 80)
  .sort((a, b) => b.score - a.score)
  .slice(0, max);

  return scored.map(({ r, readme, desc, topics }) => ({
    name: r.name,
    url: r.html_url,
    description: desc,
    language: r.language || "",
    topics,
    readme
  }));
}

function formatGithubBlock(projects) {
  if (!projects.length) return "";
  const blocks = projects.map(p => {
    const parts = [`### ${p.name} (${p.url})`];
    if (p.language)       parts.push(`Primary language: ${p.language}`);
    if (p.topics.length)  parts.push(`Topics: ${p.topics.join(", ")}`);
    if (p.description)    parts.push(`Description: ${p.description}`);
    if (p.readme)         parts.push(`README: ${p.readme}`);
    return parts.join("\n");
  });
  // Supplementary, NOT authoritative — projects described in the About text above stay primary.
  // GitHub repos only enrich those, or fill in when the About text has too few projects.
  return `\n\n## SUPPLEMENTARY GITHUB REPOS (use only to enrich the projects already described above, ` +
         `or to add a project when fewer than 3 are described. Prefer the projects from the background text.)\n${blocks.join("\n\n")}`;
}

const GH_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min — survives a heavy regen session

// Enrich About You text with scraped GitHub data. Never throws — scrape failure
// just falls back to the plain About You text. Caches per-user in session storage so a
// regen-heavy session doesn't exhaust GitHub's 60 req/hr unauthenticated limit.
// Returns { text, projects } — projects (structured) are also used to PAD the resume to 3.
async function enrichWithGithub(aboutText, settingsUser) {
  const user = (settingsUser && settingsUser.trim()) || extractGithubUser(aboutText);
  if (!user) return { text: aboutText, projects: [] };

  const cacheKey = `gh_cache_${user.toLowerCase()}`;
  try {
    const cached = (await chrome.storage.session.get(cacheKey))[cacheKey];
    if (cached && (Date.now() - cached.ts) < GH_CACHE_TTL_MS) {
      console.log(`[GitHub] using cached scrape for "${user}" (${cached.projects.length} repos)`);
      return { text: aboutText + formatGithubBlock(cached.projects), projects: cached.projects };
    }
    const projects = await fetchGithubProjects(user);
    console.log(`[GitHub] scraped ${projects.length} repos for "${user}"`);
    await chrome.storage.session.set({ [cacheKey]: { ts: Date.now(), projects } });
    return { text: aboutText + formatGithubBlock(projects), projects };
  } catch (e) {
    console.warn(`[GitHub] scrape failed for "${user}": ${e.message}`);
    return { text: aboutText, projects: [] };
  }
}

// Build 3 resume bullets from a scraped repo's description + README. Used to pad the
// projects section up to 3 when the model returns fewer.
function githubRepoToProject(repo) {
  const text = `${repo.description || ""}. ${repo.readme || ""}`;
  const sentences = text.split(/(?<=[.!?])\s+/).map(s => s.trim())
    .filter(s => s.length > 25 && s.length < 160);
  let highlights = sentences.slice(0, 3);
  while (highlights.length < 3) {
    highlights.push(`Built ${repo.name}${repo.language ? ` in ${repo.language}` : ""}, a project on GitHub demonstrating practical engineering skills.`);
  }
  const keywords = (repo.topics && repo.topics.length ? repo.topics : [repo.language])
    .filter(Boolean).filter(k => !/^tech(nology)?$/i.test(k)).slice(0, 5);
  if (!keywords.length && repo.language) keywords.push(repo.language);
  return { name: repo.name, url: repo.url, location: "Remote", keywords, highlights: highlights.slice(0, 3) };
}

// Parse certificates straight from the About You text as a fallback for when the model
// omits the certificates section. Handles "Issuer:" headings with "* cert" bullets or
// inline "Issuer: a, b, c" lists.
function parseCertsFromAbout(text) {
  const lines = String(text || "").split(/\r?\n/);
  let i = lines.findIndex(l => /(certif|licen)/i.test(l) && /^#{0,3}\s*[A-Za-z]/.test(l.trim()));
  if (i === -1) i = lines.findIndex(l => /^(certif|licen)/i.test(l.trim()));
  if (i === -1) return [];

  const certs = [];
  let issuer = "Other";
  for (i = i + 1; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    if (/^#{1,3}\s+/.test(lines[i]) && !/(certif|licen)/i.test(raw)) break; // next section ends certs

    const bullet = raw.replace(/^[*\-•]\s*/, "").trim();
    const isBullet = bullet !== raw;
    const issuerMatch = raw.match(/^([A-Za-z0-9 .&/+-]+):\s*(.*)$/);

    if (issuerMatch && !isBullet) {
      issuer = issuerMatch[1].trim();
      for (const c of (issuerMatch[2] || "").split(",").map(s => s.trim()).filter(Boolean))
        certs.push({ name: c, issuer });
    } else if (bullet) {
      certs.push({ name: bullet, issuer });
    }
  }
  return certs;
}

// Guarantee the resume has at least `want` projects by padding from scraped GitHub repos.
function padProjectsFromGithub(resume, ghProjects, want = 3) {
  if (!Array.isArray(resume.projects)) resume.projects = [];
  const have = new Set(resume.projects.map(p => (p.name || "").toLowerCase()));
  for (const repo of ghProjects) {
    if (resume.projects.length >= want) break;
    if (have.has(repo.name.toLowerCase())) continue;
    resume.projects.push(githubRepoToProject(repo));
    have.add(repo.name.toLowerCase());
  }
  return resume;
}

function forceArray(v) {
  if (Array.isArray(v)) return v.filter(x => x != null).map(String).filter(Boolean);
  if (typeof v === "string") return v.split(",").map(s => s.trim()).filter(Boolean);
  if (v && typeof v === "object") return Object.values(v).filter(x => x != null).map(String).filter(Boolean);
  return [];
}

function toSectionArray(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (v && typeof v === "object") return Object.values(v).filter(Boolean);
  return [];
}

// Hard one-page budget. The prompt asks for relevance + one-page fit, but the model can over-produce
// and push the certificates section onto a second page (where it's lost on print). This caps volume so
// the rendered resume always fits one US Letter page WITH certificates. Certs/education are never trimmed.
function enforceResumeBudget(resume) {
  // Matches the reference resume.pdf exactly: 3 experience × 3 bullets, 3 projects × 3 bullets.
  const MAX_WORK = 3, MAX_WORK_BULLETS = 3;
  const MAX_PROJECTS = 3, MAX_PROJECT_BULLETS = 3;
  const MAX_SKILL_ROWS = 6;

  if (Array.isArray(resume.work)) {
    resume.work = resume.work.slice(0, MAX_WORK).map(w => {
      if (w && Array.isArray(w.highlights)) w.highlights = w.highlights.slice(0, MAX_WORK_BULLETS);
      return w;
    });
  }
  if (Array.isArray(resume.projects)) {
    resume.projects = resume.projects.slice(0, MAX_PROJECTS).map(p => {
      if (p && Array.isArray(p.highlights)) p.highlights = p.highlights.slice(0, MAX_PROJECT_BULLETS);
      return p;
    });
  }
  if (Array.isArray(resume.skills)) {
    resume.skills = resume.skills.slice(0, MAX_SKILL_ROWS);
  }
  return resume;
}

// Trim bullets that exceed one line at 11pt Times New Roman on 7.12in text width (~93 chars avg).
// Prompt tells AI to fill the line; this is the safety net preventing any second-line wrap.
function validateBullets(resume) {
  // CSS `white-space: nowrap` on .bullet already prevents any 2-line wrap, so this trim
  // only guards against an absurdly long bullet overflowing far past the margin. Keep it
  // high so normal full-width bullets (~100-110 chars) are NOT shortened — shortening here
  // is what leaves the 1-2-word gap at the right edge.
  const HARD_MAX = 118;

  function trimBullet(text) {
    if (typeof text !== "string") return text;
    if (text.length <= HARD_MAX) return text;
    // Cut at last word boundary before HARD_MAX
    const cut = text.lastIndexOf(" ", HARD_MAX);
    return cut > 40 ? text.slice(0, cut) : text.slice(0, HARD_MAX);
  }

  for (const w of (resume.work || [])) {
    if (Array.isArray(w.highlights)) w.highlights = w.highlights.map(trimBullet);
  }
  for (const p of (resume.projects || [])) {
    if (Array.isArray(p.highlights)) p.highlights = p.highlights.map(trimBullet);
  }
  return resume;
}

function normalizeResumeArrays(resume) {
  // Ensure all top-level sections are arrays
  for (const sec of ["work","education","skills","projects","certificates"]) {
    resume[sec] = toSectionArray(resume[sec]);
  }

  // Skills: items might be strings ("Python, C++") or objects {name, keywords}
  resume.skills = resume.skills.map((s, i) => {
    if (!s) return null;
    if (typeof s === "string") return { name: `Skills ${i + 1}`, keywords: forceArray(s) };
    if (typeof s === "object") { s.keywords = forceArray(s.keywords); return s; }
    return null;
  }).filter(Boolean);

  // Work: highlights might be missing or wrong type
  for (const w of resume.work) {
    if (w && typeof w === "object") w.highlights = forceArray(w.highlights);
  }

  // Education: courses are "Category: a, b, c" grouped strings — never split on commas
  for (const e of resume.education) {
    if (e && typeof e === "object") {
      if (typeof e.courses === "string") {
        e.courses = e.courses.trim() ? [e.courses.trim()] : [];
      } else {
        e.courses = toSectionArray(e.courses).map(String).filter(Boolean);
      }
    }
  }

  // Projects: both fields might be wrong type
  for (const p of resume.projects) {
    if (p && typeof p === "object") {
      p.highlights = forceArray(p.highlights);
      p.keywords   = forceArray(p.keywords);
    }
  }

  return resume;
}

async function loadPrompt(name) {
  const url = chrome.runtime.getURL(`prompts/${name}.txt`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Prompt file not found: prompts/${name}.txt (${res.status})`);
  return res.text();
}

// Repair truncated JSON (model hit max_tokens mid-output). Single pass tracks
// string state + open-bracket stack, then closes everything cleanly so partial
// resumes still render every COMPLETE object instead of failing or dropping silently.
function repairJson(s) {
  let inStr = false, escaped = false;
  const stack = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") stack.push("}");
    else if (c === "[") stack.push("]");
    else if (c === "}" || c === "]") stack.pop();
  }
  let out = s;
  if (inStr) out += '"';                       // truncated inside a string value → close it
  out = out.replace(/,\s*$/, "");              // dangling comma
  out = out.replace(/,?\s*"[^"]*"\s*:\s*$/, ""); // dangling "key": with no value
  out = out.replace(/,\s*$/, "");
  while (stack.length) out += stack.pop();     // close all open brackets, innermost first
  return out;
}

function extractJson(raw) {
  // Strip <think>...</think> blocks (Qwen3, o1-style models) before parsing
  const noThink = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const cleaned = noThink.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = cleaned.indexOf("{");
  if (start === -1)
    throw new Error(`No JSON object found in AI response. Got: ${cleaned.slice(0, 200)}`);
  const candidate = cleaned.slice(start);

  // Fast path: well-formed output ends with a closing brace.
  const end = candidate.lastIndexOf("}");
  if (end > 0) {
    try { return JSON.parse(candidate.slice(0, end + 1)); } catch { /* fall through to repair */ }
  }
  // Slow path: output was truncated mid-stream — repair and parse.
  try {
    return JSON.parse(repairJson(candidate));
  } catch (e) {
    throw new Error(`JSON parse failed even after repair: ${e.message}. Response start: ${candidate.slice(0, 200)}`);
  }
}

const FALLBACK_MODEL = "llama-3.1-8b-instant"; // confirmed available on free tier; used only when primary 429s

async function callGroq(apiKey, model, messages, { allowFallback = true, maxTokens = 1200, temperature = 0.2 } = {}) {
  async function attempt(m) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({ model: m, temperature, max_tokens: maxTokens, messages })
    });
    if (res.status === 429 && allowFallback && m !== FALLBACK_MODEL) {
      console.warn(`Rate limit on ${m}, falling back to ${FALLBACK_MODEL}`);
      return attempt(FALLBACK_MODEL);
    }
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Groq API error (${res.status}): ${err}`);
    }
    const data = await res.json();
    const choice = data?.choices?.[0];
    const text = choice?.message?.content?.trim();
    if (!text) throw new Error("Groq returned empty response");
    if (choice.finish_reason === "length")
      console.warn(`Output truncated on ${m} (hit max_tokens=${maxTokens}). extractJson will repair partial JSON.`);
    return text;
  }
  return attempt(model);
}

function normDate(v) {
  if (typeof v !== "string") return v;
  const t = v.trim();
  if (!t || /^(present|current|now)$/i.test(t)) return "";
  if (/^\d{4}$/.test(t)) return t;               // keep year-only as YYYY
  if (/^\d{4}-\d{2}$/.test(t)) return `${t}-01`; // YYYY-MM → YYYY-MM-01
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const p = Date.parse(t);
  return isNaN(p) ? "" : new Date(p).toISOString().slice(0, 10);
}

function normalizeDates(resume) {
  const dateFields = { work: ["startDate","endDate"], education: ["startDate","endDate"], certificates: ["date"] };
  for (const [sec, fields] of Object.entries(dateFields)) {
    if (!Array.isArray(resume[sec])) continue;
    for (const item of resume[sec]) {
      for (const f of fields) {
        if (f in item) item[f] = normDate(item[f]);
      }
    }
  }
}

async function generateTailoredResume(aboutText, jobDescription, apiKey, model) {
  const template = await loadPrompt("generate");
  const sysMsg = { role: "system", content: "You are an expert resume writer. Output only valid JSON — no markdown fences, no commentary. Every bullet must be one long dense sentence that fills the full width of a resume line — pack in technology, scale, and outcome. Short bullets are unacceptable." };

  function buildMessages(maxIn = Infinity) {
    const about = maxIn === Infinity ? aboutText : aboutText.slice(0, maxIn);
    const job   = maxIn === Infinity ? jobDescription : jobDescription.slice(0, maxIn);
    const prompt = template.replace(/\[\[about_text\]\]|\[\[job_description\]\]/g, m =>
      m === "[[about_text]]" ? about : job
    );
    return [sysMsg, { role: "user", content: prompt }];
  }

  let text;
  try {
    // Primary model: full inputs. temp 0.5 → regenerations actually differ.
    text = await callGroq(apiKey, model, buildMessages(), { maxTokens: 8000, allowFallback: false, temperature: 0.5 });
  } catch (err) {
    // 429 = rate limited, 413 = request too large (small model TPM or huge GitHub-enriched input).
    // Both → fallback: truncate inputs + cap output so input + max_tokens stays under 6000 TPM.
    if (!err.message.includes("(429)") && !err.message.includes("(413)")) throw err;
    console.warn(`Primary call failed (${err.message.slice(0, 40)}…), falling back to ${FALLBACK_MODEL} with truncated inputs`);
    text = await callGroq(apiKey, FALLBACK_MODEL, buildMessages(3000), { maxTokens: 2000, allowFallback: false, temperature: 0.5 });
  }

  const resume = extractJson(text);
  if (resume.basics) resume.basics.summary = "";
  normalizeDates(resume);
  return resume;
}

// Estimate how many printed lines the rendered resume occupies. One US Letter page at
// 11pt Times New Roman (~0.45in top/bottom margins) fits roughly 52 usable lines.
function estimateResumeLines(r) {
  let lines = 2; // name + contact header
  const edu = r.education || [];
  if (edu.length) {
    lines += 1; // "Education" heading
    for (const e of edu) {
      lines += 2; // institution row + degree row
      const c = Array.isArray(e.courses) ? e.courses.length : 0;
      if (c) lines += 1 + c; // "Relevant Coursework" + one line per grouped course string
    }
  }
  const skills = r.skills || [];
  if (skills.length) lines += 1 + skills.length;
  const certs = r.certificates || [];
  if (certs.length) {
    const issuers = new Set(certs.map(c => (c.issuer || "Other")));
    lines += 1 + issuers.size;
  }
  const work = r.work || [];
  if (work.length) {
    lines += 1;
    for (const w of work) lines += 2 + (Array.isArray(w.highlights) ? w.highlights.length : 0);
  }
  const projects = r.projects || [];
  if (projects.length) {
    lines += 1;
    for (const p of projects) lines += 1 + (Array.isArray(p.highlights) ? p.highlights.length : 0);
  }
  return lines;
}

async function generateCoverLetter(jobText, resumeText, tone, length, fullName, apiKey, model) {
  const lengthGuide = { short: "180-220 words", standard: "260-340 words", detailed: "380-500 words" };
  const systemPrompt = [
    "You are an expert career writing assistant.",
    "Write a role-specific cover letter using only factual details present in the resume.",
    "Never invent achievements, years of experience, companies, or credentials.",
    "Write in a natural, human voice. No hype, no buzzwords, no em dashes.",
    "Output plain text only, no markdown."
  ].join(" ");
  const userPrompt = [
    `Tone: ${tone}. Length: ${lengthGuide[length] || "260-340 words"}.`,
    "Structure: greeting, 3-5 concise paragraphs, short sign-off.",
    "Format for quick form paste: keep greeting and sign-off, no personal contact header, no date.",
    fullName ? `Use this exact name in the sign-off: ${fullName}.` : "",
    "Prioritize matching role requirements with resume evidence.",
    "Use numbers sparingly. Avoid 'I am excited to apply' unless rewritten specifically.",
    "",
    `Job description:\n${jobText.trim()}`,
    "",
    `Resume:\n${resumeText.trim()}`
  ].filter(Boolean).join("\n");

  return callGroq(apiKey, model, [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ], { maxTokens: 800, temperature: 0.7 });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    const settings = await getSettings();
    const apiKey = settings.groqApiKey;
    const model = settings.model;

    if (!apiKey) {
      sendResponse({ error: "No Groq API key set. Open Options to configure." });
      return;
    }

    if (message.type === "GENERATE_COVER_LETTER") {
      try {
        const letter = await generateCoverLetter(
          message.jobText,
          message.resumeText,
          message.tone,
          message.length,
          settings.fullName,
          apiKey,
          model
        );
        sendResponse({ letter });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    }

    else if (message.type === "GENERATE_RESUME") {
      try {
        const storedAbout = await chrome.storage.local.get("aboutText");
        const aboutText = (storedAbout.aboutText || "").trim();
        if (!aboutText) {
          sendResponse({ error: "No About You text saved. Open ⚙ Options and paste your background info." });
          return;
        }

        // Enrich with scraped GitHub repos + READMEs so projects have real detail.
        const { text: enrichedAbout, projects: ghProjects } = await enrichWithGithub(aboutText, settings.githubUser);

        // Diagnostic: prove what the AI actually receives.
        console.log(`[GENERATE_RESUME] aboutText=${aboutText.length} chars, githubUser="${settings.githubUser || extractGithubUser(aboutText) || "(none)"}", ghRepos=${ghProjects.length}, enriched=${enrichedAbout.length} chars`);
        if (aboutText.length < 400) console.warn("[GENERATE_RESUME] About You text is SHORT — saved Options text may be thin/stale. Output will be sparse.");

        // Single API call: parse about text + tailor to job in one shot.
        console.log(`[GENERATE_RESUME] calling Groq model="${model}"…`);
        const tailored = await generateTailoredResume(enrichedAbout, message.jobText, apiKey, model);
        normalizeResumeArrays(tailored);
        // GUARANTEE 3 projects: pad from scraped GitHub repos when the model returns fewer.
        padProjectsFromGithub(tailored, ghProjects, 3);
        // GUARANTEE certificates: parse from About text when the model omits them.
        if (!tailored.certificates || !tailored.certificates.length) {
          const parsedCerts = parseCertsFromAbout(aboutText);
          if (parsedCerts.length) {
            tailored.certificates = parsedCerts;
            console.log(`[GENERATE_RESUME] padded ${parsedCerts.length} certs from About text`);
          }
        }
        enforceResumeBudget(tailored);
        validateBullets(tailored);
        tailored._generatedAt = new Date().toISOString();
        tailored._model = model;
        console.log(`[GENERATE_RESUME] done — ${tailored.work?.length || 0} work, ${tailored.projects?.length || 0} projects, ${tailored.certificates?.length || 0} certs, ≈${estimateResumeLines(tailored)} lines, stamped ${tailored._generatedAt}`);
        await chrome.storage.session.set({ pendingResume: tailored });
        const resumeUrl = chrome.runtime.getURL("pages/resume.html");
        await chrome.tabs.create({ url: resumeUrl });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ error: err.message || "Generation failed" });
      }
    }
  })();
  return true; // keep message channel open for async
});
