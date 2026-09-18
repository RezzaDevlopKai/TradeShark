const API_BASE = window.TRADE_SHARK_API_BASE ?? "";

const nav = [...document.querySelectorAll(".admin-nav button")];
const panels = [...document.querySelectorAll(".admin-section")];
const title = document.querySelector("#section-title");
const authGate = document.querySelector("#admin-auth-gate");
const adminShell = document.querySelector("#admin-shell");
const loginForm = document.querySelector("#admin-login-form");
const authMessage = document.querySelector("#admin-auth-message");

function show(section) {
  nav.forEach((button) => button.classList.toggle("active", button.dataset.section === section));
  panels.forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === section));
  const active = nav.find((button) => button.dataset.section === section);
  if (active && title) title.textContent = active.textContent;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

nav.forEach((button) => button.addEventListener("click", () => show(button.dataset.section)));
document.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => show(button.dataset.go)));

function setAuthMessage(message) {
  if (authMessage) authMessage.textContent = message;
}

function openAdmin(user) {
  if (!user || user.role !== "admin" || user.status !== "active") {
    setAuthMessage("This account is not authorized for the admin control plane.");
    return;
  }
  authGate.hidden = true;
  adminShell.hidden = false;
  setAuthMessage("Authenticated.");
}

async function checkSession() {
  const response = await fetch(`${API_BASE}/api/v1/auth/session`, {
    credentials: "include",
    headers: { accept: "application/json" },
    cache: "no-store"
  });
  if (!response.ok) return false;
  const body = await response.json();
  openAdmin(body.user);
  return true;
}

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.querySelector("#admin-email")?.value.trim();
  const password = document.querySelector("#admin-password")?.value;
  if (!email || !password) return;
  setAuthMessage("Authenticating…");
  try {
    const response = await fetch(`${API_BASE}/api/v1/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ email, password })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setAuthMessage(body.error ? `Sign in failed: ${body.error}` : "Sign in failed.");
      return;
    }
    openAdmin(body.user);
  } catch {
    setAuthMessage("TradeShark API is not connected to this website yet. The admin UI is available in preview mode.");
  }
});

if (new URLSearchParams(window.location.search).get("preview") === "1") {
  authGate.hidden = true;
  adminShell.hidden = false;
  const badge = document.querySelector(".admin-live");
  if (badge) badge.innerHTML = "<i></i> PREVIEW MODE";
} else {
  void checkSession().catch(() => setAuthMessage("TradeShark API is not connected to this website yet."));
}
