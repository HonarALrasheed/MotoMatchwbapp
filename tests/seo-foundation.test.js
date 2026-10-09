import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseKanonischeUrls,
  pruefeProductionDeployment,
  pruefeProduktionsUrls,
} from "../scripts/indexnow.mjs";

const dist = join(process.cwd(), "dist");
const read = (path) => readFileSync(join(dist, path), "utf8");

function attribut(tag, name) {
  return tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"))?.[1] || null;
}

function metadata(html) {
  const tags = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const values = {};
  for (const tag of tags) {
    const key = attribut(tag, "property") || attribut(tag, "name");
    if (key) values[key] = attribut(tag, "content");
  }
  const canonicalTag = html.match(/<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/i)?.[0];
  values.canonical = canonicalTag ? attribut(canonicalTag, "href") : null;
  values.title = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() || null;
  values.h1 = html.match(/<h1\b[^>]*>(.*?)<\/h1>/is)?.[1]?.replace(/<[^>]+>/g, "").trim() || null;
  return values;
}

function strukturierteDaten(html) {
  return [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => JSON.parse(m[1]));
}

test("wichtige Seiten liefern eigenständige Vorschau-Metadaten und verwertbares HTML", () => {
  const pages = [
    ["index.html", "/", "MotoMatch"],
    ["motorrad/kawasaki-z900/index.html", "/motorrad/kawasaki-z900/", "Kawasaki Z900"],
    ["vergleich/kawasaki-z900-vs-yamaha-mt09/index.html", "/vergleich/kawasaki-z900-vs-yamaha-mt09/", "Kawasaki Z900 vs. Yamaha MT-09"],
    ["ratgeber/bestes-a2-motorrad/index.html", "/ratgeber/bestes-a2-motorrad/", "A2"],
    ["motorraeder/fuehrerschein-a2/index.html", "/motorraeder/fuehrerschein-a2/", "A2"],
  ];
  const titles = new Set();
  for (const [file, path, expected] of pages) {
    const html = read(file);
    const m = metadata(html);
    assert.ok(m.title?.includes(expected), `${file}: title should name this page`);
    assert.ok(m.h1?.includes(expected), `${file}: H1 should identify this page`);
    assert.equal(m.canonical, `https://motomatch.studio${path}`);
    assert.equal(m["og:url"], m.canonical);
    assert.ok(m.description?.length > 40);
    assert.equal(m["twitter:card"], "summary_large_image");
    assert.equal(m["twitter:title"], m["og:title"]);
    assert.equal(m["twitter:description"], m["og:description"]);
    if (m["og:image"]) {
      assert.match(m["og:image"], /^https:\/\/motomatch\.studio\//);
      assert.ok(m["og:image:alt"]);
      assert.equal(m["twitter:image"], m["og:image"]);
      assert.equal(m["twitter:image:alt"], m["og:image:alt"]);
    }
    titles.add(m.title);
    assert.ok(html.includes("href=\"/favicon.ico\""));
    assert.ok(html.includes("href=\"/icon-192.png\""));
    assert.ok(html.includes("href=\"/apple-touch-icon.png\""));
    assert.ok(html.includes("href=\"/manifest.webmanifest\""));
  }
  assert.equal(titles.size, pages.length);

  const rootLd = strukturierteDaten(read("index.html")).flatMap((x) => x["@graph"] || [x]);
  assert.ok(rootLd.some((x) => x["@type"] === "WebSite" && x.name === "MotoMatch" && x.url === "https://motomatch.studio/"));
  assert.ok(rootLd.some((x) => x["@type"] === "Organization" && x.name === "MotoMatch" && x.logo === "https://motomatch.studio/icon-512.png"));
  assert.ok(strukturierteDaten(read("motorrad/kawasaki-z900/index.html")).some((x) => x["@type"] === "Motorcycle"));
  const article = strukturierteDaten(read("ratgeber/bestes-a2-motorrad/index.html")).find((x) => x["@type"] === "Article");
  assert.ok(article);
  assert.ok(article.dateModified >= article.datePublished);
});

test("fehlende Motorradfotos werden nicht als falsches Social Preview ausgegeben", () => {
  const m = metadata(read("motorrad/ducati-streetfighterv4sp/index.html"));
  assert.ok(m.title.includes("Ducati Streetfighter V4 SP"));
  assert.equal(m["og:image"], undefined);
  assert.equal(m["twitter:image"], undefined);
});

test("Sitemap und Robots bleiben konsistent mit kanonischer Production-Domain", () => {
  const sitemap = read("sitemap.xml");
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const pages = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
  const home = pages.find((p) => p.includes("<loc>https://motomatch.studio/</loc>"));
  const guide = pages.find((p) => p.includes("/ratgeber/bestes-a2-motorrad/"));
  const bike = pages.find((p) => p.includes("/motorrad/kawasaki-z900/"));
  assert.equal(pages.length, 3550);
  assert.ok(urls.every((u) => u.startsWith("https://motomatch.studio/")));
  assert.ok(home && !home.includes("<lastmod>"), "omit homepage lastmod without a reliable source date");
  assert.ok(guide?.includes("<lastmod>2026-10-05</lastmod>"), "guide sitemap date must not predate publication");
  assert.ok(bike?.includes("<lastmod>2026-10-02</lastmod>"), "catalog pages use the verified catalog data stand");
  assert.ok(pages.filter((p) => p.includes("<lastmod>")).every((p) => /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(p)));
  assert.ok(pages.some((p) => p.includes("<image:image><image:loc>https://motomatch.studio/bikes/")));
  assert.ok(read("robots.txt").includes("Sitemap: https://motomatch.studio/sitemap.xml"));
  assert.ok(read("robots.txt").includes("Allow: /"));
});

test("IndexNow akzeptiert nur begrenzte, eindeutige kanonische URLs", () => {
  const parsed = parseKanonischeUrls(
    "https://motomatch.studio/motorrad/kawasaki-z900/\n",
    "https://motomatch.studio/motorrad/alter-slug/\n",
  );
  assert.equal(parsed.alle.length, 2);
  assert.throws(() => parseKanonischeUrls("https://www.motomatch.studio/", ""), /kanonischen Host/);
  assert.throws(() => parseKanonischeUrls("https://motomatch.studio/?utm_source=test", ""), /Query/);
  assert.throws(() => parseKanonischeUrls("https://motomatch.studio/ratgeber/test", ""), /abschließendem Slash/);
  assert.throws(() => parseKanonischeUrls("https://motomatch.studio/a/\n", "https://motomatch.studio/a/"), /nur einmal/);
  assert.throws(() => parseKanonischeUrls(Array.from({ length: 101 }, (_, i) => `https://motomatch.studio/seite-${i}/`).join("\n"), ""), /höchstens 100/);
});

test("IndexNow verlangt das neueste erfolgreiche Production-Deployment", async () => {
  const responses = [
    { ok: true, json: async () => [
      { id: 42, environment: "Production – moto-matchwbapp", created_at: "2026-10-09T12:00:00Z", sha: "release" },
      { id: 41, environment: "Production – moto-matchwbapp", created_at: "2026-10-08T12:00:00Z", sha: "old" },
    ] },
    { ok: true, json: async () => [
      { state: "success", environment: "Production – moto-matchwbapp", created_at: "2026-10-09T12:01:00Z" },
    ] },
  ];
  let calls = 0;
  const fetchImpl = async () => responses[calls++];
  const deployment = await pruefeProductionDeployment({ repository: "HonarALrasheed/MotoMatchwbapp", deploymentId: "42", token: "test-token", fetchImpl });
  assert.equal(deployment.sha, "release");
  assert.equal(calls, 2);
});

test("IndexNow prüft Self-Canonical und echte 404s vor der Meldung", async () => {
  const changed = "https://motomatch.studio/ratgeber/bestes-a2-motorrad/";
  const deleted = "https://motomatch.studio/ratgeber/alter-ratgeber/";
  const fetchImpl = async (url) => url === changed
    ? { status: 200, headers: { get: (k) => k === "content-type" ? "text/html; charset=utf-8" : "" }, text: async () => `<meta name="robots" content="max-image-preview:large"><link rel="canonical" href="${changed}">` }
    : { status: 404, headers: { get: () => "text/plain" }, text: async () => "not found" };
  await pruefeProduktionsUrls({ aktualisiert: [changed], geloescht: [deleted], fetchImpl });
  await assert.rejects(pruefeProduktionsUrls({ aktualisiert: [changed], geloescht: [], fetchImpl: async () => ({ status: 200, headers: { get: () => "text/html" }, text: async () => "<link rel=\"canonical\" href=\"https://motomatch.studio/anderer-pfad/\">" }) }), /Self-Canonical/);
});
