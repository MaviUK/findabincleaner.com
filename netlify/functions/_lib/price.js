// netlify/functions/_lib/price.js
function pennies(n) {
  return Math.round(Number(n) * 100);
}

export function getSlotConfig(slot) {
  // 1=Gold, 2=Silver, 3=Bronze
  if (slot === 1) {
    return {
      rate: Number(process.env.RATE_GOLD_PER_KM2_PER_MONTH ?? process.env.RATE_PER_KM2_PER_MONTH ?? 0),
      min: Number(process.env.MIN_GOLD_PRICE_PER_MONTH ?? process.env.MIN_PRICE_PER_MONTH ?? 0),
      label: "Gold",
    };
  }
  if (slot === 2) {
    return {
      rate: Number(process.env.RATE_SILVER_PER_KM2_PER_MONTH ?? process.env.RATE_PER_KM2_PER_MONTH ?? 0),
      min: Number(process.env.MIN_SILVER_PRICE_PER_MONTH ?? process.env.MIN_PRICE_PER_MONTH ?? 0),
      label: "Silver",
    };
  }
  return {
    rate: Number(process.env.RATE_BRONZE_PER_KM2_PER_MONTH ?? process.env.RATE_PER_KM2_PER_MONTH ?? 0),
    min: Number(process.env.MIN_BRONZE_PRICE_PER_MONTH ?? process.env.MIN_PRICE_PER_MONTH ?? 0),
    label: "Bronze",
  };
}

export function computePricePennies(areaKm2, slot) {
  const { rate, min } = getSlotConfig(slot);
  const raw = areaKm2 * rate;
  const monthly = Math.max(raw, min);
  return pennies(monthly);
}
