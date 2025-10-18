export async function fetchSubscription(business_id: string, area_id: string, slot: number) {
  const url = new URL("/api/subscription/get", window.location.origin);
  url.searchParams.set("business_id", business_id);
  url.searchParams.set("area_id", area_id);
  url.searchParams.set("slot", String(slot));

  const res = await fetch(url.toString(), { credentials: "include" });
  if (!res.ok) return null;
  const json = await res.json();
  return json?.subscription ?? null;
}
