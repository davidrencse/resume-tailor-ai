const DRAFT_KEY = "popupDraft";

const tabBtns       = document.querySelectorAll(".tab");
const tabPanels     = document.querySelectorAll(".tab-panel");
const extractBtn    = document.getElementById("extractBtn");
const extractBtnR   = document.getElementById("extractBtnResume");
const generateCoverBtn = document.getElementById("generateCoverBtn");
const generateResumeBtn = document.getElementById("generateResumeBtn");
const regenBtn      = document.getElementById("regenBtn");
const copyBtn       = document.getElementById("copyBtn");
const jobTextCover  = document.getElementById("jobTextCover");
const jobTextResume = document.getElementById("jobTextResume");
const outputTextarea = document.getElementById("outputTextarea");
const toneSelect    = document.getElementById("toneSelect");
const lengthSelect  = document.getElementById("lengthSelect");
const coverStatus   = document.getElementById("coverStatus");
const resumeStatus  = document.getElementById("resumeStatus");
const aboutStatus   = document.getElementById("aboutStatus");

function setStatus(el, text, isError = false) {
  el.textContent = text;
  el.style.color = isError ? "#c0392b" : "#666";
}

function setLoading(btn, yes, text) {
  btn.disabled = yes;
  if (yes && text) {
    btn.dataset.label = btn.textContent; // save original
    btn.textContent = text;
  } else if (!yes) {
    btn.textContent = btn.dataset.label || text || btn.textContent; // restore original
  }
}

// Tab switching
tabBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    tabBtns.forEach(b => b.classList.remove("active"));
    tabPanels.forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    saveDraft();
  });
});

// Sync job text between tabs
jobTextCover.addEventListener("input", () => { jobTextResume.value = jobTextCover.value; saveDraft(); });
jobTextResume.addEventListener("input", () => { jobTextCover.value = jobTextResume.value; saveDraft(); });

async function extractJob(statusEl) {
  setStatus(statusEl, "Extracting...");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { setStatus(statusEl, "No active tab found.", true); return; }
    // extract.js is auto-injected by manifest content_scripts (one listener per page load).
    // Do NOT executeScript here — that re-injects and stacks duplicate onMessage listeners.
    const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_JOB_TEXT" });
    jobTextCover.value = response.jobText || "";
    jobTextResume.value = response.jobText || "";
    setStatus(statusEl, `Extracted from: ${response.pageTitle?.slice(0, 50) || tab.url}`);
    saveDraft();
  } catch (err) {
    setStatus(statusEl, "Could not extract — paste manually.", true);
  }
}

extractBtn.addEventListener("click", () => extractJob(coverStatus));
extractBtnR.addEventListener("click", () => extractJob(resumeStatus));

// Cover letter generation
async function generateCoverLetter() {
  const jobText = jobTextCover.value.trim();
  if (!jobText) { setStatus(coverStatus, "Paste a job description first.", true); return; }

  const resumeText = await getResumeText();

  if (!resumeText) {
    setStatus(coverStatus, "No About You saved. Open ⚙ Options first.", true);
    return;
  }

  setLoading(generateCoverBtn, true, "Generating...");
  setStatus(coverStatus, "Calling AI...");
  outputTextarea.value = "";
  copyBtn.disabled = true;
  regenBtn.disabled = true;

  chrome.runtime.sendMessage({
    type: "GENERATE_COVER_LETTER",
    jobText,
    resumeText,
    tone: toneSelect.value,
    length: lengthSelect.value
  }, (response) => {
    setLoading(generateCoverBtn, false);
    if (!response || response.error) {
      setStatus(coverStatus, response?.error || chrome.runtime.lastError?.message || "No response from extension", true);
      return;
    }
    outputTextarea.value = response.letter || "";
    copyBtn.disabled = false;
    regenBtn.disabled = false;
    setStatus(coverStatus, "Done.");
    saveDraft();
  });
}

generateCoverBtn.addEventListener("click", generateCoverLetter);
regenBtn.addEventListener("click", generateCoverLetter);

copyBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(outputTextarea.value);
  setStatus(coverStatus, "Copied!");
});

// Resume generation
generateResumeBtn.addEventListener("click", async () => {
  const jobText = jobTextResume.value.trim();
  if (!jobText) { setStatus(resumeStatus, "Paste a job description first.", true); return; }

  setLoading(generateResumeBtn, true, "Generating... (30-60s)");
  setStatus(resumeStatus, "Parsing background + tailoring to job — please wait...");

  chrome.runtime.sendMessage({ type: "GENERATE_RESUME", jobText }, (response) => {
    setLoading(generateResumeBtn, false, "Generate Resume → New Tab");
    if (chrome.runtime.lastError || response?.error) {
      const msg = response?.error || chrome.runtime.lastError?.message || "Failed";
      setStatus(resumeStatus, msg, true);
      alert("Resume generation FAILED:\n\n" + msg); // loud — a failed call must not look like stale output
      return;
    }
    setStatus(resumeStatus, "Done — resume opened in new tab.");
  });
});

// Resume text helper (About You → cover letter)
async function getResumeText() {
  const stored = await chrome.storage.local.get("aboutText");
  return stored.aboutText || "";
}

// About You status
async function updateAboutStatus() {
  const stored = await chrome.storage.local.get("aboutText");
  const text = stored.aboutText || "";
  if (text.trim()) {
    aboutStatus.textContent = `✓ About You: ${text.length} characters saved`;
    aboutStatus.className = "about-status ok";
  } else {
    aboutStatus.textContent = "⚠ No background info saved — open ⚙ Options";
    aboutStatus.className = "about-status warn";
  }
}

// Draft save/restore
function saveDraft() {
  const activeTab = document.querySelector(".tab.active")?.dataset.tab || "cover";
  chrome.storage.session.set({
    [DRAFT_KEY]: {
      jobText: jobTextCover.value,
      output: outputTextarea.value,
      tone: toneSelect.value,
      length: lengthSelect.value,
      activeTab
    }
  });
}

async function loadDraft() {
  const stored = await chrome.storage.session.get(DRAFT_KEY);
  const draft = stored[DRAFT_KEY];
  if (!draft) return;
  if (draft.jobText) { jobTextCover.value = draft.jobText; jobTextResume.value = draft.jobText; }
  if (draft.output)  { outputTextarea.value = draft.output; copyBtn.disabled = false; regenBtn.disabled = false; }
  if (draft.tone)    toneSelect.value = draft.tone;
  if (draft.length)  lengthSelect.value = draft.length;
  if (draft.activeTab) {
    tabBtns.forEach(b => b.classList.toggle("active", b.dataset.tab === draft.activeTab));
    tabPanels.forEach(p => p.classList.toggle("active", p.id === `tab-${draft.activeTab}`));
  }
}

// Shortcut: press "e" (when not in a text input) → extract job from current tab
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "e" && ev.key !== "E") return;
  const tag = document.activeElement?.tagName;
  if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
  const activeTab = document.querySelector(".tab.active")?.dataset.tab;
  if (activeTab === "resume") extractBtnR.click();
  else extractBtn.click();
});

// Init
loadDraft();
updateAboutStatus();
