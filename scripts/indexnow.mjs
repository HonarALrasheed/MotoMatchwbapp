/**
 * Meldet eine kleine, ausdrücklich ausgewählte URL-Liste an IndexNow.
 *
 * Ausführung ausschließlich in der manuellen GitHub-Aktion nach einem erfolgreichen,
 * aktuellen Production-Deploy. Die Aktion prüft Deployment, kanonische URLs und HTTP-Status.
 * Niemals die komplette Sitemap einreichen: unveränderte URLs brauchen keine erneute Meldung.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = "motomatch.studio";
const BASIS = `https://${HOST}`;
const MAX_URLS = 100;
const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseZeilen(raw, label) {
  if (typeof raw !== "string" || !raw.trim()) throw new Error(`${label}: Liste fehlt.`);
  const zeilen = raw.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (!zeilen.length) throw new Error(`${label}: Liste fehlt.`);
  return zeilen;
}

export function parseKanonischeUrls(neuOderGeaendert, geloescht) {
  const aktualisiert = neuOderGeaendert?.trim() ? parseZeilen(neuOderGeaendert, "Neue/geänderte URLs") : [];
  const entfernt = geloescht?.trim() ? parseZeilen(geloescht, "Gelöschte URLs") : [];
  if (!aktualisiert.length && !entfernt.length) throw new Error("Mindestens eine geänderte oder gelöschte URL ist erforderlich.");
  if (aktualisiert.length + entfernt.length > MAX_URLS) {
    throw new Error(`Pro Lauf sind höchstens ${MAX_URLS} betroffene URLs erlaubt.`);
  }

  const validiere = (urlText) => {
    let u;
    try { u = new URL(urlText); } catch { throw new Error(`Ungültige absolute URL: ${urlText}`); }
    if (u.protocol !== "https:" || u.hostname !== HOST || u.port || u.username || u.password || u.search || u.hash) {
      throw new Error(`Nur HTTPS-URLs des kanonischen Hosts ohne Query/Fragment sind erlaubt: ${urlText}`);
    }
    if (u.pathname !== "/" && !u.pathname.endsWith("/")) {
      throw new Error(`URL muss dem MotoMatch-Pfadformat mit abschließendem Slash entsprechen: ${urlText}`);
    }
    if (u.href !== urlText) throw new Error(`URL muss bereits kanonisch normalisiert sein: ${urlText}`);
    return urlText;
  };

  const urlsAktualisiert = aktualisiert.map(validiere);
  const urlsGeloescht = entfernt.map(validiere);
  const alle = [...urlsAktualisiert, ...urlsGeloescht];
  if (new Set(alle).size !== alle.length) throw new Error("Eine URL darf pro Lauf nur einmal vorkommen.");
  return { aktualisiert: urlsAktualisiert, geloescht: urlsGeloescht, alle };
}

async function githubJson(fetchImpl, url, token) {
  const antwort = await fetchImpl(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!antwort.ok) throw new Error("GitHub-Deployment konnte nicht read-only verifiziert werden.");
  return antwort.json();
}

export async function pruefeProductionDeployment({ repository, deploymentId, token, fetchImpl = fetch }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || "") || !/^\d+$/.test(String(deploymentId || "")) || !token) {
    throw new Error("GitHub-Repository, Production-Deployment-ID oder Lesetoken fehlt.");
  }
  const api = `https://api.github.com/repos/${repository}`;
  const deployments = await githubJson(fetchImpl, `${api}/deployments?per_page=100`, token);
  const production = deployments
    .filter((d) => /^production\b/i.test(d.environment || ""))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const latest = production[0];
  if (!latest || String(latest.id) !== String(deploymentId)) {
    throw new Error("Die angegebene Deployment-ID ist nicht das neueste Production-Deployment dieses Repositories.");
  }
  const statuses = await githubJson(fetchImpl, `${api}/deployments/${latest.id}/statuses?per_page=10`, token);
  const latestStatus = [...statuses].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (latestStatus?.state !== "success" || !/^production\b/i.test(latestStatus.environment || latest.environment || "")) {
    throw new Error("Das neueste Production-Deployment ist nicht erfolgreich abgeschlossen.");
  }
  return { id: String(latest.id), sha: latest.sha };
}

function kanonischerLink(html) {
  const tag = html.match(/<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/i)?.[0];
  return tag?.match(/\bhref=["']([^"']+)["']/i)?.[1] || null;
}

export async function pruefeProduktionsUrls({ aktualisiert, geloescht, fetchImpl = fetch }) {
  for (const url of aktualisiert) {
    const antwort = await fetchImpl(url, { redirect: "manual", headers: { "User-Agent": "MotoMatch-IndexNow-Release-Check/1.0" } });
    const robotsHeader = antwort.headers?.get("x-robots-tag") || "";
    if (antwort.status !== 200 || (antwort.headers?.get("content-type") || "").includes("text/html") === false) {
      throw new Error(`Geänderte URL ist nicht als HTML mit HTTP 200 erreichbar: ${url}`);
    }
    const html = await antwort.text();
    const robots = html.match(/<meta\b[^>]*\bname=["'](?:robots|googlebot)["'][^>]*\bcontent=["']([^"']*)["'][^>]*>/i)?.[1] || "";
    if (/\bnoindex\b/i.test(`${robotsHeader},${robots}`) || kanonischerLink(html) !== url) {
      throw new Error(`Geänderte URL ist nicht indexierbar oder hat keinen passenden Self-Canonical: ${url}`);
    }
  }
  for (const url of geloescht) {
    const antwort = await fetchImpl(url, { redirect: "manual", headers: { "User-Agent": "MotoMatch-IndexNow-Release-Check/1.0" } });
    if (antwort.status !== 404) throw new Error(`Gelöschte URL liefert nicht HTTP 404 (oder leitet weiter): ${url}`);
  }
}

async function main() {
  const { aktualisiert, geloescht, alle } = parseKanonischeUrls(
    process.env.INDEXNOW_CHANGED_URLS,
    process.env.INDEXNOW_DELETED_URLS,
  );
  const deployment = await pruefeProductionDeployment({
    repository: process.env.GITHUB_REPOSITORY,
    deploymentId: process.env.INDEXNOW_PRODUCTION_DEPLOYMENT_ID,
    token: process.env.GITHUB_TOKEN,
  });
  await pruefeProduktionsUrls({ aktualisiert, geloescht });

  const schluesselDateien = readdirSync(join(WURZEL, "public")).filter((f) => /^[0-9a-f]{32}\.txt$/.test(f));
  if (schluesselDateien.length !== 1) throw new Error("IndexNow-Schlüsseldatei fehlt oder ist mehrdeutig.");
  const datei = schluesselDateien[0];
  const key = datei.replace(/\.txt$/, "");
  if (readFileSync(join(WURZEL, "public", datei), "utf8").trim() !== key) {
    throw new Error("IndexNow-Schlüsseldatei stimmt nicht mit ihrem Dateinamen überein.");
  }

  const antwort = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: HOST, key, keyLocation: `${BASIS}/${datei}`, urlList: alle }),
  });
  if (antwort.status !== 200 && antwort.status !== 202) {
    throw new Error(`IndexNow hat die ausgewählte URL-Liste nicht angenommen (HTTP ${antwort.status}).`);
  }
  console.log(`[indexnow] Production-Deployment ${deployment.id} verifiziert; ${alle.length} ausgewählte URL(s) angenommen.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`[indexnow] Abbruch: ${error.message}`);
    process.exitCode = 1;
  });
}
