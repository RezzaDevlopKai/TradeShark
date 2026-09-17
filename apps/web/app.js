import { fetchPlatformStatus } from "./api.js";

const root = document.body;

for (const button of document.querySelectorAll('[data-action="future-mode"]')) {
  button.addEventListener("click", () => {
    root.classList.toggle("future");
    const active = root.classList.contains("future");
    for (const item of document.querySelectorAll('[data-action="future-mode"]')) {
      item.textContent = active ? "Normal Mode" : "Future Mode →";
    }
  });
}

const status = document.querySelector("[data-system-status]");
const statusLabel = document.querySelector("[data-system-status-label]");

function setStatus(state, label) {
  if (!status || !statusLabel) return;
  status.dataset.state = state;
  statusLabel.textContent = label;
}

const controller = new AbortController();
const timeout = window.setTimeout(() => controller.abort(), 3500);

try {
  const platform = await fetchPlatformStatus(controller.signal);
  setStatus(platform.status === "operational" ? "online" : "degraded", platform.status === "operational" ? "CORE ONLINE" : "CORE DEGRADED");
} catch {
  setStatus("standby", "CORE STANDBY");
} finally {
  window.clearTimeout(timeout);
}
