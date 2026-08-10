export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const OPENAI_KEY = process.env.OPENAI_KEY;
  if (!OPENAI_KEY) {
    return res.status(500).json({ error: "OPENAI_KEY not configured" });
  }

  try {
    const { answers, bike } = req.body;

    const prompt = `Nutzer-Profil:
- Führerschein: ${answers.license}
- Fahrerfahrung: ${answers.experience}
- Lieblingsstil: ${answers.style}
- Hauptverwendung: ${answers.use}
- Budget: ${answers.budget}
- Körpergröße: ${answers.height}
- Beifahrer: ${answers.passenger}

Empfohlenes Motorrad: ${bike.name} (${bike.brand}, ${bike.style}, ${bike.cc}cc, ${bike.ps}PS, ${bike.weight}kg, Sitzhöhe ${bike.seat_height}cm, Führerschein: ${bike.license})

Erkläre in 1 kurzen Satz auf Deutsch, warum dieses Motorrad zu diesem Nutzer passt. Maximal 20 Wörter. Kein Überschwang, sachlich und konkret.`;

    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Du bist ein begeisterter Motorrad-Experte der Nutzern ihr perfektes Bike erklärt.",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 60,
        temperature: 0.75,
      }),
    });

    if (!upstream.ok) {
      const err = await upstream.text();
      return res.status(500).json({ error: `OpenAI error: ${err}` });
    }

    const data = await upstream.json();
    const explanation = data.choices[0].message.content.trim();
    return res.status(200).json({ explanation });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
