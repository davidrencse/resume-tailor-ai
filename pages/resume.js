function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toArray(v) {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === "string") return v.split(",").map(s => s.trim()).filter(Boolean);
  if (v && typeof v === "object") return Object.values(v).map(String).filter(Boolean);
  return [];
}

// MM/YYYY format matching the PDF (e.g. "09/2024"). Year-only → "YYYY". Empty → "PRESENT".
function formatDate(d) {
  if (!d) return "PRESENT";
  const parts = d.split("-");
  const y = parts[0];
  const m = parseInt(parts[1] || "0", 10);
  if (!m || isNaN(m)) return y;
  return `${String(m).padStart(2, "0")}/${y}`;
}

// Render a coursework/skill/cert bullet: "Category: content" → <strong>Category:</strong> <em>content</em>
function renderCategoryBullet(text) {
  const i = text.indexOf(":");
  if (i > 0) {
    const cat = text.slice(0, i).trim();
    const rest = text.slice(i + 1).trim();
    return `<li><strong>${esc(cat)}:</strong> <em>${esc(rest)}</em></li>`;
  }
  return `<li>${esc(text)}</li>`;
}

function renderResume(r) {
  const b = r.basics || {};

  // ── HEADER ──
  const profiles = b.profiles || [];
  const linkedin = profiles.find(p => /linkedin/i.test(p.network || ""));
  const github   = profiles.find(p => /github/i.test(p.network || ""));

  const contactParts = [
    b.phone ? esc(b.phone) : null,
    b.email ? `<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>` : null,
    linkedin?.url ? `<a href="${esc(linkedin.url)}">Linkedin</a>` : null,
    github?.url   ? `<a href="${esc(github.url)}">Github</a>` : null
  ].filter(Boolean);

  const headerHtml = `
<section id="basics">
  <h1>${esc(b.name || "")}</h1>
  <div class="contact">${contactParts.join(" – ")}</div>
</section>`;

  // ── EDUCATION ──
  const edu = r.education || [];
  let eduHtml = "";
  if (edu.length) {
    const items = edu.map(e => {
      const dateStr = `${formatDate(e.startDate)} – ${formatDate(e.endDate)}`;
      const degreeParts = [
        e.studyType || "",
        e.area ? `in ${e.area}` : "",
      ].filter(Boolean);
      const degreeStr = degreeParts.join(" ") + (e.gpa ? `, GPA: ${e.gpa}` : "");
      const courses = toArray(e.courses);
      return `
<div class="item">
  <div class="item-title-row">
    <span class="item-name">${esc(e.institution)}</span>
    <span class="item-date">${esc(dateStr)}</span>
  </div>
  ${degreeStr ? `<div class="item-subtitle">${esc(degreeStr)}</div>` : ""}
  ${courses.length ? `
  <div class="coursework-heading">Relevant Coursework</div>
  <ul>${courses.map(renderCategoryBullet).join("")}</ul>` : ""}
</div>`;
    }).join("");
    eduHtml = `<section id="education"><h2>Education</h2>${items}</section>`;
  }

  // ── TECHNICAL SKILLS ──
  const skills = r.skills || [];
  let skillsHtml = "";
  if (skills.length) {
    const rows = skills.map(s => {
      if (!s || !s.name) return "";
      const kw = toArray(s.keywords);
      if (!kw.length) return "";
      return `<li><strong>${esc(s.name)}:</strong> <em>${kw.map(esc).join(", ")}</em></li>`;
    }).filter(Boolean).join("");
    if (rows) skillsHtml = `<section id="skills"><h2>Technical Skills</h2><ul>${rows}</ul></section>`;
  }

  // ── EXPERIENCE ──
  const work = r.work || [];
  let workHtml = "";
  if (work.length) {
    const items = work.map(w => {
      const dateStr = `${formatDate(w.startDate)} – ${formatDate(w.endDate)}`;
      const bullets = toArray(w.highlights);
      return `
<div class="item">
  <div class="item-title-row">
    <span class="item-name">${esc(w.name)}</span>
    <span class="item-date">${esc(dateStr)}</span>
  </div>
  ${w.position || w.location ? `<div class="item-title-row">
    <span class="item-subtitle">${esc(w.position || "")}</span>
    ${w.location ? `<span class="item-subtitle">${esc(w.location)}</span>` : ""}
  </div>` : ""}
  ${bullets.length ? `<ul>${bullets.map(h => `<li class="bullet">${esc(h)}</li>`).join("")}</ul>` : ""}
</div>`;
    }).join("");
    workHtml = `<section id="work"><h2>Experience</h2>${items}</section>`;
  }

  // ── OPEN-SOURCE CONTRIBUTIONS ──
  const projects = r.projects || [];
  let projectsHtml = "";
  if (projects.length) {
    const items = projects.map(p => {
      const bullets  = toArray(p.highlights);
      const keywords = toArray(p.keywords);
      const nameHtml = p.url && typeof p.url === "string"
        ? `<a href="${esc(p.url)}">${esc(p.name)}</a>`
        : esc(p.name);
      const kwHtml = keywords.length ? ` | <em>${keywords.map(esc).join(", ")}</em>` : "";
      return `
<div class="item">
  <div><strong>${nameHtml}</strong>${kwHtml}</div>
  ${bullets.length ? `<ul>${bullets.map(h => `<li class="bullet">${esc(h)}</li>`).join("")}</ul>` : ""}
</div>`;
    }).join("");
    projectsHtml = `<section id="projects"><h2>Open-Source Contributions</h2>${items}</section>`;
  }

  // ── CERTIFICATES ──
  const certs = r.certificates || [];
  let certsHtml = "";
  if (certs.length) {
    const groups = {};
    const order = [];
    for (const c of certs) {
      const issuer = (c.issuer || "Other").trim();
      if (!groups[issuer]) { groups[issuer] = []; order.push(issuer); }
      if (c.name) groups[issuer].push(c.name);
    }
    const rows = order
      .filter(issuer => groups[issuer].length)
      .map(issuer =>
        `<li><strong>${esc(issuer)}:</strong> <em>${groups[issuer].map(esc).join(", ")}</em></li>`
      ).join("");
    if (rows) certsHtml = `<section id="certificates"><h2>Certificates</h2><ul>${rows}</ul></section>`;
  }

  // Section order matches PDF: Education → Skills → Experience → Projects → Certificates
  return `${headerHtml}${eduHtml}${skillsHtml}${workHtml}${projectsHtml}${certsHtml}`;
}

async function init() {
  const resumeEl = document.getElementById("resume");
  try {
    const stored = await chrome.storage.session.get("pendingResume");
    const resume = stored.pendingResume;
    if (!resume) {
      resumeEl.innerHTML = `<p style="padding:40px;color:#c0392b;">No resume data found. Generate again from the popup.</p>`;
      return;
    }
    resumeEl.innerHTML = renderResume(resume);
    document.title = `${resume.basics?.name || "Resume"} — Resume`;
    // Freshness proof: show when this was generated + which model produced it.
    const hint = document.getElementById("hint");
    if (hint && resume._generatedAt) {
      const t = new Date(resume._generatedAt);
      hint.textContent = `Generated ${t.toLocaleTimeString()} · ${resume._model || "?"} · Ctrl+P → PDF`;
    }
  } catch (err) {
    resumeEl.innerHTML = `<p style="padding:40px;color:#c0392b;">Error: ${esc(err.message)}</p>`;
    console.error(err);
  }
}

document.getElementById("printBtn").addEventListener("click", () => window.print());
init();
