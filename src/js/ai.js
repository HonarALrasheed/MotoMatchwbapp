const PROXY_URL = "/api/ai-match";

export async function getAIExplanation(answers, bike) {
  const licenseLabels = {
    A1: "A1 (max. 125cc)",
    A2: "A2 (max. 35kW)",
    A: "Unbegrenzt (A)",
    B196: "B196 (125cc mit PKW-Schein)",
  };

  const payload = {
    answers: {
      license: licenseLabels[answers.q1] || answers.q1,
      experience: answers.q2,
      style: answers.q3,
      use: answers.q4,
      budget: answers.q5,
      height: answers.q6,
      passenger: answers.q7,
    },
    bike: {
      name: bike.name,
      brand: bike.brand,
      style: bike.style,
      cc: bike.cc,
      ps: bike.ps,
      weight: bike.weight,
      seat_height: bike.seat_height,
      license: bike.license,
    },
  };

  // Try server proxy first (production)
  try {
    const proxyRes = await fetch(PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (proxyRes.ok) {
      const data = await proxyRes.json();
      return data.explanation || data.choices?.[0]?.message?.content?.trim();
    }
  } catch (_) {
    // Proxy not available
  }

  return "KI-Erklärung nicht verfügbar.";
}
