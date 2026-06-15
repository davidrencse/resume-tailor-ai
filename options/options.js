const groqApiKeyEl = document.getElementById("groqApiKey");
const modelSelectEl = document.getElementById("modelSelect");
const fullNameEl    = document.getElementById("fullName");
const githubUserEl  = document.getElementById("githubUser");
const aboutTextEl   = document.getElementById("aboutText");
const saveBtn       = document.getElementById("saveBtn");
const saveStatus    = document.getElementById("saveStatus");

async function load() {
  const stored = await chrome.storage.local.get(["settings", "aboutText"]);
  const s = stored.settings || {};
  groqApiKeyEl.value  = s.groqApiKey  || "";
  modelSelectEl.value = s.model       || "llama-3.3-70b-versatile";
  fullNameEl.value    = s.fullName    || "";
  githubUserEl.value  = s.githubUser  || "";
  aboutTextEl.value   = stored.aboutText || ""; // never fall back to s.aboutText (legacy/dead field)
}

saveBtn.addEventListener("click", async () => {
  const settings = {
    groqApiKey: groqApiKeyEl.value.trim(),
    model:      modelSelectEl.value,
    fullName:   fullNameEl.value.trim(),
    githubUser: githubUserEl.value.trim().replace(/^@/, "")
  };

  await chrome.storage.local.set({
    settings,
    aboutText: aboutTextEl.value.trim()
  });

  saveStatus.textContent = "Saved!";
  saveStatus.style.color = "#0a7d68";
  setTimeout(() => { saveStatus.textContent = ""; }, 2000);
});

load();
