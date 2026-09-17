const API_BASE = window.TRADE_SHARK_API_BASE ?? "";

export async function fetchPlatformStatus(signal) {
  const response = await fetch(`${API_BASE}/api/v1/status`, {
    method: "GET",
    headers: { accept: "application/json" },
    cache: "no-store",
    signal
  });

  if (!response.ok) throw new Error(`API status ${response.status}`);
  return response.json();
}
