const base = document.querySelector("#base");
const email = document.querySelector("#email");
const password = document.querySelector("#password");
const status = document.querySelector("#status");
const templates = document.querySelector("#templates");
const receipt = document.querySelector("#receipt");

document.querySelector("h1 small").textContent = "v0.1.36";

const readJson = async response => response.json().catch(() => null);

async function loadCaptureReceipt() {
  const { lastTemplateCapture } = await chrome.storage.local.get(["lastTemplateCapture"]);
  if (!lastTemplateCapture) return;
  const state = lastTemplateCapture.state === "saved" ? "Saved" : lastTemplateCapture.state === "saving" ? "Saving" : "Failed";
  const time = new Date(lastTemplateCapture.at).toLocaleTimeString();
  receipt.innerHTML = `<strong>Last capture: ${state} — ${lastTemplateCapture.name}</strong>${lastTemplateCapture.message} (${time})`;
}

async function loadTemplates() {
  const local = await chrome.storage.local.get(["apiBase", "accessToken", "tokenExpiresAt"]);
  const apiBase = local.apiBase;
  const accessToken = local.accessToken;
  const tokenExpiresAt = local.tokenExpiresAt;
  if (!apiBase || !accessToken || !tokenExpiresAt || Date.now() >= tokenExpiresAt) {
    templates.innerHTML = "<p>Sign in to view templates.</p>";
    status.textContent = "Not connected. Sign in to save or view templates.";
    return;
  }

  templates.innerHTML = "<p>Loading templates…</p>";
  try {
    const response = await fetch(`${apiBase}/api/templates`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const body = await readJson(response);
    if (!response.ok) throw new Error(body?.message || "Templates could not be loaded.");
    templates.replaceChildren();
    if (!body.length) {
      templates.textContent = "No saved templates yet. Capture one with New template on your Meesho catalog page.";
      return;
    }
    body.forEach(template => {
      const item = document.createElement("div");
      item.className = "template";
      const name = document.createElement("b");
      name.textContent = template.name;
      const category = document.createElement("span");
      category.textContent = `${template.categoryLabel} · v${template.version}`;
      item.append(name, category);
      templates.append(item);
    });
  } catch (error) {
    templates.textContent = error.message || "Templates could not be loaded.";
  }
}

chrome.storage.local.get(["apiBase"], data => { base.value = data.apiBase || "http://localhost:3000"; });
loadTemplates();
loadCaptureReceipt();

document.querySelector("#save").onclick = async () => {
  const apiBase = base.value.replace(/\/$/, "");
  if (!/^https?:\/\//.test(apiBase) || !email.value || password.value.length < 8) {
    status.textContent = "Enter your ListingKing account details.";
    return;
  }

  status.textContent = "Connecting…";
  try {
    const response = await fetch(`${apiBase}/api/extension/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.value, password: password.value }) });
    const data = await readJson(response);
    if (!response.ok) throw new Error(data?.message || "Sign-in failed");
    const tokenExpiresAt = Date.now() + data.expiresIn * 1000;
    await chrome.storage.local.set({ apiBase, accessToken: data.accessToken, tokenExpiresAt });
    try { await chrome.storage.session.set({ accessToken: data.accessToken, tokenExpiresAt }); } catch { /* Local storage remains the 15-minute token source. */ }
    password.value = "";
    status.textContent = "Connected. Your session expires in 1 hour.";
    await loadTemplates();
  } catch (error) {
    status.textContent = error.message || "Could not connect.";
  }
};
