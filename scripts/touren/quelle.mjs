/* Tourensammlung von MotoMatch — eigene Auswahl, keine Übernahme aus fremden
   Tourendatenbanken (Calimoto, Kurviger, MotoPlaner u. a. sind geschützt).

   Jede Tour ist nur eine Folge von Wegpunkten. Die Strecke dazwischen berechnet
   scripts/touren/bauen.mjs über OpenStreetMap (OSRM), Höhen kommen von
   Open-Meteo. Wer eine Tour ändert: Wegpunkte anpassen, `node scripts/touren/bauen.mjs`
   laufen lassen, die Warnungen (Autobahnanteil, Sprünge) lesen.

   Wegpunkt-Schreibweisen:
     'Winterberg'                  → Nominatim-Suche "Winterberg, Deutschland"
     'Lichtenstein|Württemberg'    → Zusatz für eindeutige Treffer
     ['Roßfeld', 47.6493, 13.0388] → feste Koordinate (Pässe, Aussichtspunkte)

   typ: 'rund' (Start = Ziel, der erste Punkt wird hinten angehängt)
        'strecke' (Panorama- oder Ferienstraße von A nach B) */

export const TOUREN = [
  // ── Teutoburger Wald, Lippe, Weserbergland ────────────────────────────
  {
    id: 'teuto-kamm', name: 'Teutoburger Wald: Kammrunde ab Bielefeld', region: 'Teutoburger Wald', typ: 'rund',
    text: 'Über die Pässe des Teutos zwischen Bielefeld und Bad Iburg, zurück durch das Ravensberger Hügelland. Kurz genug für einen Feierabend.',
    tags: ['Kurven', 'Wald'],
    wp: ['Bielefeld', 'Halle (Westf.)', 'Borgholzhausen', 'Dissen am Teutoburger Wald', 'Bad Iburg', 'Hilter am Teutoburger Wald', 'Melle', 'Spenge'],
  },
  {
    id: 'lippe-bergland', name: 'Lippisches Bergland & Externsteine', region: 'Teutoburger Wald', typ: 'rund',
    text: 'Von Detmold an den Externsteinen vorbei ins Eggegebirge, durch das Emmertal nach Bad Pyrmont und über die Höhen des Extertals zurück.',
    tags: ['Kurven', 'Aussicht'],
    wp: ['Detmold', 'Horn-Bad Meinberg', 'Bad Driburg', 'Schieder-Schwalenberg', 'Lügde', 'Bad Pyrmont', 'Barntrup', 'Extertal', 'Lemgo'],
  },
  {
    id: 'egge-sintfeld', name: 'Eggegebirge & Diemeltal', region: 'Paderborner Land', typ: 'rund',
    text: 'Schnelle Landstraßen über die Paderborner Hochfläche, dazu die kurvigen Abschnitte im Eggegebirge und im Diemeltal bei Marsberg.',
    tags: ['Kurven', 'Landstraße'],
    wp: ['Paderborn', 'Altenbeken', 'Bad Driburg', 'Willebadessen', 'Warburg', 'Marsberg', 'Bad Wünnenberg', 'Büren'],
  },
  {
    id: 'weserbergland', name: 'Weserbergland: Hameln – Höxter – Solling', region: 'Weserbergland', typ: 'rund',
    text: 'Am Fluss entlang nach Süden bis Bad Karlshafen, dann durch den Solling und über die Höhen bei Einbeck zurück an die Weser.',
    tags: ['Fluss', 'Wald', 'Kurven'],
    wp: ['Hameln', 'Bodenwerder', 'Holzminden', 'Höxter', 'Beverungen', 'Bad Karlshafen', 'Uslar', 'Dassel', 'Einbeck', 'Eschershausen'],
  },
  {
    id: 'wiehengebirge', name: 'Wiehengebirge & Porta Westfalica', region: 'Mühlenkreis', typ: 'rund',
    text: 'Entlang des Wiehengebirges von Minden bis ins Osnabrücker Land, zurück durch das Else-Tal und zur Porta Westfalica.',
    tags: ['Wald', 'Landstraße'],
    wp: ['Minden', 'Hüllhorst', 'Lübbecke', 'Preußisch Oldendorf', 'Bad Essen', 'Melle', 'Bünde', 'Bad Oeynhausen', 'Porta Westfalica'],
  },
  {
    id: 'reinhardswald', name: 'Reinhardswald & Oberweser', region: 'Weserbergland', typ: 'rund',
    text: 'Das enge Wesertal zwischen Hann. Münden und Bad Karlshafen, zurück durch den Reinhardswald über Trendelburg und Hofgeismar.',
    tags: ['Fluss', 'Wald', 'Kurven'],
    wp: ['Hann. Münden', 'Gieselwerder', 'Bad Karlshafen', 'Trendelburg', 'Hofgeismar', 'Grebenstein'],
  },
  {
    id: 'deister-suentel', name: 'Deister & Süntel', region: 'Calenberger Land', typ: 'rund',
    text: 'Die Hausstrecke vieler Hannoveraner: zweimal über den Deister, dazu der Süntel bei Hessisch Oldendorf.',
    tags: ['Kurven', 'Wald'],
    wp: ['Barsinghausen', 'Bad Nenndorf', 'Rodenberg', 'Hessisch Oldendorf', 'Bad Münder am Deister', 'Springe'],
  },

  // ── Sauerland, Siegerland, Bergisches Land ────────────────────────────
  {
    id: 'hochsauerland', name: 'Hochsauerland: Winterberg & Willingen', region: 'Sauerland', typ: 'rund',
    text: 'Die klassische Runde durch das Hochsauerland: über Brilon nach Willingen, zum Kahlen Asten bei Winterberg und durch das Lennetal zurück.',
    tags: ['Kurven', 'Aussicht', 'Wald'],
    wp: ['Meschede', 'Bestwig', 'Olsberg', 'Brilon', 'Willingen (Upland)', 'Winterberg', 'Schmallenberg', 'Eslohe (Sauerland)'],
  },
  {
    id: 'sorpe-lenne', name: 'Sorpesee, Hönnetal & Lennetal', region: 'Sauerland', typ: 'rund',
    text: 'Vom Sorpesee durch das Hönnetal bei Balve, über Neuenrade ins Lennetal und über Eslohe zurück nach Arnsberg.',
    tags: ['Seen', 'Kurven'],
    wp: ['Arnsberg', 'Sundern (Sauerland)', 'Balve', 'Neuenrade', 'Plettenberg', 'Finnentrop', 'Eslohe (Sauerland)', 'Meschede'],
  },
  {
    id: 'bigge-rothaar', name: 'Biggesee & Rothaargebirge', region: 'Sauerland', typ: 'rund',
    text: 'Rund um den Biggesee, durch Lennestadt und Kirchhundem hinauf ins Rothaargebirge und über Kreuztal zurück nach Olpe.',
    tags: ['Seen', 'Kurven', 'Wald'],
    wp: ['Olpe', 'Attendorn', 'Finnentrop', 'Lennestadt', 'Kirchhundem', 'Hilchenbach', 'Kreuztal', 'Wenden'],
  },
  {
    id: 'maerkisches-sauerland', name: 'Märkisches Sauerland', region: 'Sauerland', typ: 'rund',
    text: 'Kurze, kurvenreiche Runde am Rand des Ruhrgebiets: Breckerfeld, Halver, Lüdenscheid und das Lennetal bei Altena.',
    tags: ['Kurven'],
    wp: ['Hagen', 'Breckerfeld', 'Halver', 'Lüdenscheid', 'Altena', 'Iserlohn'],
  },
  {
    id: 'wittgenstein', name: 'Wittgensteiner Land', region: 'Siegerland-Wittgenstein', typ: 'rund',
    text: 'Einsame Waldstraßen im Rothaargebirge zwischen Bad Berleburg, Bad Laasphe und Schmallenberg — wenig Verkehr, viele Kurven.',
    tags: ['Kurven', 'Wald'],
    wp: ['Bad Berleburg', 'Bad Laasphe', 'Erndtebrück', 'Hilchenbach', 'Schmallenberg'],
  },
  {
    id: 'bergische-talsperren', name: 'Bergische Talsperren', region: 'Bergisches Land', typ: 'rund',
    text: 'Von Remscheid an Wupper-, Bever- und Brucher Talsperre vorbei, über Lindlar und Engelskirchen durch das Aggertal zurück.',
    tags: ['Seen', 'Kurven'],
    wp: ['Remscheid', 'Hückeswagen', 'Wipperfürth', 'Lindlar', 'Engelskirchen', 'Overath', 'Kürten', 'Wermelskirchen'],
  },

  // ── Eifel, Ahr, Mosel, Hunsrück, Saar ─────────────────────────────────
  {
    id: 'nuerburgring-runde', name: 'Rund um den Nürburgring', region: 'Eifel', typ: 'rund',
    text: 'Die Landstraßen rund um die Nordschleife: über Kelberg nach Daun, durch die Hocheifel nach Blankenheim und über das Ahrtal zurück nach Adenau.',
    tags: ['Kurven', 'Aussicht'],
    wp: ['Adenau', 'Nürburg', 'Kelberg', 'Daun', 'Hillesheim', 'Blankenheim (Ahr)', 'Schuld'],
  },
  {
    id: 'ahrtal-hoheacht', name: 'Ahrtal, Hohe Acht & Laacher See', region: 'Eifel', typ: 'rund',
    text: 'Durch das enge Ahrtal nach Altenahr, über die Hohe Acht nach Mayen und am Laacher See vorbei zurück nach Ahrweiler.',
    tags: ['Kurven', 'Fluss', 'Seen'],
    wp: ['Bad Neuenahr-Ahrweiler', 'Altenahr', 'Adenau', 'Virneburg', 'Mayen', 'Mendig', 'Niederzissen'],
  },
  {
    id: 'vulkaneifel', name: 'Vulkaneifel & Maare', region: 'Eifel', typ: 'rund',
    text: 'Zu den Maaren bei Daun und Gillenfeld, ins Liesertal nach Manderscheid und über Bad Bertrich und Ulmen zurück.',
    tags: ['Seen', 'Kurven'],
    wp: ['Daun', 'Gillenfeld', 'Manderscheid', 'Bad Bertrich', 'Lutzerath', 'Ulmen'],
  },
  {
    id: 'rureifel', name: 'Rureifel & Rursee', region: 'Eifel', typ: 'rund',
    text: 'Von Monschau über die Höhen an den Rursee, durch das Rurtal nach Nideggen und über Schleiden und Hellenthal zurück.',
    tags: ['Seen', 'Kurven', 'Wald'],
    wp: ['Monschau', 'Simmerath', 'Heimbach (Eifel)', 'Nideggen', 'Schleiden', 'Hellenthal'],
  },
  {
    id: 'moselschleifen', name: 'Moselschleifen & Hunsrück', region: 'Mosel', typ: 'rund',
    text: 'Am Fluss entlang von Cochem bis Bernkastel-Kues, dann hinauf in den Hunsrück und über Kastellaun zurück an die Mosel.',
    tags: ['Fluss', 'Kurven', 'Wein'],
    wp: ['Cochem', 'Zell (Mosel)', 'Traben-Trarbach', 'Bernkastel-Kues', 'Morbach', 'Kirchberg (Hunsrück)', 'Kastellaun'],
  },
  {
    id: 'hunsrueckhoehenstrasse', name: 'Hunsrückhöhenstraße', region: 'Hunsrück', typ: 'strecke',
    text: 'Die alte Ferienstraße über den Kamm des Hunsrücks, vom Rhein bei Koblenz bis an die Saar. Lange Geraden, weite Blicke, wenig Ortsdurchfahrten.',
    tags: ['Ferienstraße', 'Aussicht'],
    wp: ['Koblenz', 'Emmelshausen', 'Kastellaun', 'Kirchberg (Hunsrück)', 'Morbach', 'Thalfang', 'Hermeskeil', 'Saarburg'],
  },
  {
    id: 'saarschleife', name: 'Saarschleife & Hochwald', region: 'Saarland', typ: 'rund',
    text: 'Von Mettlach zur Saarschleife, über Losheim am See und Wadern in den Hochwald und durch das Saartal zurück.',
    tags: ['Fluss', 'Seen', 'Kurven'],
    wp: ['Mettlach', 'Orscholz', 'Merzig', 'Losheim am See', 'Wadern', 'Nonnweiler', 'Hermeskeil', 'Saarburg'],
  },

  // ── Rhein, Taunus, Westerwald, Hessen ─────────────────────────────────
  {
    id: 'mittelrhein', name: 'Mittelrhein & Loreley', region: 'Mittelrhein', typ: 'rund',
    text: 'Links des Rheins nach Bingen, über Mainz und Wiesbaden durch den Rheingau und rechtsrheinisch an der Loreley vorbei zurück nach Koblenz.',
    tags: ['Fluss', 'Burgen', 'Wein'],
    wp: ['Koblenz', 'Boppard', 'St. Goar', 'Bacharach', 'Bingen am Rhein', 'Mainz', 'Eltville am Rhein', 'Rüdesheim am Rhein', 'Kaub', 'St. Goarshausen', 'Braubach', 'Lahnstein'],
  },
  {
    id: 'hochtaunus', name: 'Hochtaunus & Großer Feldberg', region: 'Taunus', typ: 'rund',
    text: 'Die Frankfurter Hausrunde: über den Feldberg nach Idstein, durch das Weiltal nach Usingen und über die Saalburg zurück.',
    tags: ['Kurven', 'Wald', 'Aussicht'],
    wp: ['Bad Homburg vor der Höhe', 'Oberursel (Taunus)', 'Königstein im Taunus', 'Glashütten|Hochtaunuskreis', 'Idstein', 'Weilrod', 'Usingen'],
  },
  {
    id: 'lahn-westerwald', name: 'Lahntal & Westerwald', region: 'Westerwald', typ: 'rund',
    text: 'Durch das Lahntal von Limburg bis Bad Ems, hinauf in den Westerwald nach Montabaur und Westerburg und über Hadamar zurück.',
    tags: ['Fluss', 'Kurven'],
    wp: ['Limburg an der Lahn', 'Diez', 'Nassau (Lahn)', 'Bad Ems', 'Montabaur', 'Westerburg', 'Hadamar'],
  },
  {
    id: 'vogelsberg', name: 'Vogelsberg & Hoherodskopf', region: 'Vogelsberg', typ: 'rund',
    text: 'Rund um den alten Vulkan: über den Hoherodskopf nach Ulrichstein, durch Herbstein und Lauterbach und über Grebenhain zurück.',
    tags: ['Kurven', 'Aussicht'],
    wp: ['Schotten', 'Ulrichstein', 'Herbstein', 'Lauterbach (Hessen)', 'Grebenhain', 'Gedern'],
  },
  {
    id: 'rhoen', name: 'Rhön: Wasserkuppe & Hochrhönstraße', region: 'Rhön', typ: 'rund',
    text: 'Von Fulda über Gersfeld in die Hochrhön, nach Bischofsheim und Fladungen und über Tann und die Wasserkuppe zurück.',
    tags: ['Aussicht', 'Kurven'],
    wp: ['Fulda', 'Gersfeld (Rhön)', 'Bischofsheim in der Rhön', 'Fladungen', 'Tann (Rhön)', 'Hilders', ['Wasserkuppe', 50.4987, 9.9387], 'Poppenhausen (Wasserkuppe)'],
  },
  {
    id: 'kellerwald-edersee', name: 'Edersee & Kellerwald', region: 'Nordhessen', typ: 'rund',
    text: 'Rund um den Edersee und durch den Nationalpark Kellerwald — kurvige Uferstraßen und ruhige Waldstrecken.',
    tags: ['Seen', 'Kurven', 'Wald'],
    wp: ['Waldeck|Waldeck-Frankenberg', 'Vöhl', 'Frankenberg (Eder)', 'Frankenau', 'Bad Wildungen', 'Edertal'],
  },
  {
    id: 'meissner-werra', name: 'Hoher Meißner & Werratal', region: 'Nordhessen', typ: 'rund',
    text: 'Über den Hohen Meißner nach Hessisch Lichtenau, durch das Werratal bei Eschwege und Bad Sooden-Allendorf zurück nach Witzenhausen.',
    tags: ['Kurven', 'Fluss', 'Aussicht'],
    wp: ['Witzenhausen', ['Hoher Meißner', 51.2246, 9.8566], 'Hessisch Lichtenau', 'Eschwege', 'Bad Sooden-Allendorf'],
  },
  {
    id: 'spessart', name: 'Spessart-Runde', region: 'Spessart', typ: 'rund',
    text: 'Waldstraßen durch den Spessart: von Lohr über Frammersbach und Heigenbrücken zum Wasserschloss Mespelbrunn und zurück an den Main.',
    tags: ['Wald', 'Kurven'],
    wp: ['Lohr am Main', 'Frammersbach', 'Wiesen|Landkreis Aschaffenburg', 'Heigenbrücken', 'Mespelbrunn', 'Marktheidenfeld'],
  },
  {
    id: 'odenwald', name: 'Odenwald: Neckartal & Mümlingtal', region: 'Odenwald', typ: 'rund',
    text: 'Von Michelstadt über Beerfelden hinunter ins Neckartal nach Hirschhorn und Eberbach, über die Höhen bei Mudau nach Amorbach.',
    tags: ['Kurven', 'Fluss', 'Burgen'],
    wp: ['Michelstadt', 'Beerfelden', 'Hirschhorn (Neckar)', 'Eberbach', 'Mudau', 'Amorbach'],
  },
  {
    id: 'bergstrasse', name: 'Bergstraße', region: 'Bergstraße', typ: 'strecke',
    text: 'Die Ferienstraße am Westrand des Odenwalds von Darmstadt nach Heidelberg, durch Weinorte und an Burgen vorbei.',
    tags: ['Ferienstraße', 'Wein', 'Burgen'],
    wp: ['Darmstadt', 'Zwingenberg|Hessen', 'Bensheim', 'Heppenheim', 'Weinheim', 'Schriesheim', 'Heidelberg'],
  },
  {
    id: 'burgenstrasse-neckar', name: 'Burgenstraße im Neckartal', region: 'Neckartal', typ: 'strecke',
    text: 'Der westliche Teil der Burgenstraße: von Heidelberg den Neckar hinauf bis Heilbronn, vorbei an einem Dutzend Burgen.',
    tags: ['Ferienstraße', 'Fluss', 'Burgen'],
    wp: ['Heidelberg', 'Neckargemünd', 'Hirschhorn (Neckar)', 'Eberbach', 'Mosbach', 'Bad Wimpfen', 'Heilbronn'],
  },

  // ── Pfalz ──────────────────────────────────────────────────────────────
  {
    id: 'pfaelzerwald', name: 'Pfälzerwald: Elmsteiner Tal & Johanniskreuz', region: 'Pfalz', typ: 'rund',
    text: 'Das Motorrad-Herz der Pfalz: durch das Elmsteiner Tal nach Johanniskreuz, über Hauenstein nach Annweiler und an der Weinstraße zurück.',
    tags: ['Kurven', 'Wald'],
    wp: ['Neustadt an der Weinstraße', 'Lambrecht (Pfalz)', 'Elmstein', ['Johanniskreuz', 49.3409, 7.8355], 'Hauenstein', 'Annweiler am Trifels', 'Edenkoben'],
  },
  {
    id: 'deutsche-weinstrasse', name: 'Deutsche Weinstraße', region: 'Pfalz', typ: 'strecke',
    text: 'Die älteste Ferienstraße Deutschlands: 85 Kilometer von Bockenheim bis zum Deutschen Weintor in Schweigen, immer am Haardtrand entlang.',
    tags: ['Ferienstraße', 'Wein'],
    wp: ['Bockenheim an der Weinstraße', 'Grünstadt', 'Bad Dürkheim', 'Deidesheim', 'Neustadt an der Weinstraße', 'Maikammer', 'Edenkoben', 'Bad Bergzabern', 'Schweigen-Rechtenbach'],
  },
  {
    id: 'dahner-felsenland', name: 'Dahner Felsenland & Südpfalz', region: 'Pfalz', typ: 'rund',
    text: 'Zwischen Sandsteinfelsen und Burgruinen: Dahn, Hauenstein, Annweiler und die engen Straßen an der französischen Grenze.',
    tags: ['Kurven', 'Burgen'],
    wp: ['Dahn', 'Hauenstein', 'Annweiler am Trifels', 'Bad Bergzabern', 'Schönau (Pfalz)', 'Fischbach bei Dahn'],
  },

  // ── Schwarzwald, Schwäbische Alb, Bodensee ────────────────────────────
  {
    id: 'schwarzwaldhochstrasse', name: 'Schwarzwaldhochstraße B500', region: 'Schwarzwald', typ: 'strecke',
    text: 'Die bekannteste Panoramastraße des Schwarzwalds: von Baden-Baden über Mummelsee und Ruhestein nach Freudenstadt, fast durchgehend über 900 Meter.',
    tags: ['Ferienstraße', 'Aussicht', 'Kurven'],
    wp: ['Baden-Baden', ['Bühlerhöhe', 48.6747, 8.2236], ['Mummelsee', 48.5986, 8.2006], ['Ruhestein', 48.5605, 8.2297], 'Freudenstadt'],
  },
  {
    id: 'schwarzwald-taelerstrasse', name: 'Schwarzwald-Tälerstraße', region: 'Schwarzwald', typ: 'strecke',
    text: 'Durch das Murgtal von Rastatt über Gernsbach und Forbach nach Baiersbronn und Freudenstadt, weiter bis Alpirsbach.',
    tags: ['Ferienstraße', 'Fluss', 'Kurven'],
    wp: ['Rastatt', 'Gernsbach', 'Forbach (Baden)', 'Baiersbronn', 'Freudenstadt', 'Alpirsbach'],
  },
  {
    id: 'nordschwarzwald', name: 'Nordschwarzwald: Dobel & Enztal', region: 'Schwarzwald', typ: 'rund',
    text: 'Von Gernsbach über Bad Herrenalb und Dobel ins Enztal, durch Bad Wildbad und Enzklösterle und über Besenfeld zurück ins Murgtal.',
    tags: ['Kurven', 'Wald'],
    wp: ['Gernsbach', 'Bad Herrenalb', 'Dobel', 'Bad Wildbad', 'Enzklösterle', 'Besenfeld', 'Forbach (Baden)'],
  },
  {
    id: 'mittlerer-schwarzwald', name: 'Kinzigtal, Triberg & Simonswald', region: 'Schwarzwald', typ: 'rund',
    text: 'Durch das Gutachtal nach Triberg, über Furtwangen ins Simonswälder Tal und über Elzach zurück ins Kinzigtal.',
    tags: ['Kurven', 'Wald'],
    wp: ['Wolfach', 'Hausach', 'Hornberg', 'Triberg im Schwarzwald', 'Schonach im Schwarzwald', 'Furtwangen im Schwarzwald', 'Simonswald', 'Elzach', 'Haslach im Kinzigtal'],
  },
  {
    id: 'schauinsland-feldberg', name: 'Schauinsland & Feldberg', region: 'Schwarzwald', typ: 'rund',
    text: 'Die alte Bergrennstrecke auf den Schauinsland, über Todtnau zum Feldberg, am Titisee vorbei und durch das Höllental zurück nach Freiburg.',
    tags: ['Kurven', 'Aussicht', 'Seen'],
    wp: ['Freiburg im Breisgau', ['Schauinsland', 47.9113, 7.8987], 'Todtnau', 'Feldberg (Schwarzwald)', 'Titisee-Neustadt', 'Hinterzarten', 'Kirchzarten'],
  },
  {
    id: 'belchen-muenstertal', name: 'Münstertal, Wiedener Eck & Belchenland', region: 'Schwarzwald', typ: 'rund',
    text: 'Eng und steil: aus dem Münstertal über das Wiedener Eck nach Schönau, über Neuenweg nach Badenweiler und am Markgräflerland zurück.',
    tags: ['Kurven', 'Aussicht'],
    wp: ['Staufen im Breisgau', 'Münstertal/Schwarzwald', 'Wieden|Schwarzwald', 'Schönau im Schwarzwald', 'Neuenweg|Landkreis Lörrach', 'Badenweiler', 'Sulzburg'],
  },
  {
    id: 'hotzenwald-schluchsee', name: 'Hotzenwald, St. Blasien & Schluchsee', region: 'Schwarzwald', typ: 'rund',
    text: 'Vom Hochrhein hinauf nach St. Blasien und an den Schluchsee, über Bonndorf und durch die Wutachflühen hinunter nach Stühlingen.',
    tags: ['Seen', 'Kurven'],
    wp: ['Waldshut-Tiengen', 'Höchenschwand', 'St. Blasien', 'Schluchsee', 'Bonndorf im Schwarzwald', 'Stühlingen'],
  },
  {
    id: 'albtrauf', name: 'Schwäbische Alb: Albtrauf & Lenninger Tal', region: 'Schwäbische Alb', typ: 'rund',
    text: 'Die Albaufstiege bei Bad Urach und Lenningen, über die Hochfläche nach Wiesensteig und Laichingen und über Münsingen zurück.',
    tags: ['Kurven', 'Aussicht'],
    wp: ['Bad Urach', 'Lenningen', 'Wiesensteig', 'Laichingen', 'Münsingen'],
  },
  {
    id: 'oberes-donautal', name: 'Oberes Donautal', region: 'Schwäbische Alb', typ: 'rund',
    text: 'Durch den Donaudurchbruch zwischen Sigmaringen und Fridingen mit Felsen und Burgen links und rechts, zurück über den Großen Heuberg.',
    tags: ['Fluss', 'Burgen', 'Kurven'],
    wp: ['Sigmaringen', 'Beuron', 'Fridingen an der Donau', 'Mühlheim an der Donau', 'Meßstetten', 'Albstadt'],
  },
  {
    id: 'zollernalb', name: 'Schloss Lichtenstein & Zollernalb', region: 'Schwäbische Alb', typ: 'rund',
    text: 'Über die Honauer Steige zum Schloss Lichtenstein, quer über die Alb nach Burladingen und an der Burg Hohenzollern vorbei zurück.',
    tags: ['Kurven', 'Burgen'],
    wp: ['Reutlingen', 'Lichtenstein|Württemberg', 'Trochtelfingen', 'Burladingen', 'Hechingen', 'Mössingen'],
  },
  {
    id: 'linzgau', name: 'Bodensee-Hinterland: Linzgau & Heiligenberg', region: 'Bodensee', typ: 'rund',
    text: 'Weg vom Uferverkehr: über Heiligenberg mit Blick auf See und Alpen, durch den Linzgau nach Pfullendorf und über Salem nach Meersburg.',
    tags: ['Aussicht', 'Seen'],
    wp: ['Überlingen', 'Heiligenberg', 'Pfullendorf', 'Salem|Baden', 'Meersburg'],
  },

  // ── Alpen, Allgäu, Oberbayern ─────────────────────────────────────────
  {
    id: 'alpenstrasse-west', name: 'Deutsche Alpenstraße: Lindau – Füssen', region: 'Allgäu', typ: 'strecke',
    text: 'Der westliche Abschnitt der Alpenstraße: vom Bodensee über Oberstaufen und das Oberjoch mit seinen 106 Kurven bis nach Füssen.',
    tags: ['Ferienstraße', 'Alpen', 'Kurven'],
    wp: ['Lindau (Bodensee)', 'Oberstaufen', 'Immenstadt im Allgäu', 'Sonthofen', 'Bad Hindelang', 'Oberjoch', 'Pfronten', 'Füssen'],
  },
  {
    id: 'alpenstrasse-mitte', name: 'Deutsche Alpenstraße: Füssen – Tegernsee', region: 'Oberbayern', typ: 'strecke',
    text: 'Durch das Ammergau nach Garmisch, über den Walchensee und den Kesselberg und weiter über Bad Tölz an den Tegernsee.',
    tags: ['Ferienstraße', 'Alpen', 'Seen'],
    wp: ['Füssen', 'Steingaden', 'Oberammergau', 'Ettal', 'Garmisch-Partenkirchen', 'Wallgau', ['Walchensee', 47.5917, 11.3438], 'Kochel am See', 'Bad Tölz', 'Gmund am Tegernsee', 'Tegernsee'],
  },
  {
    id: 'alpenstrasse-ost', name: 'Deutsche Alpenstraße: Tegernsee – Königssee', region: 'Oberbayern', typ: 'strecke',
    text: 'Über Schliersee und das Sudelfeld ins Inntal, durch den Chiemgau nach Reit im Winkl und Ruhpolding, bis Berchtesgaden und Königssee.',
    tags: ['Ferienstraße', 'Alpen', 'Kurven'],
    wp: ['Tegernsee', 'Schliersee', 'Bayrischzell', 'Oberaudorf', 'Reit im Winkl', 'Ruhpolding', 'Inzell', 'Bad Reichenhall', 'Berchtesgaden', 'Schönau am Königssee'],
  },
  {
    id: 'kesselberg', name: 'Kesselberg & Walchensee', region: 'Oberbayern', typ: 'rund',
    text: 'Die berühmte Kehrenstrecke vom Kochelsee hinauf zum Walchensee, weiter nach Garmisch und über Murnau zurück. Achtung: am Wochenende teils für Motorräder gesperrt.',
    tags: ['Alpen', 'Kurven', 'Seen'],
    wp: ['Kochel am See', ['Walchensee', 47.5917, 11.3438], 'Wallgau', 'Krün', 'Garmisch-Partenkirchen', 'Oberau', 'Murnau am Staffelsee'],
  },
  {
    id: 'sudelfeld', name: 'Sudelfeld & Tatzelwurm', region: 'Oberbayern', typ: 'rund',
    text: 'Über die Sudelfeldstraße hinunter ins Inntal, am Fuß des Wendelsteins entlang und durch das Leitzachtal zurück nach Bayrischzell.',
    tags: ['Alpen', 'Kurven'],
    wp: ['Bayrischzell', 'Oberaudorf', 'Brannenburg', 'Bad Feilnbach', 'Fischbachau', 'Schliersee'],
  },
  {
    id: 'rossfeld', name: 'Roßfeld-Panoramastraße & Berchtesgadener Land', region: 'Berchtesgadener Land', typ: 'rund',
    text: 'Die höchste Panoramastraße Deutschlands auf über 1.500 Meter, danach über die Ramsau und Schneizlreuth nach Bad Reichenhall. Mautpflichtig.',
    tags: ['Alpen', 'Aussicht', 'Kurven'],
    wp: ['Berchtesgaden', ['Roßfeld', 47.6493, 13.0388], ['Obersalzberg', 47.6297, 13.0393], 'Ramsau bei Berchtesgaden', 'Schneizlreuth', 'Bad Reichenhall', 'Bayerisch Gmain'],
  },
  {
    id: 'allgaeu-oberjoch', name: 'Allgäu: Oberjoch & Grüntensee', region: 'Allgäu', typ: 'rund',
    text: 'Die Jochstraße hinauf nach Oberjoch, über Wertach und Nesselwang ins Voralpenland und über Kempten und Immenstadt zurück.',
    tags: ['Alpen', 'Kurven', 'Seen'],
    wp: ['Sonthofen', 'Bad Hindelang', 'Oberjoch', 'Wertach', 'Nesselwang', 'Kempten (Allgäu)', 'Immenstadt im Allgäu'],
  },
  {
    id: 'romantische-strasse', name: 'Romantische Straße', region: 'Franken & Schwaben', typ: 'strecke',
    text: 'Die bekannteste Ferienstraße Deutschlands von Würzburg bis Füssen: Taubertal, Rothenburg, Dinkelsbühl, das Ries und der Lech bis zu den Alpen.',
    tags: ['Ferienstraße', 'Altstädte'],
    wp: ['Würzburg', 'Tauberbischofsheim', 'Bad Mergentheim', 'Weikersheim', 'Creglingen', 'Rothenburg ob der Tauber', 'Feuchtwangen', 'Dinkelsbühl', 'Nördlingen', 'Harburg (Schwaben)', 'Donauwörth', 'Augsburg', 'Landsberg am Lech', 'Schongau', 'Steingaden', 'Füssen'],
  },

  // ── Ostbayern, Franken ─────────────────────────────────────────────────
  {
    id: 'arberland', name: 'Bayerischer Wald: Arberland', region: 'Bayerischer Wald', typ: 'rund',
    text: 'Am Großen Arber vorbei nach Bayerisch Eisenstein und Lam, durch das Zellertal nach Viechtach und über Regen zurück.',
    tags: ['Kurven', 'Wald'],
    wp: ['Zwiesel', 'Bayerisch Eisenstein', 'Lam', 'Arnbruck', 'Viechtach', 'Regen'],
  },
  {
    id: 'nationalpark-bw', name: 'Nationalpark Bayerischer Wald', region: 'Bayerischer Wald', typ: 'rund',
    text: 'Ruhige Waldstraßen am Rand des Nationalparks: Spiegelau, Mauth, Freyung und Waldkirchen.',
    tags: ['Wald', 'Kurven'],
    wp: ['Grafenau', 'Spiegelau', 'Mauth', 'Freyung', 'Waldkirchen', 'Perlesreut'],
  },
  {
    id: 'fraenkische-schweiz', name: 'Fränkische Schweiz', region: 'Franken', typ: 'rund',
    text: 'Das Wiesenttal hinauf nach Behringersmühle, über Pottenstein und Pegnitz und durch die Täler um Egloffstein zurück nach Ebermannstadt.',
    tags: ['Kurven', 'Burgen'],
    wp: ['Ebermannstadt', 'Muggendorf', 'Gößweinstein', 'Pottenstein', 'Pegnitz', 'Betzenstein', 'Gräfenberg', 'Egloffstein'],
  },
  {
    id: 'altmuehltal', name: 'Altmühltal: Eichstätt – Kelheim', region: 'Altmühltal', typ: 'strecke',
    text: 'Dem Flusslauf durch das Altmühltal folgend, zwischen Kalkfelsen und Burgen bis zum Donaudurchbruch bei Kelheim.',
    tags: ['Fluss', 'Burgen'],
    wp: ['Eichstätt', 'Kipfenberg', 'Beilngries', 'Dietfurt an der Altmühl', 'Riedenburg', 'Essing', 'Kelheim'],
  },
  {
    id: 'steigerwald', name: 'Steigerwald', region: 'Franken', typ: 'rund',
    text: 'Weinberge am Westrand, Buchenwald auf der Höhe: von Ebrach über Geiselwind nach Iphofen und über Scheinfeld zurück.',
    tags: ['Wald', 'Wein'],
    wp: ['Ebrach', 'Geiselwind', 'Wiesentheid', 'Iphofen', 'Markt Bibart', 'Scheinfeld', 'Burghaslach'],
  },
  {
    id: 'fichtelgebirge', name: 'Fichtelgebirge: Ochsenkopf & Schneeberg', region: 'Fichtelgebirge', typ: 'rund',
    text: 'Rund um Ochsenkopf und Schneeberg: Bischofsgrün, Fichtelberg, Wunsiedel und Weißenstadt, dann hinunter nach Bad Berneck.',
    tags: ['Kurven', 'Wald'],
    wp: ['Bischofsgrün', 'Warmensteinach', 'Fichtelberg', 'Wunsiedel', 'Weißenstadt', 'Gefrees', 'Bad Berneck im Fichtelgebirge'],
  },

  // ── Harz, Thüringen, Sachsen ──────────────────────────────────────────
  {
    id: 'harz-hochstrasse', name: 'Harz: Torfhaus, Schierke & Wernigerode', region: 'Harz', typ: 'rund',
    text: 'Die beliebteste Harzrunde: von Bad Harzburg hinauf nach Torfhaus und Braunlage, über Elend und Schierke nach Wernigerode.',
    tags: ['Kurven', 'Wald', 'Aussicht'],
    wp: ['Bad Harzburg', 'Torfhaus', 'Braunlage', 'Benneckenstein', 'Elend', 'Schierke', 'Wernigerode', 'Ilsenburg'],
  },
  {
    id: 'oberharz', name: 'Oberharz: Clausthal, Altenau & Andreasberg', region: 'Harz', typ: 'rund',
    text: 'Durch das Söse- und Odertal und über die Oberharzer Hochfläche mit ihren Teichen — kurvig, aber weniger voll als Torfhaus.',
    tags: ['Kurven', 'Seen'],
    wp: ['Osterode am Harz', 'Clausthal-Zellerfeld', 'Altenau', 'Sankt Andreasberg', 'Bad Lauterberg im Harz', 'Herzberg am Harz'],
  },
  {
    id: 'bodetal', name: 'Bodetal & Rappbodetalsperre', region: 'Harz', typ: 'rund',
    text: 'Von Thale durch das Bodetal nach Treseburg und Altenbrak, über Hasselfelde zur Rappbodetalsperre und über Blankenburg zurück.',
    tags: ['Kurven', 'Seen', 'Fluss'],
    wp: ['Thale', 'Treseburg', 'Altenbrak', 'Hasselfelde', 'Wendefurth', 'Blankenburg (Harz)'],
  },
  {
    id: 'kyffhaeuser', name: 'Kyffhäuser: 36 Kurven', region: 'Kyffhäuser', typ: 'rund',
    text: 'Die Kyffhäuserstraße mit ihren 36 Kurven von Bad Frankenhausen hinauf zum Denkmal und hinunter nach Kelbra. Wegen Unfällen teils mit Tempolimit und Streckensperren — Schilder beachten.',
    tags: ['Kurven', 'Aussicht'],
    wp: ['Bad Frankenhausen', ['Kyffhäuser', 51.4129, 11.1078], 'Kelbra (Kyffhäuser)', 'Roßla', 'Artern'],
  },
  {
    id: 'rennsteig', name: 'Thüringer Wald: Rennsteig & Oberhof', region: 'Thüringer Wald', typ: 'rund',
    text: 'Von Oberhof über Zella-Mehlis und Suhl nach Schleusingen, hinauf zum Rennsteig bei Schmiedefeld und über Ilmenau zurück.',
    tags: ['Kurven', 'Wald'],
    wp: ['Oberhof', 'Zella-Mehlis', 'Suhl', 'Schleusingen', 'Schmiedefeld am Rennsteig', 'Frauenwald', 'Ilmenau'],
  },
  {
    id: 'thueringer-meer', name: 'Thüringer Meer & Obere Saale', region: 'Thüringen', typ: 'rund',
    text: 'An Hohenwarte- und Bleilochtalsperre entlang, durch das Saaletal bei Ziegenrück und über den Frankenwald zurück nach Saalfeld.',
    tags: ['Seen', 'Kurven', 'Fluss'],
    wp: ['Saalfeld/Saale', 'Hohenwarte', 'Ziegenrück', 'Schleiz', 'Saalburg-Ebersdorf', 'Bad Lobenstein', 'Wurzbach', 'Leutenberg'],
  },
  {
    id: 'saechsische-schweiz', name: 'Sächsische Schweiz', region: 'Sachsen', typ: 'rund',
    text: 'Am Elbsandstein entlang: Festung Königstein, Bad Schandau, hinauf nach Sebnitz und über Hohnstein und Lohmen zurück nach Pirna.',
    tags: ['Fluss', 'Aussicht', 'Kurven'],
    wp: ['Pirna', 'Königstein (Sächsische Schweiz)', 'Bad Schandau', 'Sebnitz', 'Hohnstein', 'Lohmen|Sachsen'],
  },
  {
    id: 'erzgebirge', name: 'Erzgebirge: Fichtelberg & Oberwiesenthal', region: 'Erzgebirge', typ: 'rund',
    text: 'Von Annaberg-Buchholz hinauf nach Oberwiesenthal am Fichtelberg, über die Kammstraßen nach Schwarzenberg und über Elterlein zurück.',
    tags: ['Kurven', 'Aussicht', 'Wald'],
    wp: ['Annaberg-Buchholz', 'Oberwiesenthal', 'Crottendorf', 'Breitenbrunn/Erzgebirge', 'Schwarzenberg/Erzgebirge', 'Elterlein'],
  },
  {
    id: 'zittauer-gebirge', name: 'Zittauer Gebirge', region: 'Oberlausitz', typ: 'rund',
    text: 'Kleines Mittelgebirge mit großen Kurven: Oybin, Lückendorf, Jonsdorf und Waltersdorf an der tschechischen Grenze.',
    tags: ['Kurven', 'Wald'],
    wp: ['Zittau', 'Oybin', 'Lückendorf', 'Jonsdorf', 'Waltersdorf|Großschönau', 'Großschönau'],
  },
  {
    id: 'saechsische-weinstrasse', name: 'Sächsische Weinstraße', region: 'Sachsen', typ: 'strecke',
    text: 'Entlang der Elbe von Pirna über Dresden und die Weinberge von Radebeul bis Meißen und Diesbar-Seußlitz.',
    tags: ['Ferienstraße', 'Fluss', 'Wein'],
    wp: ['Pirna', 'Dresden', 'Radebeul', 'Meißen', 'Diesbar-Seußlitz'],
  },

  // ── Norden und Osten ───────────────────────────────────────────────────
  {
    id: 'holsteinische-schweiz', name: 'Holsteinische Schweiz', region: 'Schleswig-Holstein', typ: 'rund',
    text: 'Zwischen den Seen um Plön und Eutin, an die Ostsee bei Hohwacht und über den Bungsberg — den höchsten Punkt Schleswig-Holsteins.',
    tags: ['Seen', 'Küste'],
    wp: ['Eutin', 'Malente', 'Plön', 'Lütjenburg', 'Hohwacht (Ostsee)', 'Schönwalde am Bungsberg'],
  },
  {
    id: 'lueneburger-heide', name: 'Lüneburger Heide', region: 'Lüneburger Heide', typ: 'rund',
    text: 'Gemütlich durch die Heide: Bispingen, Undeloh, Egestorf und Amelinghausen. Am schönsten zur Heideblüte im August.',
    tags: ['Landstraße', 'Natur'],
    wp: ['Soltau', 'Bispingen', 'Undeloh', 'Egestorf', 'Amelinghausen', 'Munster|Heidekreis'],
  },
  {
    id: 'elbuferstrasse', name: 'Elbuferstraße', region: 'Wendland', typ: 'strecke',
    text: 'Auf dem Elbdeich und daneben durch das Biosphärenreservat Elbtalaue, von Bleckede bis Schnackenburg.',
    tags: ['Ferienstraße', 'Fluss'],
    wp: ['Bleckede', 'Neu Darchau', 'Hitzacker (Elbe)', 'Dannenberg (Elbe)', 'Gartow', 'Schnackenburg'],
  },
  {
    id: 'mueritz', name: 'Mecklenburgische Seenplatte', region: 'Mecklenburg', typ: 'rund',
    text: 'Von Waren an der Müritz zu Fleesensee, Plauer See und Krakower See und durch die Mecklenburgische Schweiz zurück.',
    tags: ['Seen', 'Landstraße'],
    wp: ['Waren (Müritz)', 'Malchow', 'Plau am See', 'Krakow am See', 'Teterow', 'Malchin'],
  },
  {
    id: 'ruegen', name: 'Rügen: Jasmund & Bäderküste', region: 'Rügen', typ: 'rund',
    text: 'Zu den Kreidefelsen auf Jasmund, die Bäderstraße über Binz und Sellin entlang und über Putbus zurück nach Bergen.',
    tags: ['Küste', 'Alleen'],
    wp: ['Bergen auf Rügen', 'Sassnitz', 'Lohme', 'Binz', 'Sellin', 'Göhren', 'Putbus'],
  },
  {
    id: 'maerkische-schweiz', name: 'Märkische Schweiz & Oderbruch', region: 'Brandenburg', typ: 'rund',
    text: 'Die hügeligste Ecke um Berlin: Buckow und die Märkische Schweiz, hinunter ins Oderbruch nach Bad Freienwalde und über Prötzel zurück.',
    tags: ['Seen', 'Alleen'],
    wp: ['Strausberg', 'Buckow (Märkische Schweiz)', 'Müncheberg', 'Bad Freienwalde (Oder)', 'Prötzel'],
  },
]
