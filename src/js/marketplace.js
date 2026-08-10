/**
 * ══════════════════════════════════════════════════════════════
 *  MOTOMATCH — marketplace.js  v2.0
 *  Marketplace listings with proxy-first architecture.
 *
 *  Production: calls /api/search-places (Supabase Edge Function)
 *  Development fallback: direct Tavily call (VITE_ key)
 *
 *  TODO: Deploy Supabase Edge Function and remove VITE_TAVILY_KEY
 * ══════════════════════════════════════════════════════════════
 */

const listings = {
  1: [
    {
      title: "Honda NR750 – Sammlerzustand",
      price: "22.500",
      year: 1994,
      km: "4.200",
      location: "München",
      age: "vor 2 Tagen",
    },
    {
      title: "Honda NR750 RC40 Original",
      price: "19.900",
      year: 1992,
      km: "8.700",
      location: "Hamburg",
      age: "vor 1 Woche",
    },
    {
      title: "Honda NR 750 – Rarität",
      price: "24.000",
      year: 1993,
      km: "2.900",
      location: "Frankfurt",
      age: "vor 3 Tagen",
    },
  ],
  2: [
    {
      title: "Honda CB 750 Four – Restauriert",
      price: "13.800",
      year: 1970,
      km: "31.000",
      location: "Köln",
      age: "vor 5 Tagen",
    },
    {
      title: "Honda CB750 F – Top Zustand",
      price: "11.500",
      year: 1972,
      km: "44.000",
      location: "Stuttgart",
      age: "vor 2 Wochen",
    },
    {
      title: "Honda CB 750 Cafe Racer Umbau",
      price: "9.200",
      year: 1969,
      km: "58.000",
      location: "Berlin",
      age: "vor 1 Woche",
    },
  ],
  3: [
    {
      title: "Yamaha YZF-R3 – Unfallfrei",
      price: "4.800",
      year: 2021,
      km: "6.200",
      location: "Dortmund",
      age: "vor 3 Tagen",
    },
    {
      title: "Yamaha R3 Racing Blue – A2",
      price: "4.200",
      year: 2019,
      km: "12.500",
      location: "Düsseldorf",
      age: "vor 1 Woche",
    },
    {
      title: "Yamaha YZF-R3 ABS – 1 Vorbesitzer",
      price: "5.500",
      year: 2022,
      km: "3.100",
      location: "Hannover",
      age: "vor 6 Tagen",
    },
  ],
  4: [
    {
      title: "Suzuki GSX-R 750 – Scheckheft",
      price: "11.900",
      year: 2022,
      km: "4.800",
      location: "Nürnberg",
      age: "vor 4 Tagen",
    },
    {
      title: "GSXR 750 K8 – Top Gepflegt",
      price: "7.500",
      year: 2008,
      km: "22.000",
      location: "Leipzig",
      age: "vor 2 Wochen",
    },
    {
      title: "Suzuki GSX-R750 Superbike-Umbau",
      price: "9.800",
      year: 2018,
      km: "9.300",
      location: "Dresden",
      age: "vor 1 Woche",
    },
  ],
  5: [
    {
      title: "Harley Seventy-Two 1200 – Custom",
      price: "16.500",
      year: 2015,
      km: "11.200",
      location: "München",
      age: "vor 5 Tagen",
    },
    {
      title: "H-D Sportster Seventy-Two – TÜV",
      price: "14.800",
      year: 2014,
      km: "18.000",
      location: "Köln",
      age: "vor 2 Wochen",
    },
    {
      title: "Harley Davidson 72 – Bobber Optik",
      price: "13.500",
      year: 2013,
      km: "24.000",
      location: "Hamburg",
      age: "vor 1 Woche",
    },
  ],
  6: [
    {
      title: "Harley Iron 883 – A2 tauglich",
      price: "8.200",
      year: 2020,
      km: "5.400",
      location: "Berlin",
      age: "vor 3 Tagen",
    },
    {
      title: "H-D Iron 883 Matte Black",
      price: "7.500",
      year: 2018,
      km: "9.800",
      location: "Frankfurt",
      age: "vor 1 Woche",
    },
    {
      title: "Harley-Davidson Iron 883 – Neuwertig",
      price: "9.100",
      year: 2021,
      km: "2.700",
      location: "Stuttgart",
      age: "vor 4 Tagen",
    },
  ],
  7: [
    {
      title: "Yamaha RX-King 135 – Oldtimer",
      price: "2.400",
      year: 1998,
      km: "18.000",
      location: "Bremen",
      age: "vor 1 Woche",
    },
    {
      title: "RX King 135 – Import Japan",
      price: "2.900",
      year: 2003,
      km: "12.000",
      location: "Hannover",
      age: "vor 3 Tagen",
    },
    {
      title: "Yamaha RX-King Restauriert",
      price: "1.800",
      year: 1995,
      km: "31.000",
      location: "Essen",
      age: "vor 2 Wochen",
    },
  ],
  8: [
    {
      title: "Honda CRF 450R – Werksoptik",
      price: "7.200",
      year: 2023,
      km: "800",
      location: "München",
      age: "vor 2 Tagen",
    },
    {
      title: "CRF450R Enduro-Umbau Straße",
      price: "6.500",
      year: 2021,
      km: "3.200",
      location: "Stuttgart",
      age: "vor 1 Woche",
    },
    {
      title: "Honda CRF 450R HRC Edition",
      price: "8.000",
      year: 2022,
      km: "1.500",
      location: "Köln",
      age: "vor 5 Tagen",
    },
  ],
  9: [
    {
      title: "Yamaha DT 125 E – Oldtimer Zulassung",
      price: "1.600",
      year: 1974,
      km: "22.000",
      location: "Freiburg",
      age: "vor 1 Woche",
    },
    {
      title: "DT 125 E Enduro – Restauriert",
      price: "2.200",
      year: 1976,
      km: "14.000",
      location: "Augsburg",
      age: "vor 4 Tagen",
    },
    {
      title: "Yamaha DT 125 – Top Zustand",
      price: "1.900",
      year: 1975,
      km: "18.500",
      location: "Regensburg",
      age: "vor 2 Wochen",
    },
  ],
  10: [
    {
      title: "Yamaha SR 500 Custom – Cafe Racer",
      price: "6.200",
      year: 2024,
      km: "1.200",
      location: "Berlin",
      age: "vor 3 Tagen",
    },
    {
      title: "Yamaha 500 Custom Bobber",
      price: "5.500",
      year: 2023,
      km: "3.800",
      location: "Hamburg",
      age: "vor 1 Woche",
    },
    {
      title: "YAM 500 Custom – A2 geeignet",
      price: "7.000",
      year: 2024,
      km: "600",
      location: "München",
      age: "vor 6 Tagen",
    },
  ],
};

const PROXY_URL = "/api/search-places";

function buildSearchUrls(bikeName) {
  const query = encodeURIComponent(bikeName);
  return {
    kleinanzeigen: `https://www.kleinanzeigen.de/s-motorraeder-roller/${query}/k0c305`,
    mobile: `https://suchen.mobile.de/motorrad/search.html?q=${query}`,
    ebay: `https://www.ebay.de/sch/i.html?_nkw=${query}+motorrad`,
  };
}

export function getStaticListings(bikeId, bikeName) {
  const items = listings[bikeId] || [];
  const urls = buildSearchUrls(bikeName);
  return { items, urls };
}

export async function getLiveListings(bikeName) {
  const urls = buildSearchUrls(bikeName);

  // Try server proxy first (production)
  try {
    const proxyRes = await fetch(PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bikeName }),
    });
    if (proxyRes.ok) {
      const data = await proxyRes.json();
      return { items: data.items || [], urls };
    }
  } catch (_) {
    // Proxy not available
  }

  return { items: [], urls };
}
