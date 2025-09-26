export default function Subscribe() {
  const go = async (plan: "monthly" | "yearly") => {
    const res = await fetch("/.netlify/functions/create-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
    });
    const { url } = await res.json();
    window.location.href = url;
  };

  return (
    <div className="p-6 space-x-2">
      <button className="btn" onClick={() => go("monthly")}>
        Subscribe Monthly
      </button>
      <button className="btn" onClick={() => go("yearly")}>
        Subscribe Yearly
      </button>
    </div>
  );
}
