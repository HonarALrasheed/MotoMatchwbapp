export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const TAVILY_KEY = process.env.TAVILY_KEY;
  if (!TAVILY_KEY) {
    return res.status(500).json({ error: "TAVILY_KEY not configured" });
  }

  try {
    const { bikeName } = req.body;

    const upstream = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: TAVILY_KEY,
        query: `${bikeName} gebraucht kaufen Deutschland`,
        search_depth: "basic",
        max_results: 5,
        include_domains: [
          "kleinanzeigen.de",
          "mobile.de",
          "ebay.de",
          "ebay-kleinanzeigen.de",
        ],
      }),
    });

    if (!upstream.ok) {
      const err = await upstream.text();
      return res.status(500).json({ error: `Tavily error: ${err}` });
    }

    const data = await upstream.json();
    const items = (data.results || []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content?.slice(0, 120) || "",
      source: new URL(r.url).hostname.replace("www.", ""),
    }));

    return res.status(200).json({ items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
