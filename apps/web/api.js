const API_BASE = window.TRADE_SHARK_API_BASE ?? "";

function isPlatformStatus(value) {
  if (!value || typeof value !== "object") return false;
  const body = value;
  return body.service === "tradeshark-api"
    && typeof body.status === "string"
    && typeof body.version === "string";
}

export async function fetchPlatformStatus(signal) {
  const response = await fetch(`${API_BASE}/api/v1/status`, {
    method: "GET",
    headers: { accept: "application/json" },
    cache: "no-store",
    signal
  });

  if (!response.ok) throw new Error(`API status ${response.status}`);

  const body = await response.json();
  if (!isPlatformStatus(body)) {
    throw new Error("API returned an invalid platform status payload");
  }

  return body;
}
