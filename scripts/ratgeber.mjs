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
 * held = Bike fürs Titelbild, fakten = [[Zahl, Erklärung]] für "Auf einen Blick".
 */

export function artikel(h) {
  const { bikes, preis, zahl, dez, darfA2, bikePfad, themaPfad, esc, STIL, karte, hatFoto } = h;
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
      held: beliebt(mitFoto(a2gedrosselt), 1)[0],
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
      held: beliebt(mitFoto(leichtEinst), 1)[0],
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
      held: beliebt(mitFoto(bikes.filter((b) => b.style === "Enduro")), 1)[0],
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
      held: beliebt(mitFoto(bikes.filter((b) => b.weight > 0 && b.weight <= 180 && b.license !== "A1")), 1)[0],
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

  return liste;
}
