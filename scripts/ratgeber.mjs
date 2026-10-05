/**
 * MotoMatch — Ratgeber-Artikel (2026-10-05)
 *
 * Viele Suchen sind Fragen ("a2 drosselung wie funktioniert das", "motorrad gebraucht kaufen
 * worauf achten"). Jeder Artikel beantwortet eine davon in ganzen Sätzen und rechnet seine Zahlen
 * aus dem Katalog: wie viele Modelle, typische Preise, Steuer, Wertverlust. Das unterscheidet ihn
 * von den hundert anderen Ratgebern — Google wertet Texte ohne eigene Substanz ab.
 *
 * Rechtliches (Führerscheinklassen, Kraftradsteuer) nach FeV und KraftStG, Stand 2026; im Zweifel
 * vorsichtig formuliert ("in der Regel"), nie als Rechtsberatung.
 *
 * Aufruf aus scripts/seo-seiten.mjs: artikel(h) liefert [{ slug, titel, h1, beschreibung, inhalt, held, fakten }].
 * held = Bike fürs Titelbild (oder Liste von Kandidaten), fakten = [[Zahl, Erklärung]] für "Auf einen Blick".
 */

export function artikel(h) {
  const { bikes, preis, zahl, dez, darfA2, bikePfad, themaPfad, esc, STIL, karte, hatFoto } = h; // h.ausruestung: Produkte aus gear.js
  // Bike-Karten mit Bild mitten im Text — liest sich besser als eine Namensliste
  const reihe = (l) => (l.length ? `<ul class="raster mini">${l.map(karte).join("")}</ul>` : "");
  const mitFoto = (l) => l.filter((b) => hatFoto(b));
  const link = (b) => `<a href="${bikePfad.get(b)}">${esc(b.name)}</a>`;
  const thema = (slug, text) => (themaPfad(slug) ? `<a href="${themaPfad(slug)}">${text}</a>` : text);
  const beliebt = (liste, n) => [...liste].sort((a, b) => (b.pop || 0) - (a.pop || 0)).slice(0, n);
  const median = (werte) => { const w = [...werte].sort((a, b) => a - b); return w.length ? w[Math.floor(w.length / 2)] : 0; };
  const euro = (n) => `${zahl(n)} €`;
  const mitPreis = (liste) => liste.filter((b) => preis(b));
  const tabelle = (kopf, zeilen) => `<table class="tabelle"><tr>${kopf.map((k) => `<th>${k}</th>`).join("")}</tr>${zeilen.map((z) => `<tr>${z.map((x) => `<td>${x}</td>`).join("")}</tr>`).join("")}</table>`;

  const a1 = bikes.filter((b) => b.license === "A1");
  const a2offen = bikes.filter((b) => b.license === "A2");
  const a2gedrosselt = bikes.filter((b) => b.license === "A" && b.a2);
  const klasseA = bikes.filter((b) => b.license === "A");
  const einsteiger = bikes.filter((b) => b.beginner);
  const liste = [];

  // ── 1. Führerscheinklassen ────────────────────────────────────────────
  {
    const zeilen = [
      ["A1", "16 Jahre", "bis 125 ccm, 11 kW (15 PS), 0,1 kW/kg", `${a1.length}`],
      ["B196", "25 Jahre, Klasse B seit 5 Jahren", "wie A1, nur in Deutschland", `${a1.length}`],
      ["A2", "18 Jahre", "bis 35 kW (48 PS), 0,2 kW/kg", `${a2offen.length + a2gedrosselt.length + a1.length}`],
      ["A", "24 Jahre (Aufstieg ab 20)", "keine Leistungsgrenze", `${bikes.length}`],
    ];
    liste.push({
      slug: "fuehrerscheinklassen-a1-a2-a",
      titel: "Motorradführerschein A1, A2, A und B196: der Unterschied einfach erklärt",
      h1: "A1, A2, A oder B196 — welcher Motorradführerschein für welches Motorrad?",
      beschreibung: "Mindestalter, Leistungsgrenzen und welche Motorräder du mit A1, B196, A2 und A fahren darfst — mit Modellzahlen aus über 1.000 Motorrädern.",
      held: beliebt(mitFoto(a2gedrosselt), 2)[1],
      fakten: [["16", "Jahre: A1"], ["18", "Jahre: A2"], ["35 kW", "Grenze für A2"], [zahl(bikes.length), "Modelle mit A"]],
      inhalt: `
      <p>In Deutschland gibt es drei Motorradklassen und eine Abkürzung über den Autoführerschein. Welche du brauchst, hängt an zwei Dingen: deinem Alter und der Leistung des Motorrads. Die Tabelle zeigt die Grenzen und wie viele Modelle aus unserem Katalog du jeweils fahren darfst.</p>
      ${tabelle(["Klasse", "Mindestalter", "Grenze", "Modelle bei MotoMatch"], zeilen)}
      <h2>A1: der Einstieg ab 16</h2>
      <p>Mit A1 fährst du Leichtkrafträder: höchstens 125 ccm, 11 kW und ein Leistungsgewicht bis 0,1 kW pro Kilogramm. Das reicht für die Stadt und die Landstraße, auf der Autobahn wird es knapp. Im Katalog sind ${a1.length} Modelle, beliebt sind zum Beispiel ${beliebt(a1, 3).map(link).join(", ")}. Alle zeigt die Seite ${thema("fuehrerschein-a1", "A1-Motorräder")}.</p>
      ${reihe(beliebt(mitFoto(a1), 4))}
      <h2>B196: 125er mit dem Autoführerschein</h2>
      <p>Wer mindestens 25 Jahre alt ist und den Autoführerschein seit fünf Jahren hat, kann sich die Schlüsselzahl 196 eintragen lassen. Dafür gibt es keine Prüfung, sondern eine Schulung in der Fahrschule. Danach fährst du dieselben Motorräder wie mit A1 — allerdings nur in Deutschland. Mehr dazu im Ratgeber <a href="/ratgeber/b196-125er-mit-autofuehrerschein/">B196</a>.</p>
      <h2>A2: die Mittelklasse ab 18</h2>
      <p>A2 erlaubt bis 35 kW (48 PS) und 0,2 kW pro Kilogramm. Dazu kommen gedrosselte Motorräder: Ein Bike mit ursprünglich bis zu 70 kW darf auf 35 kW gedrosselt werden. Im Katalog sind ${a2offen.length} Modelle offen A2-tauglich, ${a2gedrosselt.length} weitere lassen sich drosseln. Wie das funktioniert, steht im Ratgeber <a href="/ratgeber/a2-drosselung/">A2-Drosselung</a>.</p>
      ${reihe(beliebt(mitFoto(a2offen.concat(a2gedrosselt)), 4))}
      <h2>A: ohne Grenze</h2>
      <p>Den offenen Führerschein A gibt es direkt ab 24 Jahren. Schneller geht es über den Aufstieg: Wer zwei Jahre A2 hat, kann ab 20 mit einer praktischen Prüfung auf A wechseln — eine neue Theorieprüfung ist dafür nicht nötig. Mit A darfst du alle ${bikes.length} Motorräder im Katalog fahren.</p>
      <h2>Welche Klasse passt zu dir?</h2>
      <p>Wer jung ist oder erst einmal ausprobieren will, fängt mit A1 oder B196 an. Wer ab 18 ernsthaft einsteigt, macht in der Regel gleich A2: Die Auswahl ist viel größer, und nach zwei Jahren ist der Weg zu A kurz. Im Quiz wählst du einfach deine Klasse — MotoMatch zeigt dann nur Motorräder, die du auch fahren darfst.</p>`,
    });
  }

  // ── 2. A2-Drosselung ─────────────────────────────────────────────────
  {
    const gp = mitPreis(a2gedrosselt);
    liste.push({
      slug: "a2-drosselung",
      titel: "A2-Drosselung: wie sie funktioniert, was erlaubt ist und welche Motorräder gehen",
      h1: "A2-Drosselung: so fährst du ein stärkeres Motorrad mit A2",
      beschreibung: `Welche Motorräder darf man auf 35 kW drosseln, wie läuft die Eintragung und was passiert beim Aufstieg auf A? ${a2gedrosselt.length} drosselbare Modelle mit Preisen.`,
      held: beliebt(mitFoto(a2gedrosselt), 3)[2],
      fakten: [["35 kW", "nach der Drosselung"], ["70 kW", "höchstens ab Werk"], [zahl(a2gedrosselt.length), "drosselbare Modelle"], [euro(median(gp.map(preis))), "mittlerer Gebrauchtpreis"]],
      inhalt: `
      <p>Mit dem A2-Führerschein darfst du höchstens 35 kW (48 PS) fahren. Viele beliebte Mittelklasse-Motorräder haben mehr — sie lassen sich aber drosseln. ${a2gedrosselt.length} Modelle in unserem Katalog sind für die A2-Drosselung geeignet; der mittlere Gebrauchtpreis liegt bei ${euro(median(gp.map(preis)))}.</p>
      <h2>Die Regeln</h2>
      <ul class="punkte">
        <li>Nach der Drosselung höchstens 35 kW und 0,2 kW pro Kilogramm Leergewicht.</li>
        <li>Das Motorrad darf ursprünglich höchstens 70 kW haben — also nicht mehr als die doppelte A2-Leistung.</li>
        <li>Die Drosselung muss in die Fahrzeugpapiere eingetragen werden. Ohne Eintragung fährst du rechtlich ohne passende Fahrerlaubnis.</li>
      </ul>
      <h2>Wie die Drosselung abläuft</h2>
      <p>Die meisten Hersteller bieten einen Drosselsatz an; dazu kommen Lösungen von Zubehörfirmen. Eingebaut wird er meist vom Händler oder einer Werkstatt — bei modernen Motorrädern ist es oft nur eine Änderung in der Motorsteuerung, bei älteren ein Teil im Ansaugtrakt. Zum Satz gehört ein Gutachten. Damit lässt du die Änderung bei einer Prüforganisation (TÜV, DEKRA o. Ä.) abnehmen und in der Regel bei der Zulassungsstelle in die Zulassungsbescheinigung eintragen. Sag auch deiner Versicherung Bescheid.</p>
      <h2>Und nach zwei Jahren?</h2>
      <p>Nach dem Aufstieg auf A kannst du die Drosselung wieder ausbauen lassen — auch das wird eingetragen. Genau das macht gedrosselte Motorräder so beliebt: Du kaufst einmal und wächst mit dem Bike mit.</p>
      <h2>Beliebte drosselbare Motorräder</h2>
      ${reihe(beliebt(mitFoto(a2gedrosselt), 4))}
      <p>Alle A2-tauglichen Modelle — offen und gedrosselt — zeigt die Seite ${thema("fuehrerschein-a2", "A2-Motorräder")}, nach Budget sortiert ${thema("a2-unter-5000-euro", "A2 unter 5.000 €")}.</p>
      <h2>Offen A2 oder gedrosselt?</h2>
      <p>Ein offen A2-taugliches Motorrad (${a2offen.length} Modelle) ist meist leichter und günstiger. Ein gedrosseltes Bike fühlt sich in den zwei A2-Jahren oft etwas zäh an, hat aber danach deutlich mehr Reserven. Wer weiß, dass er schnell auf A aufsteigt, fährt mit der Drossel gut; wer sparen will, mit einem offenen A2-Modell.</p>
      ${reihe(beliebt(mitFoto(a2offen.filter((b) => b.style !== "Roller")), 4))}`,
    });
  }

  // ── 3. B196 ──────────────────────────────────────────────────────────
  {
    const roller = a1.filter((b) => b.style === "Roller");
    const p = mitPreis(a1);
    liste.push({
      slug: "b196-125er-mit-autofuehrerschein",
      titel: "B196: 125er mit dem Autoführerschein fahren — Voraussetzungen und passende Modelle",
      h1: "B196: Motorrad fahren mit dem Autoführerschein",
      beschreibung: `Wer darf mit B196 fahren, wie läuft die Schulung, und welche 125er lohnen sich? ${a1.length} Modelle, typischer Gebrauchtpreis ${euro(median(p.map(preis)))}.`,
      held: beliebt(mitFoto(a1.filter((b) => b.style !== "Roller")), 1)[0],
      fakten: [["25", "Jahre Mindestalter"], ["5 Jahre", "Klasse B"], ["125 ccm", "11 kW höchstens"], [zahl(a1.length), "passende Modelle"]],
      inhalt: `
      <p>Mit der Schlüsselzahl 196 dürfen Autofahrer Leichtkrafträder bis 125 ccm und 11 kW fahren — ohne Motorradprüfung. Das ist der günstigste Weg aufs Motorrad, mit einem Haken: Die Erweiterung gilt nur in Deutschland.</p>
      <h2>Voraussetzungen</h2>
      <ul class="punkte">
        <li>Mindestens 25 Jahre alt.</li>
        <li>Führerschein Klasse B seit mindestens fünf Jahren.</li>
        <li>Schulung in der Fahrschule: Theorie und praktische Fahrstunden, aber keine Prüfung. Danach trägt die Führerscheinstelle die 196 ein.</li>
      </ul>
      <h2>Welche Motorräder?</h2>
      <p>Dieselben wie mit A1: ${a1.length} Modelle in unserem Katalog, davon ${roller.length} Roller. Der mittlere Gebrauchtpreis liegt bei ${euro(median(p.map(preis)))}. Die ganze Liste: ${thema("fuehrerschein-b196", "Motorräder für B196")}.</p>
      ${reihe(beliebt(mitFoto(a1), 4))}
      <h2>Roller oder Motorrad?</h2>
      <p>Wer vor allem pendelt, ist mit einem 125er-Roller gut bedient: Automatik, Stauraum, Wetterschutz (${thema("motorroller-125", "125er-Roller")}). Wer Landstraße fahren will, nimmt ein Naked Bike oder eine kleine Enduro — mit Schaltung, aber mehr Fahrspaß (${thema("naked-bike-125", "125er Naked Bikes")}).</p>
      <h2>Lohnt sich B196 statt A1?</h2>
      <p>Für erfahrene Autofahrer, die nur in Deutschland fahren und keine Lust auf eine weitere Prüfung haben: ja. Wer ins Ausland will oder später größer fahren möchte, ist mit A1 oder gleich A2 besser beraten — diese Klassen gelten EU-weit und sind die Grundlage für den Aufstieg.</p>`,
    });
  }

  // ── 4. Erstes Motorrad ───────────────────────────────────────────────
  {
    const ep = mitPreis(einsteiger);
    const leichtEinst = einsteiger.filter((b) => b.weight && b.weight <= 190);
    liste.push({
      slug: "erstes-motorrad-kaufen",
      titel: "Erstes Motorrad kaufen: worauf Anfänger achten sollten",
      h1: "Das erste Motorrad: sieben Fragen vor dem Kauf",
      beschreibung: `Führerschein, Sitzhöhe, Gewicht, Budget: Was beim ersten Motorrad wirklich zählt — mit ${einsteiger.length} einsteigerfreundlichen Modellen ab ${euro(Math.min(...ep.map(preis)))}.`,
      held: beliebt(mitFoto(leichtEinst.filter((b) => b.style !== "Roller")), 1)[0],
      fakten: [[zahl(einsteiger.length), "Einsteiger-Modelle"], [zahl(leichtEinst.length), "davon unter 190 kg"], [euro(median(ep.map(preis))), "mittlerer Gebrauchtpreis"]],
      inhalt: `
      <p>Beim ersten Motorrad entscheidet nicht die Leistung, sondern ob du dich darauf sicher fühlst. Diese sieben Fragen helfen beim Aussortieren.</p>
      <h2>1. Was erlaubt mein Führerschein?</h2>
      <p>Mit A2 darfst du höchstens 35 kW fahren — offen oder gedrosselt. Details im Ratgeber <a href="/ratgeber/fuehrerscheinklassen-a1-a2-a/">Führerscheinklassen</a>.</p>
      <h2>2. Komme ich mit beiden Füßen auf den Boden?</h2>
      <p>Das ist für Anfänger wichtiger als jedes Datenblatt. Als Faustregel passt eine Sitzhöhe bis etwa 46 % deiner Körpergröße. Für 1,70 m sind das rund 79 cm. Mehr im Ratgeber <a href="/ratgeber/sitzhoehe-koerpergroesse/">Sitzhöhe und Körpergröße</a>.</p>
      <h2>3. Wie schwer darf es sein?</h2>
      <p>Rangieren, Wenden, ein umgefallenes Motorrad aufheben: Unter 190 kg ist das für die meisten gut machbar. ${leichtEinst.length} einsteigerfreundliche Modelle bleiben darunter, zum Beispiel:</p>
      ${reihe(beliebt(mitFoto(leichtEinst), 4))}
      <h2>4. Was will ich damit fahren?</h2>
      <p>Pendeln, Landstraße, Reisen, Schotter? Naked Bikes sind die vielseitigsten Einsteiger-Motorräder, Enduros bieten bequeme Sitzpositionen, Sportler sind für Anfänger eher anstrengend. Ein Überblick steht im Ratgeber <a href="/ratgeber/motorradtypen/">Motorradtypen</a>.</p>
      <h2>5. Neu oder gebraucht?</h2>
      <p>Das erste Motorrad fällt oft einmal um. Ein gepflegter Gebrauchter verliert weniger Wert und schmerzt weniger bei Kratzern. Der mittlere Gebrauchtpreis eines Einsteiger-Modells liegt bei ${euro(median(ep.map(preis)))}.</p>
      <h2>6. Was kostet es im Jahr?</h2>
      <p>Neben dem Kaufpreis kommen Versicherung, Steuer, Wartung, Reifen und Ausrüstung dazu. Die Steuer ist gering (siehe <a href="/ratgeber/motorradsteuer/">Motorradsteuer</a>), die Ausrüstung kostet dagegen schnell 800 bis 1.500 €.</p>
      <h2>7. Probe sitzen und probe fahren</h2>
      <p>Setz dich auf mehrere Modelle, bevor du kaufst. Die Daten helfen beim Vorsortieren; das Gefühl entscheidet. Eine gute Vorauswahl findest du unter ${thema("einsteiger", "Einsteiger-Motorräder")} — oder im Quiz, das alle sieben Fragen auf einmal berücksichtigt.</p>`,
    });
  }

  // ── 5. Gebraucht kaufen ──────────────────────────────────────────────
  liste.push({
    slug: "motorrad-gebraucht-kaufen-checkliste",
    titel: "Motorrad gebraucht kaufen: Checkliste für die Besichtigung",
    h1: "Gebrauchtes Motorrad kaufen: die Checkliste",
    beschreibung: "Kette, Reifenalter, Bremsen, Gabel, Papiere: Worauf du bei der Besichtigung eines gebrauchten Motorrads achten solltest — Schritt für Schritt.",
    held: beliebt(mitFoto(bikes.filter((b) => b.style === "Naked")), 1)[0],
    fakten: [["6 Jahre", "Reifenalter: dann tauschen"], ["4", "Schritte: Rundgang, Kaltstart, Probefahrt, Papiere"]],
    checkliste: true,
    inhalt: `
      <p>Ein gebrauchtes Motorrad ist oft die klügere Wahl — wenn du weißt, worauf du schaust. Nimm diese Liste zur Besichtigung mit, am besten zusammen mit jemandem, der sich auskennt.</p>
      <h2>Vor dem Termin</h2>
      <ul class="punkte">
        <li>Marktpreis prüfen: Für jedes Modell zeigt MotoMatch den mittleren Gebrauchtpreis nach Baujahr.</li>
        <li>Fragen, ob das Motorrad kalt ist — der Kaltstart verrät viel.</li>
        <li>Fahrzeugpapiere, Serviceheft und Rechnungen zur Besichtigung mitbringen lassen.</li>
      </ul>
      <h2>Rundgang am Motorrad</h2>
      <ul class="punkte">
        <li><strong>Sturzspuren:</strong> Kratzer an Hebeln, Lenkerenden, Fußrasten, Spiegeln und Motordeckeln.</li>
        <li><strong>Reifen:</strong> Profil und Alter. Die DOT-Nummer zeigt Woche und Jahr; ältere Reifen als etwa sechs Jahre sollten getauscht werden — rechne das in den Preis ein.</li>
        <li><strong>Kette und Ritzel:</strong> Spitze Zähne am Ritzel oder eine Kette, die sich am Kettenrad weit abziehen lässt, bedeuten einen baldigen Wechsel.</li>
        <li><strong>Bremsen:</strong> Belagstärke und Scheiben (Riefen, Grat am Rand), Bremsflüssigkeit nicht dunkel.</li>
        <li><strong>Gabel:</strong> Ölspuren an den Standrohren deuten auf undichte Simmerringe hin.</li>
        <li><strong>Lenkkopflager:</strong> Vorderrad anheben, Lenker langsam drehen — er sollte nicht rasten.</li>
        <li><strong>Öl und Kühlmittel:</strong> Ölstand, Farbe, keine Feuchtigkeit am Motor.</li>
      </ul>
      <h2>Kaltstart und Probefahrt</h2>
      <ul class="punkte">
        <li>Springt der Motor kalt sauber an? Klappern oder blauer Rauch sind Warnzeichen.</li>
        <li>Gänge schalten sauber, Kupplung trennt, keine Geräusche beim Lastwechsel.</li>
        <li>Fährt das Motorrad geradeaus, wenn du den Lenker locker hältst?</li>
        <li>Probefahrt nur mit gültigem Führerschein und Ausrüstung; Kaution ist üblich.</li>
      </ul>
      <h2>Papiere und Vertrag</h2>
      <ul class="punkte">
        <li>Fahrgestellnummer am Rahmen mit der Zulassungsbescheinigung vergleichen.</li>
        <li>Bei gedrosselten Motorrädern: Ist die Drosselung eingetragen? (siehe <a href="/ratgeber/a2-drosselung/">A2-Drosselung</a>)</li>
        <li>Datum der nächsten Hauptuntersuchung prüfen.</li>
        <li>Schriftlichen Kaufvertrag machen — Vorlagen gibt es zum Beispiel bei den Automobilclubs.</li>
      </ul>
      <p>Wie viel ein Modell gebraucht wert ist und wie stark es mit dem Alter an Wert verliert, zeigt der Ratgeber <a href="/ratgeber/motorrad-neu-oder-gebraucht/">Neu oder gebraucht</a>.</p>`,
  });

  // ── 6. Motorradsteuer ────────────────────────────────────────────────
  {
    const steuer = (cc) => Math.ceil(cc / 25) * 1.84;
    const beispiele = beliebt(bikes.filter((b) => b.cc > 0), 40)
      .filter((b, i, a) => a.findIndex((x) => Math.ceil(x.cc / 25) === Math.ceil(b.cc / 25)) === i)
      .sort((a, b) => a.cc - b.cc).slice(0, 12);
    const alleSteuer = bikes.filter((b) => b.cc > 0).map((b) => steuer(b.cc));
    liste.push({
      slug: "motorradsteuer",
      titel: "Motorradsteuer berechnen: was dein Motorrad im Jahr kostet (mit Tabelle)",
      h1: "Motorradsteuer: so wird sie berechnet",
      beschreibung: `1,84 € je angefangene 25 ccm: So berechnest du die Kfz-Steuer fürs Motorrad, mit Beispielen von 125 bis über 1.000 ccm. Im Mittel ${dez(median(alleSteuer).toFixed(2))} € im Jahr.`,
      held: beispiele.filter((b) => hatFoto(b)).at(-1),
      fakten: [["1,84 €", "je angefangene 25 ccm"], ["9,20 €", "für eine 125er"], [`${dez(median(alleSteuer).toFixed(2))} €`, "im Mittel pro Jahr"]],
      inhalt: `
      <p>Die Kfz-Steuer für Motorräder hängt nur am Hubraum: 1,84 € pro angefangene 25 ccm und Jahr. Abgaswerte oder CO₂ spielen keine Rolle. Über alle ${zahl(alleSteuer.length)} Modelle in unserem Katalog liegt die Steuer im Mittel bei ${dez(median(alleSteuer).toFixed(2))} € im Jahr.</p>
      <h2>Rechenbeispiel</h2>
      <p>Ein Motorrad mit 689 ccm: 689 ÷ 25 = 27,56 — angefangen sind also 28 Einheiten. 28 × 1,84 € = 51,52 € im Jahr.</p>
      <h2>Beispiele aus dem Katalog</h2>
      ${tabelle(["Modell", "Hubraum", "Steuer pro Jahr"], beispiele.map((b) => [link(b), `${zahl(b.cc)} ccm`, `${dez(steuer(b.cc).toFixed(2))} €`]))}
      <h2>Was sonst noch kostet</h2>
      <p>Die Steuer ist der kleinste Posten. Mehr ins Gewicht fallen Versicherung (abhängig von Leistung, Alter und Schadenfreiheitsklasse), Wartung und Reifen. Viele fahren mit Saisonkennzeichen, etwa von März bis Oktober — dann zahlst du Steuer und Versicherung nur für diese Monate.</p>
      <p>Am günstigsten sind 125er (${thema("fuehrerschein-a1", "A1-Motorräder")}): 9,20 € im Jahr.</p>`,
    });
  }

  // ── 7. Sitzhöhe ──────────────────────────────────────────────────────
  {
    const zeilen = [150, 155, 160, 165, 170, 175, 180, 185, 190].map((cm) => {
      const bis = Math.round(cm * 0.45 * 1.03 * 10) / 10;
      const n = bikes.filter((b) => b.seat_height > 0 && b.seat_height <= bis).length;
      return [`${dez((cm / 100).toFixed(2))} m`, `bis ca. ${dez(bis)} cm`, cm <= 175 ? thema(`motorrad-fuer-${cm}-cm`, `${zahl(n)} Modelle`) : `${zahl(n)} Modelle`];
    });
    const tief = beliebt(bikes.filter((b) => b.seat_height > 0 && b.seat_height <= 72 && hatFoto(b)), 4);
    liste.push({
      slug: "sitzhoehe-koerpergroesse",
      titel: "Motorrad Sitzhöhe und Körpergröße: welche Sitzhöhe passt zu mir? (Tabelle)",
      h1: "Welche Sitzhöhe passt zu meiner Körpergröße?",
      beschreibung: "Faustregel und Tabelle von 1,50 bis 1,90 m: welche Sitzhöhe du sicher fährst und wie viele Motorräder dazu passen — plus Tipps für kleinere Fahrer.",
      held: mitFoto(tief)[0],
      fakten: [["45 %", "der Körpergröße + 3 % Reserve"], [zahl(bikes.filter((b) => b.seat_height > 0 && b.seat_height <= 74.2).length), "Modelle für 1,60 m"], [zahl(bikes.filter((b) => b.seat_height > 0 && b.seat_height <= 78).length), "Modelle bis 78 cm"]],
      inhalt: `
      <p>Sicher fühlst du dich auf einem Motorrad, wenn du an der Ampel mit beiden Fußballen auf den Boden kommst. Als Faustregel passt eine Sitzhöhe bis etwa 45 % der Körpergröße plus drei Prozent Reserve. Die Tabelle zeigt, was das bedeutet — und wie viele Modelle aus unserem Katalog jeweils passen.</p>
      ${tabelle(["Körpergröße", "Sitzhöhe", "Passende Motorräder"], zeilen)}
      <h2>Warum die Zahl allein nicht reicht</h2>
      <p>Wie gut du auf den Boden kommst, hängt auch an der Schrittlänge und an der Sitzbank: Eine schmale Sitzbank lässt die Beine gerader nach unten, eine breite Enduro-Sitzbank spreizt sie. Zwei Motorräder mit gleicher Sitzhöhe können sich deshalb sehr unterschiedlich anfühlen. Probesitzen bleibt Pflicht.</p>
      <h2>Tipps für kleinere Fahrer</h2>
      <ul class="punkte">
        <li>Viele Hersteller bieten eine Niedrigsitzbank oder eine Tieferlegung ab Werk an.</li>
        <li>Stiefel mit etwas dickerer Sohle bringen ein bis zwei Zentimeter.</li>
        <li>Leichte Motorräder verzeihen es eher, wenn nur ein Fuß sicher steht.</li>
      </ul>
      <h2>Besonders niedrige Motorräder</h2>
      ${reihe(mitFoto(tief))}
      <p>Alle Modelle bis 78 cm: ${thema("niedrige-sitzhoehe", "Motorräder mit niedriger Sitzhöhe")}. Für große Fahrer: ${thema("motorrad-fuer-grosse-fahrer", "Motorräder ab 1,85 m")}.</p>`,
    });
  }

  // ── 8. Motorradtypen ─────────────────────────────────────────────────
  {
    const ERKL = {
      Naked: "Ohne Verkleidung, aufrechte Sitzposition, handlich. Für viele das beste erste Motorrad und der Allrounder für Stadt und Landstraße.",
      Enduro: "Hohe Sitzposition, lange Federwege, bequem auf langen Strecken. Reiseenduros sind die Langstrecken-Spezialisten, kleine Enduros können auch Schotter.",
      Sportbike: "Vollverkleidung, nach vorn geneigte Sitzposition, viel Leistung. Für Kurven und Rennstrecke — im Alltag eher anstrengend.",
      Touring: "Viel Wetterschutz, Platz für Gepäck und Beifahrer, oft schwer. Für Reisende, die Kilometer machen wollen.",
      Cruiser: "Tiefe Sitzbank, Füße nach vorn, entspanntes Fahren. Meist niedrige Sitzhöhe — gut für kleinere Fahrer.",
      Klassiker: "Moderne Technik im Stil der 60er und 70er: Café Racer, Scrambler, Roadster. Viel Stil, meist alltagstauglich.",
      Supermoto: "Enduro-Fahrwerk mit Straßenreifen, sehr leicht und wendig. Spaß in der Stadt und auf engen Straßen, wenig Komfort.",
      Roller: "Automatik, Stauraum, Wetterschutz. Die praktischste Wahl zum Pendeln, besonders als 125er.",
    };
    const zeilen = Object.keys(ERKL).map((stil) => {
      const l = bikes.filter((b) => b.style === stil);
      return [thema(STIL[stil]?.slug, esc(STIL[stil]?.mehrzahl || stil)), `${l.length}`, euro(median(mitPreis(l).map(preis))), `${median(l.filter((b) => b.seat_height).map((b) => b.seat_height))} cm`];
    });
    liste.push({
      slug: "motorradtypen",
      titel: "Motorradtypen erklärt: Naked Bike, Enduro, Sportler, Cruiser & Co.",
      h1: "Motorradtypen: welche Bauart passt zu dir?",
      beschreibung: "Naked Bike, Reiseenduro, Sportler, Tourer, Cruiser, Retro, Supermoto, Roller: Was die Bauarten können — mit typischem Preis und Sitzhöhe aus über 1.000 Modellen.",
      held: beliebt(mitFoto(bikes.filter((b) => b.style === "Enduro" && b.brand !== "BMW")), 1)[0],
      fakten: [["8", "Bauarten"], [zahl(bikes.length), "Modelle im Vergleich"]],
      inhalt: `
      <p>Die Bauart sagt mehr über ein Motorrad als die PS-Zahl: Sie bestimmt Sitzposition, Komfort und wofür es gemacht ist. Die Tabelle zeigt die acht Typen mit mittlerem Gebrauchtpreis und typischer Sitzhöhe aus unserem Katalog.</p>
      ${tabelle(["Bauart", "Modelle", "Preis (Mitte)", "Sitzhöhe (Mitte)"], zeilen)}
      ${Object.entries(ERKL).map(([stil, text]) => {
        const top = beliebt(mitFoto(bikes.filter((b) => b.style === stil)), 4);
        return `<h2>${esc(STIL[stil]?.mehrzahl || stil)}</h2><p>${text}</p>${reihe(top)}`;
      }).join("\n      ")}
      <p>Unsicher? Das Quiz fragt, wofür du fahren willst, und schlägt passende Bauarten vor.</p>`,
    });
  }

  // ── 9. Neu oder gebraucht (Wertverlust) ──────────────────────────────
  {
    const raten = [];
    for (const b of bikes) {
      const j = Object.entries(b.priceYears || {}).map(([y, v]) => [+y, v]).filter(([, v]) => v > 1).sort((x, y) => x[0] - y[0]);
      for (let i = 1; i < j.length; i++) if (j[i][0] === j[i - 1][0] + 1) raten.push((j[i][1] - j[i - 1][1]) / j[i][1]);
    }
    const proJahr = median(raten);
    const beispiel = beliebt(bikes.filter((b) => Object.keys(b.priceYears || {}).length >= 5), 1)[0];
    const bj = beispiel ? Object.entries(beispiel.priceYears).filter(([, v]) => v > 1).sort((a, b) => b[0] - a[0]) : [];
    liste.push({
      slug: "motorrad-neu-oder-gebraucht",
      titel: "Motorrad neu oder gebraucht kaufen? Wertverlust in Zahlen",
      h1: "Neu oder gebraucht: was ein Motorrad pro Jahr an Wert verliert",
      beschreibung: `Ein Motorrad verliert im Mittel rund ${dez((proJahr * 100).toFixed(1))} % Wert pro Baujahr — ausgewertet aus ${zahl(raten.length)} Preispaaren. Wann sich neu lohnt und wann gebraucht.`,
      held: beispiel,
      fakten: [[`${dez((proJahr * 100).toFixed(1))} %`, "Wertverlust pro Baujahr"], [zahl(raten.length), "ausgewertete Preispaare"]],
      inhalt: `
      <p>Wir haben für alle Modelle im Katalog die Marktpreise nach Baujahr verglichen: ${zahl(raten.length)} Paare aufeinanderfolgender Baujahre. Im Mittel ist ein Motorrad pro Jahr Alter rund <strong>${dez((proJahr * 100).toFixed(1))} %</strong> günstiger als das ein Jahr jüngere Baujahr.</p>
      ${beispiel ? `<h2>Beispiel: ${esc(beispiel.name)}</h2>
      <div class="balken">${bj.map(([y, v]) => `<div class="balken-zeile"><span>${y}</span><div><i style="width:${Math.round((v / bj[0][1]) * 100)}%"></i></div><strong>${euro(v)}</strong></div>`).join("")}</div>` : ""}
      <h2>Wann sich neu lohnt</h2>
      <ul class="punkte">
        <li>Du willst das Motorrad viele Jahre fahren — dann verteilt sich der höhere Preis.</li>
        <li>Garantie, aktuelle Technik (ABS mit Kurvenfunktion, Assistenzsysteme) und bekannte Vorgeschichte sind dir wichtig.</li>
        <li>Es gibt Händleraktionen oder Zulassungsprämien.</li>
      </ul>
      <h2>Wann gebraucht besser ist</h2>
      <ul class="punkte">
        <li>Beim ersten Motorrad: Kleine Umfaller tun weniger weh, und nach dem Aufstieg auf A verkaufst du mit wenig Verlust.</li>
        <li>Wenn das Budget begrenzt ist: Zwei, drei Jahre alte Modelle bieten oft fast dieselbe Technik für deutlich weniger Geld.</li>
        <li>Wenn du ein Modell suchst, das nicht mehr gebaut wird.</li>
      </ul>
      <p>Worauf du beim Gebrauchtkauf achten musst, steht in der <a href="/ratgeber/motorrad-gebraucht-kaufen-checkliste/">Checkliste</a>. Jede Modellseite bei MotoMatch zeigt die Preise nach Baujahr.</p>`,
    });
  }

  // ── 10. Leichte Motorräder ───────────────────────────────────────────
  {
    const leichteste = (f) => bikes.filter((b) => b.weight > 0 && f(b)).sort((a, b) => a.weight - b.weight).slice(0, 3);
    const zeilen = [
      ["A1 / B196", leichteste((b) => b.license === "A1" && b.style !== "Roller")],
      ["A2 (offen)", leichteste((b) => b.license === "A2")],
      ["A2 (gedrosselt)", leichteste((b) => b.license === "A" && b.a2)],
      ["A über 70 PS", leichteste((b) => b.license === "A" && b.ps > 70)],
    ].map(([k, l]) => [k, l.map((b) => `${link(b)} (${b.weight} kg)`).join(", ")]);
    const unter180 = bikes.filter((b) => b.weight > 0 && b.weight <= 180).length;
    liste.push({
      slug: "leichtes-motorrad",
      titel: "Leichtes Motorrad: warum das Gewicht so wichtig ist — die leichtesten Modelle je Klasse",
      h1: "Leichte Motorräder: warum Gewicht zählt",
      beschreibung: `Rangieren, Aufheben, Handlichkeit: warum ein leichtes Motorrad gerade für Einsteiger zählt. ${unter180} Modelle unter 180 kg und die leichtesten je Führerscheinklasse.`,
      held: beliebt(mitFoto(bikes.filter((b) => b.weight > 0 && b.weight <= 180 && b.license !== "A1" && b.style !== "Roller")), 1)[0],
      fakten: [[zahl(unter180), "Modelle unter 180 kg"], ["15–25 kg", "Unterschied trocken/fahrfertig"]],
      inhalt: `
      <p>Auf der Straße merkst du das Gewicht kaum — beim Rangieren, Wenden auf engem Raum oder wenn das Motorrad einmal umfällt, dafür umso mehr. Für Einsteiger und kleinere Fahrer ist ein leichtes Motorrad oft wichtiger als ein paar PS mehr. ${unter180} Modelle in unserem Katalog wiegen fahrfertig höchstens 180 kg.</p>
      <h2>Die leichtesten je Führerscheinklasse</h2>
      ${tabelle(["Klasse", "Leichteste Modelle"], zeilen)}
      ${reihe(beliebt(mitFoto(bikes.filter((b) => b.weight > 0 && b.weight <= 180 && b.license !== "A1")), 4))}
      <h2>Fahrfertig oder trocken?</h2>
      <p>Hersteller geben oft das Trockengewicht an — ohne Benzin, Öl und Batterie. Fahrfertig ist ein Motorrad 15 bis 25 kg schwerer. Vergleiche deshalb immer gleiche Angaben.</p>
      <h2>Weiter stöbern</h2>
      <p>${thema("motorrad-unter-150-kg", "Unter 150 kg")} · ${thema("leichte-motorraeder", "Unter 180 kg")} · ${thema("motorrad-unter-200-kg", "Unter 200 kg")} · ${thema("leichte-a2-motorraeder", "Leichte A2-Motorräder")}</p>`,
    });
  }

  // ── 11. Bestes A2-Motorrad ───────────────────────────────────────────
  {
    const a2alle = bikes.filter((b) => b.style !== "Roller" && (b.license === "A2" || (b.license === "A" && b.a2)));
    const top = beliebt(a2alle, 10);
    // Ohne "Sportbike": der Katalog führt dort auch Naked Bikes (z. B. MT-07) — die Zeile wäre irreführend
    const jeArt = ["Naked", "Enduro", "Klassiker", "Cruiser", "Supermoto"]
      .map((stil) => [stil, beliebt(a2alle.filter((b) => b.style === stil), 1)[0]]).filter(([, b]) => b);
    const mp = mitPreis(a2alle);
    const guenstig = [...mp].sort((a, b) => preis(a) - preis(b)).filter((b) => b.ps >= 30)[0];
    const leicht = a2alle.filter((b) => b.weight > 0 && b.ps >= 30).sort((a, b) => a.weight - b.weight)[0];
    liste.push({
      slug: "bestes-a2-motorrad",
      titel: "Bestes A2-Motorrad 2026: die gefragtesten Modelle im Vergleich",
      h1: "Die besten A2-Motorräder 2026",
      beschreibung: `Die 10 gefragtesten A2-Motorräder mit Preis, PS, Gewicht und Sitzhöhe — plus die beste Wahl je Bauart. Ausgewertet aus ${zahl(a2alle.length)} A2-tauglichen Modellen.`,
      held: mitFoto(top), // Kandidaten: das erste noch nicht vergebene wird Titelbild
      fakten: [[zahl(a2alle.length), "A2-taugliche Modelle"], [euro(median(mp.map(preis))), "mittlerer Gebrauchtpreis"], ["48 PS", "Grenze für A2"]],
      inhalt: `
      <p>„Das beste“ A2-Motorrad gibt es nicht — aber es gibt Modelle, die besonders viele Käufer überzeugen. Wir haben alle ${zahl(a2alle.length)} A2-tauglichen Motorräder aus unserem Katalog nach ihrer Nachfrage auf dem deutschen Gebrauchtmarkt sortiert. Offen A2-taugliche und drosselbare Modelle stehen gemeinsam in der Liste.</p>
      <h2>Die 10 gefragtesten A2-Motorräder</h2>
      ${tabelle(["#", "Modell", "Preis", "PS (offen)", "Gewicht", "Sitzhöhe"], top.map((b, i) => [`${i + 1}`, link(b), preis(b) ? euro(preis(b)) : "–", `${b.ps || "–"}${b.license === "A" ? " · drosselbar" : ""}`, b.weight ? `${b.weight} kg` : "–", b.seat_height ? `${dez(b.seat_height)} cm` : "–"]))}
      ${reihe(mitFoto(top).slice(0, 4))}
      <h2>Die beste Wahl je Bauart</h2>
      ${tabelle(["Bauart", "Gefragtestes A2-Modell", "Preis"], jeArt.map(([stil, b]) => [esc(STIL[stil]?.einzahl || stil), link(b), preis(b) ? euro(preis(b)) : "–"]))}
      <h2>Spartipp und Leichtgewicht</h2>
      <p>${guenstig ? `Am günstigsten mit mindestens 30 PS ist gebraucht die ${link(guenstig)} für rund ${euro(preis(guenstig))}.` : ""} ${leicht ? `Das leichteste A2-Motorrad mit mindestens 30 PS ist die ${link(leicht)} mit ${leicht.weight} kg.` : ""}</p>
      <h2>Offen oder gedrosselt?</h2>
      <p>Offen A2-taugliche Motorräder sind meist leichter und günstiger, gedrosselte haben nach dem Aufstieg auf A mehr Reserven. Mehr dazu im Ratgeber <a href="/ratgeber/a2-drosselung/">A2-Drosselung</a>. Alle Modelle: ${thema("fuehrerschein-a2", "A2-Motorräder")}.</p>`,
    });
  }

  // ── 12. Kleine Fahrer ────────────────────────────────────────────────
  {
    const klein = bikes.filter((b) => b.style !== "Roller" && b.seat_height > 0 && b.seat_height <= 76 && b.weight > 0 && b.weight <= 200);
    const jeKlasse = [["A1 / B196", (b) => b.license === "A1"], ["A2 und A", (b) => b.license !== "A1"]]
      .map(([k, f]) => [k, beliebt(klein.filter(f), 4)]);
    liste.push({
      slug: "motorrad-fuer-kleine-fahrer",
      titel: "Motorrad für kleine Fahrer (unter 1,65 m): niedrig, leicht, sicher",
      h1: "Motorräder für kleine Fahrerinnen und Fahrer",
      beschreibung: `${zahl(klein.length)} Motorräder mit höchstens 76 cm Sitzhöhe und 200 kg — die besten je Führerscheinklasse und Tipps, wie du sicher auf den Boden kommst.`,
      held: mitFoto(beliebt(klein.filter((b) => b.style !== "Cruiser"), 6)),
      fakten: [[zahl(klein.length), "Modelle bis 76 cm und 200 kg"], ["76 cm", "passt ab ca. 1,60 m"]],
      inhalt: `
      <p>Wer kleiner als etwa 1,65 m ist, fragt sich vor allem eins: Komme ich an der Ampel sicher auf den Boden? Zwei Werte entscheiden: die Sitzhöhe — und das Gewicht, denn ein leichtes Motorrad lässt sich auch mit einem Fuß gut halten. Viele Fahrerinnen suchen genau danach; die Auswahl ist größer, als man denkt. ${zahl(klein.length)} Modelle in unserem Katalog haben höchstens 76 cm Sitzhöhe und wiegen höchstens 200 kg.</p>
      ${jeKlasse.map(([k, l]) => l.length ? `<h2>Für Führerschein ${k}</h2>${reihe(mitFoto(l))}` : "").join("\n      ")}
      <h2>So kommst du sicherer auf den Boden</h2>
      <ul class="punkte">
        <li>Viele Hersteller bieten eine Niedrigsitzbank oder eine Tieferlegung ab Werk an — frag beim Händler nach.</li>
        <li>Eine schmale Sitzbank zählt fast so viel wie die Höhe: Die Beine gehen gerader nach unten.</li>
        <li>An der Ampel reicht oft ein Fuß sicher auf dem Boden — dafür vorher leicht zur Seite rutschen.</li>
        <li>Motorradstiefel mit etwas dickerer Sohle bringen ein bis zwei Zentimeter.</li>
      </ul>
      <p>Wie viel Sitzhöhe zu deiner Größe passt, zeigt die Tabelle im Ratgeber <a href="/ratgeber/sitzhoehe-koerpergroesse/">Sitzhöhe und Körpergröße</a>. Nach Größe sortiert: ${thema("motorrad-fuer-155-cm", "1,55 m")} · ${thema("motorrad-fuer-160-cm", "1,60 m")} · ${thema("motorrad-fuer-165-cm", "1,65 m")}.</p>`,
    });
  }

  // ── 13. Erste Ausrüstung ─────────────────────────────────────────────
  if (h.ausruestung?.length) {
    // Nur die Grundausstattung zählen: kein Regenzeug, keine MX-Trikots, keine Jeans unter "Helm"
    const KAT = [["helmet", "Helm", /helm/i, "ECE 22.06"], ["jacket", "Jacke", /^(?!.*regen)(?!.*jersey).*(jacke|kombi)/i, "EN 17092"], ["pants", "Hose", /^(?!.*regen).*(hose|jeans)/i, "EN 17092"], ["gloves", "Handschuhe", /handschuh/i, "EN 13594"], ["boots", "Stiefel", /stiefel/i, "EN 13634"], ["backprotector", "Rückenprotektor", null, "EN 1621-2"]];
    const mitte = (x) => (x.priceMin + x.priceMax) / 2;
    const zeilen = KAT.map(([k, name, filter, norm]) => {
      const l = h.ausruestung.filter((x) => x.k === k && (!filter || filter.test(x.type))).map(mitte).sort((a, b) => a - b);
      return { name, norm, einstieg: l[Math.floor(l.length * 0.25)] || 0, mittel: median(l), n: l.length };
    });
    const summe = (f) => Math.round(zeilen.reduce((a, z) => a + z[f], 0) / 10) * 10;
    const beispiele = KAT.slice(0, 5).map(([k, , filter]) => h.ausruestung.filter((x) => x.k === k && x.image && (!filter || filter.test(x.type))).sort((a, b) => mitte(a) - mitte(b))).map((l) => l[Math.floor(l.length / 2)]).filter(Boolean);
    liste.push({
      slug: "erste-motorradausruestung",
      titel: "Erste Motorradausrüstung: was du brauchst und was sie kostet",
      h1: "Die erste Motorradausrüstung: Liste und Kosten",
      beschreibung: `Helm, Jacke, Hose, Handschuhe, Stiefel, Protektor: Was du brauchst, worauf du achtest und was es kostet — ab rund ${euro(summe("einstieg"))} für die Grundausstattung, ausgewertet aus ${zahl(h.ausruestung.length)} Produkten.`,
      held: beliebt(mitFoto(bikes.filter((b) => b.style === "Touring")), 8),
      fakten: [[euro(summe("einstieg")), "Grundausstattung Einstieg"], [euro(summe("mittel")), "solide Mittelklasse"], [zahl(h.ausruestung.length), "Produkte ausgewertet"]],
      checkliste: true,
      inhalt: `
      <p>Vorgeschrieben ist in Deutschland nur der Helm. Alles andere ist freiwillig — und trotzdem sinnvoll: Bei einem Sturz rutschst du ohne Schutzkleidung über Asphalt. Die Preise unten stammen aus ${zahl(h.ausruestung.length)} Produkten aus unserem Ausrüstungs-Bereich: „Einstieg“ ist das günstigere Viertel, „Mittelklasse“ der typische Preis.</p>
      <h2>Was es kostet</h2>
      ${tabelle(["Teil", "Einstieg", "Mittelklasse", "Prüfnorm"], [...zeilen.map((z) => [z.name, euro(Math.round(z.einstieg / 5) * 5), euro(Math.round(z.mittel / 5) * 5), z.norm]), ["<strong>Zusammen</strong>", `<strong>${euro(summe("einstieg"))}</strong>`, `<strong>${euro(summe("mittel"))}</strong>`, ""]])}
      <h2>Die Liste</h2>
      <ul class="punkte">
        <li><strong>Helm</strong> — Pflicht. Achte auf die Prüfnorm ECE 22.06. Integralhelme schützen das Kinn, Klapphelme sind bequemer auf Tour.</li>
        <li><strong>Jacke und Hose</strong> — Textil oder Leder, mit Protektoren an Schultern, Ellbogen, Hüfte und Knien. Die Norm EN 17092 zeigt die Schutzklasse (AAA am höchsten, A am niedrigsten).</li>
        <li><strong>Handschuhe</strong> — die Hände berühren beim Sturz zuerst den Boden. Norm EN 13594.</li>
        <li><strong>Stiefel</strong> — fester Knöchelschutz statt Sneaker. Norm EN 13634.</li>
        <li><strong>Rückenprotektor</strong> — oft als Einsatz in der Jacke; Level 2 schützt mehr als Level 1 (EN 1621-2).</li>
      </ul>
      <h2>Beispiele aus dem Ausrüstungs-Bereich</h2>
      <ul class="raster mini">${beispiele.map((x) => `<li class="karte"><span class="g">${x.image ? `<img src="${esc(x.image)}" alt="${esc(x.name)}" loading="lazy" width="420" height="300" />` : ""}<strong>${esc(x.name)}</strong><span class="preis">${x.priceMin === x.priceMax ? euro(x.priceMin) : `${euro(x.priceMin)}–${euro(x.priceMax)}`}</span><span class="info">${esc(x.type)}</span></span></li>`).join("")}</ul>
      <h2>Spartipps</h2>
      <ul class="punkte">
        <li>Beim Helm nicht sparen und ihn nie gebraucht kaufen — einem Helm sieht man einen früheren Sturz nicht an.</li>
        <li>Jacken und Hosen vom Vorjahr gibt es oft deutlich günstiger.</li>
        <li>Anprobieren: Protektoren müssen auch in Sitzposition an der richtigen Stelle sitzen.</li>
      </ul>
      <p>Passend zu deinem Motorrad zeigt MotoMatch im Reiter „Ausrüstung“ Helme, Jacken und mehr für jede Bauart.</p>`,
    });
  }

  // ── 14. Versicherung ─────────────────────────────────────────────────
  {
    const kw = (b) => b.kw || (b.ps ? b.ps * 0.7355 : 0);
    const stufen = [["bis 11 kW (A1)", (x) => x <= 11], ["11–35 kW (A2)", (x) => x > 11 && x <= 35], ["35–70 kW", (x) => x > 35 && x <= 70], ["über 70 kW", (x) => x > 70]]
      .map(([n, f]) => [n, zahl(bikes.filter((b) => kw(b) > 0 && f(kw(b))).length)]);
    liste.push({
      slug: "motorradversicherung",
      titel: "Motorradversicherung: wovon der Beitrag abhängt und wie du sparst",
      h1: "Motorradversicherung: Haftpflicht, Teilkasko, Vollkasko",
      beschreibung: "Welche Versicherung brauchst du fürs Motorrad, wovon hängt der Beitrag ab und wie sparst du? Leistung, Alter, Schadenfreiheitsklasse, Saisonkennzeichen — verständlich erklärt.",
      held: beliebt(mitFoto(bikes.filter((b) => b.style === "Sportbike")), 8),
      fakten: [["Pflicht", "Haftpflicht"], ["eVB", "Nummer für die Zulassung"], ["Saison", "spart Beitrag"]],
      inhalt: `
      <p>Ohne Versicherung darf kein Motorrad auf die Straße. Bevor du es zulassen kannst, brauchst du eine eVB-Nummer (elektronische Versicherungsbestätigung) — die bekommst du vom Versicherer, sobald du einen Vertrag abschließt.</p>
      <h2>Haftpflicht, Teilkasko, Vollkasko</h2>
      ${tabelle(["Art", "Was sie zahlt", "Für wen"], [["Haftpflicht", "Schäden, die du anderen zufügst", "Pflicht für alle"], ["Teilkasko", "zusätzlich z. B. Diebstahl, Brand, Sturm, Wildunfall", "neuere und gebrauchte Motorräder mit Wert"], ["Vollkasko", "zusätzlich Schäden am eigenen Motorrad, auch selbst verschuldet", "neue oder teure Motorräder, Finanzierung"]])}
      <h2>Wovon der Beitrag abhängt</h2>
      <ul class="punkte">
        <li><strong>Leistung und Hubraum</strong> — stärkere Motorräder kosten in der Regel mehr.</li>
        <li><strong>Alter und Erfahrung</strong> — junge Fahrer und Führerscheinneulinge zahlen meist mehr.</li>
        <li><strong>Schadenfreiheitsklasse</strong> — je länger unfallfrei, desto günstiger. Manche Versicherer rechnen Jahre vom Auto teilweise an; frag danach.</li>
        <li><strong>Wohnort</strong> — die Region beeinflusst den Beitrag.</li>
        <li><strong>Abstellort und Fahrerkreis</strong> — Garage und ein kleiner Fahrerkreis senken den Preis oft.</li>
      </ul>
      <h2>Wie stark sind die Motorräder im Katalog?</h2>
      ${tabelle(["Leistung", "Modelle"], stufen)}
      <h2>So sparst du</h2>
      <ul class="punkte">
        <li><strong>Saisonkennzeichen:</strong> Du zahlst Versicherung und Steuer nur für die Monate, in denen du fährst. Außerhalb der Saison bleibt das abgestellte Motorrad in der Regel weiter gegen Diebstahl und Brand versichert, wenn es auf privatem Grund steht.</li>
        <li><strong>Vergleichen</strong> — vor dem Kauf, nicht erst bei der Zulassung. Der Beitrag kann je nach Modell deutlich schwanken.</li>
        <li><strong>Selbstbeteiligung</strong> in Teil- und Vollkasko senkt den Beitrag.</li>
      </ul>
      <p>Kosten außer der Versicherung: <a href="/ratgeber/motorradsteuer/">Motorradsteuer</a> · <a href="/ratgeber/erste-motorradausruestung/">Ausrüstung</a>.</p>`,
    });
  }

  // ── 15. Überwintern ──────────────────────────────────────────────────
  {
    const steuern = bikes.filter((b) => b.cc > 0).map((b) => Math.ceil(b.cc / 25) * 1.84);
    const ersparnis = median(steuern) * 4 / 12;
    liste.push({
      slug: "motorrad-ueberwintern",
      titel: "Motorrad überwintern: Checkliste für Batterie, Tank, Reifen und Kette",
      h1: "Motorrad richtig überwintern",
      beschreibung: "Waschen, Ölwechsel, Batterie, Tank, Reifen, Kette, Abdeckung: die Checkliste fürs Einwintern — und was du im Frühjahr prüfen solltest.",
      held: beliebt(mitFoto(bikes.filter((b) => b.style === "Klassiker")), 8),
      fakten: [["7", "Schritte zum Einwintern"], [`${dez(ersparnis.toFixed(2))} €`, "Steuer gespart (4 Monate, Mittel)"]],
      checkliste: true,
      inhalt: `
      <p>Monatelang stehen ist für ein Motorrad Stress: Die Batterie entlädt sich, Kondenswasser lässt Teile rosten, Reifen bekommen Standplatten. Mit dieser Checkliste startet es im Frühjahr ohne Ärger.</p>
      <h2>Die Checkliste</h2>
      <ul class="punkte">
        <li><strong>Gründlich waschen und trocknen</strong> — Salz und Schmutz greifen den Lack und blanke Teile an.</li>
        <li><strong>Ölwechsel vor dem Einwintern</strong> — altes Öl enthält Säuren, die im Stand den Motor angreifen können.</li>
        <li><strong>Tank voll machen</strong> — ein voller Tank rostet innen nicht. Bei Vergasermotoren die Schwimmerkammer leeren.</li>
        <li><strong>Batterie</strong> — ausbauen und kühl, aber frostfrei lagern, oder ein Erhaltungsladegerät anschließen.</li>
        <li><strong>Reifen</strong> — Luftdruck etwas erhöhen oder das Motorrad auf den Montageständer stellen, gegen Standplatten.</li>
        <li><strong>Kette</strong> — reinigen und schmieren; blanke Teile mit Pflegemittel einsprühen.</li>
        <li><strong>Trocken abstellen</strong> — unter einer atmungsaktiven Plane. Luftdichte Folie hält Feuchtigkeit fest.</li>
      </ul>
      <h2>Saisonkennzeichen</h2>
      <p>Mit einem Saisonkennzeichen, zum Beispiel von März bis Oktober, zahlst du Steuer und Versicherung nur für diese Monate. Bei der Steuer sind das im Mittel unseres Katalogs rund ${dez(ersparnis.toFixed(2))} € weniger im Jahr — bei der Versicherung meist deutlich mehr. Siehe <a href="/ratgeber/motorradsteuer/">Motorradsteuer</a> und <a href="/ratgeber/motorradversicherung/">Versicherung</a>.</p>
      <h2>Im Frühjahr</h2>
      <ul class="punkte">
        <li>Batterie laden und einbauen, Reifendruck auf Normalwert.</li>
        <li>Bremsen prüfen: Beläge, Flüssigkeit, Druckpunkt.</li>
        <li>Licht, Hupe und Blinker testen, Kette spannen und schmieren.</li>
        <li>Die ersten Kilometer vorsichtig fahren — Reifen und Fahrer sind aus der Übung.</li>
      </ul>`,
    });
  }

  return liste;
}
