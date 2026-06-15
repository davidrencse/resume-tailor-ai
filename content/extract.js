function norm(t) {
  return (t || "").replace(/\s+/g, " ").trim();
}

function textOf(el) {
  return el ? norm(el.textContent) : "";
}

function findBestDescriptionBlock() {
  const selectors = [
    "[data-testid*='job']",
    "[class*='job-description']",
    "[id*='job-description']",
    "[class*='jobDescription']",
    "[id*='jobDescription']",
    "article",
    "main",
    "section"
  ];

  const seen = new Set();
  const candidates = [];

  for (const sel of selectors) {
    document.querySelectorAll(sel).forEach(el => {
      if (seen.has(el)) return;
      seen.add(el);
      const t = textOf(el);
      if (t.length > 300) candidates.push(t);
    });
  }

  const selected = norm(window.getSelection()?.toString() ?? "");
  if (selected.length > 100) candidates.unshift(selected);

  candidates.sort((a, b) => b.length - a.length);
  return candidates[0] ?? norm(document.body?.innerText ?? "");
}

function buildJobText() {
  const title   = textOf(document.querySelector("h1"));
  const company = textOf(document.querySelector("[data-company],[class*='company'],[id*='company']"));
  const body    = findBestDescriptionBlock();
  return [title, company, body].filter(Boolean).join("\n\n").slice(0, 16000);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "GET_JOB_TEXT") return;
  try {
    sendResponse({
      jobText: buildJobText(),
      pageTitle: document.title,
      url: window.location.href
    });
  } catch (err) {
    sendResponse({ jobText: norm(document.body?.innerText ?? "").slice(0, 16000), pageTitle: document.title });
  }
});
