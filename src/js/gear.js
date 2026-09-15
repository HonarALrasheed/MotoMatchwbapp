/**
 * ══════════════════════════════════════════════════════════════
 *  MOTOMATCH — gear.js  v4.0
 *  8 categories per style: helmet, jacket, gloves, boots,
 *  pants, kidneybelt, balaclava, backprotector
 * ══════════════════════════════════════════════════════════════
 */

/* ─── Universal categories (same across all styles) ─── */
const universalGear = {
  kidneybelt: [
    { name: "Büse Nierengurt Basic",     type: "Nierengurt",        priceMin: 15,  priceMax: 30,  reason: "Einstieg, elastisch, verstellbar" },
    { name: "Held Nierengurt Comfort",   type: "Nierengurt Gepolst.",priceMin: 30,  priceMax: 60,  reason: "Breiter Schutz, Klettverschluss" , url: "https://www.fc-moto.com/de-de/p/held-falun-ii-nierengurt-HE-Held-Falun-II-Kidney-Belt.v", image: "/gear/held-nierengurt-comfort.webp", },
    { name: "Forcefield Pro L2",         type: "Nierengurt Premium", priceMin: 60,  priceMax: 110, reason: "CE-Level 2, anatomisch, leicht" },
  ],
  balaclava: [
    { name: "Held Thermo Sturmhaube",    type: "Sturmhaube",        priceMin: 10,  priceMax: 20,  reason: "Warm, atmungsaktiv, Einstieg" , url: "https://www.fc-moto.com/de-de/p/held-9250-sturmhaube-HE-009250-00-1-Stck", image: "/gear/held-thermo-sturmhaube.webp", },
    { name: "Buse Coolmax Sturmhaube",   type: "Sturmhaube Sommer", priceMin: 15,  priceMax: 30,  reason: "Feuchtigkeitsregulierend, dünn" , url: "https://www.fc-moto.com/en-en/p/buese-balaclava-coolmax-BUE-177800", image: "/gear/buse-coolmax-sturmhaube.webp", },
    { name: "Schuberth Pro Balaclava",   type: "Sturmhaube Premium", priceMin: 40,  priceMax: 70,  reason: "Antibakteriell, optimale Passform" },
  ],
  backprotector: [
    { name: "Alpinestars Nucleon KR-Ci", type: "Rückenprotektor",   priceMin: 40,  priceMax: 80,  reason: "CE-Level 1, leicht, flexibel" },
    { name: "Held Seiryo Pro",           type: "Rückenprotektor",   priceMin: 80,  priceMax: 140, reason: "CE-Level 2, ergonomisch geformt" },
    { name: "Forcefield Pro L2 Back",    type: "Rückenprotektor",   priceMin: 130, priceMax: 220, reason: "CE-Level 2+, maximale Absorption" },
  ],
}

const gearByStyle = {
  Sportbike: {
    helmet: [
      { name: "LS2 FF800 Storm II",        type: "Integralhelm",       priceMin: 120, priceMax: 200, reason: "Leicht, gut belüftet, Einstieg" , url: "https://www.fc-moto.com/de-de/p/ls2-ff800-storm-ii-solid-helm-titan-xs-53-54-LS-168001007XS", image: "/gear/ls2-ff800-storm-ii.webp", },
      { name: "AGV K6 S",                  type: "Integralhelm",       priceMin: 250, priceMax: 400, reason: "Kompakt, aerodynamisch, alltagstauglich" , url: "https://www.louis.de/artikel/agv-k6-s-integralhelm/217335", image: "/gear/agv-k6-s.webp", },
      { name: "Shoei X-Spirit III",        type: "Racing-Integralhelm",priceMin: 400, priceMax: 650, reason: "Maximaler Schutz, Rennstrecke tauglich" },
    ],
    jacket: [
      { name: "Alpinestars Racer v2",      type: "Textiljacke",        priceMin: 150, priceMax: 250, reason: "CE-Level 1, leicht und flexibel" },
      { name: "Rev'it Quantum 2",          type: "Textiljacke",        priceMin: 200, priceMax: 350, reason: "CE-Level 2, vielseitig, belüftet" , url: "https://www.amazon.de/REVIT-Motorradjacke-Protektoren-Textiljacke-Ganzj%C3%A4hrig/dp/B08X1PVWGT", image: "/gear/revit-quantum-2.webp", },
      { name: "Alpinestars GP Plus R v3",  type: "Lederkombi",         priceMin: 350, priceMax: 550, reason: "CE-Level 2, Racing-Passform" , url: "https://www.louis.de/artikel/alpinestars-gp-plus-r-v3-lederkombijacke/207588", image: "/gear/alpinestars-gp-plus-r-v3.webp", },
    ],
    gloves: [
      { name: "Held Sambia",               type: "Sporthandschuhe",    priceMin: 30,  priceMax: 60,  reason: "Einstieg, guter Grip" , url: "https://www.fc-moto.com/de-de/p/held-sambia-adventure-motorrad-handschuhe-schwarz-7-s-HE-002163-00-1-7", image: "/gear/held-sambia.webp", },
      { name: "Alpinestars SP-8 v3",       type: "Sporthandschuhe",    priceMin: 60,  priceMax: 100, reason: "Kurze Manschette, direktes Feeling" , url: "https://www.louis.de/artikel/alpinestars-sp-8-v3-handschuhe/210662", image: "/gear/alpinestars-sp-8-v3.webp", },
      { name: "Held Phantom II",           type: "Race-Handschuhe",    priceMin: 120, priceMax: 200, reason: "Kangaroo-Leder, maximaler Schutz" , url: "https://www.louis.de/artikel/held-phantom-ii-2312-handschuhe/201364", image: "/gear/held-phantom-ii.webp", },
    ],
    boots: [
      { name: "TCX Comp Evo 2",            type: "Sport-Stiefel",      priceMin: 100, priceMax: 180, reason: "Solider Knöchelschutz, gute Passform" , url: "https://www.fc-moto.com/de-de/p/tcx-comp-evo-2-michelin-motocross-stiefel-blau-rot-38-TCX-9662-RBBY-38", image: "/gear/tcx-comp-evo-2.webp", },
      { name: "Sidi Cobra 2 SRS",          type: "Rennsportstiefel",   priceMin: 180, priceMax: 280, reason: "Knöchelschutz, Sohlengrip" },
      { name: "Alpinestars Supertech R",   type: "Racing-Stiefel",     priceMin: 300, priceMax: 450, reason: "Maximaler Schutz, Rennstrecke" , url: "https://www.louis.de/artikel/alpinestars-supertech-r-stiefel/202464", image: "/gear/alpinestars-supertech-r.webp", },
    ],
    pants: [
      { name: "Rev'it Tornado 4",          type: "Textilhose",         priceMin: 150, priceMax: 250, reason: "CE-Level 2, belüftet, Sommer" , url: "https://www.fc-moto.com/de-de/p/revit-tornado-4-h2o-wasserdichte-motorrad-textilhose-silber-schwarz-s-REV-FPT138-4051-S", image: "/gear/revit-tornado-4.webp", },
      { name: "Alpinestars Andes v3 Pant", type: "Textilhose",         priceMin: 200, priceMax: 320, reason: "Wasserdicht, touring-tauglich" , url: "https://www.fc-moto.com/en-en/p/alpinestars-andes-v3-drystar-motorcycle-textile-pants-black-m-APS-3227521-10-M", image: "/gear/alpinestars-andes-v3-pant.webp", },
      { name: "Alpinestars GP Plus v3",    type: "Lederhose",          priceMin: 300, priceMax: 480, reason: "CE-Level 2, Racing-Passform" },
    ],
    ...universalGear,
  },
  Naked: {
    helmet: [
      { name: "Schuberth C4 Basic",        type: "Klapphelm",          priceMin: 150, priceMax: 250, reason: "Praktisch für Alltag, sicher" , url: "https://www.fc-moto.com/de-de/p/schuberth-c4-basic-helm-silber-xs-53-54-SUB-4546513360", image: "/gear/schuberth-c4-basic.webp", },
      { name: "AGV K6 S",                  type: "Integralhelm",       priceMin: 250, priceMax: 400, reason: "Kompakt, leicht, alltagstauglich" , url: "https://www.louis.de/artikel/agv-k6-s-integralhelm/217335", image: "/gear/agv-k6-s.webp", },
      { name: "Shoei NXR2",                type: "Integralhelm",       priceMin: 380, priceMax: 550, reason: "Exzellente Belüftung, leiser Innenraum" , url: "https://www.louis.de/artikel/shoei-nxr-2-integralhelm/217554", image: "/gear/shoei-nxr2.webp", },
    ],
    jacket: [
      { name: "Held Carese Evo",           type: "Textiljacke",        priceMin: 120, priceMax: 200, reason: "Vielseitig, wasserdicht, CE-Level 1" , url: "https://www.fc-moto.com/de-de/p/held-carese-evo-gtx-motorrad-textiljacke-hellgrau-rot-lang-m-HE-062140-00-72-L-M", image: "/gear/held-carese-evo.webp", },
      { name: "Rev'it Quantum 2",          type: "Textiljacke",        priceMin: 200, priceMax: 350, reason: "CE-Level 2, belüftet, alltagstauglich" , url: "https://www.amazon.de/REVIT-Motorradjacke-Protektoren-Textiljacke-Ganzj%C3%A4hrig/dp/B08X1PVWGT", image: "/gear/revit-quantum-2.webp", },
      { name: "Furygan GT Evo",            type: "Lederjacke",         priceMin: 300, priceMax: 480, reason: "CE-Level 2, Premium-Leder" },
    ],
    gloves: [
      { name: "Held Hamada",               type: "Kurzhandschuhe",     priceMin: 30,  priceMax: 60,  reason: "Guter Grip, handlich im Alltag" , url: "https://www.louis.de/artikel/held-hamada-22060-handschuhe/201704", image: "/gear/held-hamada.webp", },
      { name: "Alpinestars Andes v3",      type: "Allwetter",          priceMin: 60,  priceMax: 100, reason: "Wasserdicht, vielseitig" , url: "https://www.fc-moto.com/en-en/p/alpinestars-andes-v3-camo-drystar-motorcycle-textile-jacket-s-APS-3207521-858-S", image: "/gear/alpinestars-andes-v3.webp", },
      { name: "Held Air Stream 3",         type: "Sommer-Handschuhe",  priceMin: 100, priceMax: 160, reason: "Maximale Belüftung, CE-Level 2" , url: "https://www.louis.de/artikel/held-air-stream-3-0-handschuhe/201851", image: "/gear/held-air-stream-3.webp", },
    ],
    boots: [
      { name: "TCX Street 3",              type: "Sneaker-Stiefel",    priceMin: 80,  priceMax: 150, reason: "Alltagsoptik mit Schutzfunktion" , url: "https://www.louis.de/artikel/tcx-street-3-air-stiefel/219835", image: "/gear/tcx-street-3.webp", },
      { name: "Forma Flow",                type: "Urban-Stiefel",      priceMin: 130, priceMax: 220, reason: "WP-Membran, CE-Knöchelschutz" },
      { name: "Sidi Touring",              type: "Touring-Stiefel",    priceMin: 200, priceMax: 320, reason: "Premium-Leder, voller Schutz" },
    ],
    pants: [
      { name: "Büse Ferno Jeans",          type: "Motorradjeans",      priceMin: 80,  priceMax: 150, reason: "Alltagsoptik, CE-Level 1 Protektoren" , url: "https://www.amazon.de/dp/B081FD86H9", image: "/gear/buese-ferno-jeans.webp", },
      { name: "Rev'it Lombard 3",          type: "Motorradjeans",      priceMin: 150, priceMax: 250, reason: "Stretch-Denim, CE-Level 2" , url: "https://www.fc-moto.com/de-de/p/revit-lombard-3-rf-motorrad-jeans-dunkelgrau-30-l36-REV-FPJ054-6163-30", image: "/gear/revit-lombard-3.webp", },
      { name: "Held Iconic Jeans",         type: "Premium Jeans",      priceMin: 200, priceMax: 320, reason: "Kevlar-Verstärkung, CE-Level 2" },
    ],
    ...universalGear,
  },
  Cruiser: {
    helmet: [
      { name: "Biltwell Gringo S",         type: "Integral Custom",    priceMin: 120, priceMax: 220, reason: "Flaches Profil, Custom-Culture Look" },
      { name: "Bell Bullitt",              type: "Jethelm Retro",      priceMin: 220, priceMax: 400, reason: "Klassischer Look, ECE 22.06" , url: "https://www.fc-moto.com/en-en/p/bell-bullitt-solid-helmet-black-matt-xs-54-55-BEL-8004720001", image: "/gear/bell-bullitt.webp", },
      { name: "Hedon Heroine Racer",       type: "Integral Vintage",   priceMin: 400, priceMax: 700, reason: "Handgefertigt, Premium-Qualität" },
    ],
    jacket: [
      { name: "Helstons Buscador",         type: "Lederjacke Retro",   priceMin: 180, priceMax: 320, reason: "Vintage-Stil mit CE-Protektoren" },
      { name: "Belstaff Tourmaster",       type: "Gewachste Baumwolle", priceMin: 300, priceMax: 500, reason: "Ikonischer Retro-Stil, wasserfest" },
      { name: "Roland Sands Ronin",        type: "Lederjacke Custom",  priceMin: 380, priceMax: 580, reason: "CE-Level 2, Cafe-Racer Stil" },
    ],
    gloves: [
      { name: "Biltwell Moto",             type: "Leder Kurzhandschuh", priceMin: 30, priceMax: 60,  reason: "Ikonisch, günstig, guter Grip" },
      { name: "Held Steve",                type: "Touring-Leder",      priceMin: 60,  priceMax: 120, reason: "Langer Schaft, klassisches Design" , url: "https://www.fc-moto.com/de-de/p/held-steve-classic-motorrad-handschuhe-7-s-HE-002215-00-1-7", image: "/gear/held-steve.webp", },
      { name: "Weise Texas Touring",       type: "Leder Touring",      priceMin: 80,  priceMax: 150, reason: "Klassischer Look, gute Haptik" },
    ],
    boots: [
      { name: "H-D Jett Boot",             type: "Urban Motorradboot", priceMin: 80,  priceMax: 150, reason: "Alltagsoptik mit CE-Knöchelschutz" },
      { name: "H-D Leder Stiefel",         type: "Cruiser-Boot",       priceMin: 100, priceMax: 200, reason: "Knöchelschutz im Harley-Stil" , url: "https://www.amazon.de/dp/B00B85P9RK", image: "/gear/h-d-leder-stiefel.webp", },
      { name: "Trialmaster Belstaff",      type: "Heritage Boot",      priceMin: 200, priceMax: 400, reason: "Zeitloses Design, Knöchelschutz" , url: "https://www.fc-moto.com/de-de/p/belstaff-trialmaster-motorrad-stiefel-braun-40-BST-105088BROWN40", image: "/gear/trialmaster-belstaff.webp", },
    ],
    pants: [
      { name: "Büse Ferno Jeans",          type: "Motorradjeans",      priceMin: 80,  priceMax: 150, reason: "Alltagsoptik, CE-Level 1" , url: "https://www.amazon.de/dp/B081FD86H9", image: "/gear/buese-ferno-jeans.webp", },
      { name: "H-D Riding Chaps",          type: "Leder Chaps",        priceMin: 150, priceMax: 280, reason: "Klassischer Cruiser-Look" },
      { name: "Helstons Cargo Pants",      type: "Lederhose Retro",    priceMin: 250, priceMax: 420, reason: "Vintage-Stil, CE-Level 2" , url: "https://www.fc-moto.com/de-de/p/helstons-cargo-motorrad-textilhose-grau-28-HT-2021026-GR-28-US", image: "/gear/helstons-cargo-pants.webp", },
    ],
    ...universalGear,
  },
  Enduro: {
    helmet: [
      { name: "O'Neal 3SRS",               type: "Offroad-Helm",       priceMin: 80,  priceMax: 150, reason: "Leicht, gute Belüftung, Einstieg" , url: "https://www.fc-moto.com/de-de/p/oneal-3srs-motocross-helm-blau-neon-gelb-xs-53-54-ONL-0625-051", image: "/gear/oneal-3srs.webp", },
      { name: "Fox Rampage Pro Carbon",    type: "Offroad-Helm",       priceMin: 200, priceMax: 380, reason: "Breites Sichtfeld, Offroad-Belüftung" },
      { name: "Airoh Commander 2",         type: "Enduro-Helm",        priceMin: 300, priceMax: 480, reason: "Carbon, ultraleicht, dual-sport" , url: "https://www.louis.de/artikel/airoh-commander-2-endurohelm/213891", image: "/gear/airoh-commander-2.webp", },
    ],
    jacket: [
      { name: "Fox Flexair Jersey",        type: "MX Trikot",          priceMin: 50,  priceMax: 120, reason: "Leicht, atmungsaktiv, kombinierbar" , url: "https://www.louis.de/artikel/fox-flexair-infinite-mx-jersey/213550", image: "/gear/fox-flexair-jersey.webp", },
      { name: "Alpinestars Andes v3",      type: "Touring-Jacket",     priceMin: 180, priceMax: 300, reason: "Wasserdicht, Protektoren inklusive" , url: "https://www.fc-moto.com/en-en/p/alpinestars-andes-v3-camo-drystar-motorcycle-textile-jacket-s-APS-3207521-858-S", image: "/gear/alpinestars-andes-v3.webp", },
      { name: "Klim Badlands Pro",         type: "Adventure-Jacket",   priceMin: 400, priceMax: 650, reason: "Gore-Tex, maximaler Schutz" , url: "https://www.fc-moto.com/de-de/p/klim-badlands-pro-2023-motorrad-textiljacke-schwarz-s-KLM-4052-003-120-001", image: "/gear/klim-badlands-pro.webp", },
    ],
    gloves: [
      { name: "Fox Dirtpaw",               type: "MX Handschuhe",      priceMin: 20,  priceMax: 50,  reason: "Griffig, strapazierfähig, günstig" , url: "https://www.louis.de/artikel/fox-dirtpaw-mx-handschuhe/210705", image: "/gear/fox-dirtpaw.webp", },
      { name: "Alpinestars Dune v2",       type: "Offroad-Handschuhe", priceMin: 50,  priceMax: 90,  reason: "Guter Schutz, atmungsaktiv" },
      { name: "Held Sambia 2",             type: "Touring-Handschuhe", priceMin: 80,  priceMax: 140, reason: "WP-Membran, CE-Level 2" , url: "https://www.louis.de/artikel/held-22569-sambia-2-handschuhe/210953", image: "/gear/held-sambia-2.webp", },
    ],
    boots: [
      { name: "TCX Comp Evo 2",            type: "Offroad-Stiefel",    priceMin: 100, priceMax: 180, reason: "Solider Schutz, gute Passform" , url: "https://www.fc-moto.com/de-de/p/tcx-comp-evo-2-michelin-motocross-stiefel-blau-rot-38-TCX-9662-RBBY-38", image: "/gear/tcx-comp-evo-2.webp", },
      { name: "Alpinestars Tech 7 Enduro", type: "Enduro-Stiefel",     priceMin: 200, priceMax: 350, reason: "Wasserdicht, Knöchelschutz, Grip" , url: "https://www.louis.de/artikel/alpinestars-tech-7-enduro-ds-stiefel/31952001", image: "/gear/alpinestars-tech-7-enduro.webp", },
      { name: "Sidi Crossfire 3 SRS",      type: "MX Premium-Stiefel", priceMin: 350, priceMax: 500, reason: "Maximaler Schutz, Präzisionspassform" , url: "https://www.louis.de/artikel/sidi-crossfire-3-srs-motocross-stiefel/219514", image: "/gear/sidi-crossfire-3-srs.webp", },
    ],
    pants: [
      { name: "Fox Defend Pant",           type: "MTB/Enduro Hose",    priceMin: 80,  priceMax: 150, reason: "Bewegungsfreiheit, robust" , url: "https://www.fc-moto.com/en-en/p/fox-defend-bicycle-pants-olive-28-FOX-32372-099-28", image: "/gear/fox-defend-pant.webp", },
      { name: "Alpinestars Andes v3 Pant", type: "Adventure Hose",     priceMin: 180, priceMax: 300, reason: "Wasserdicht, CE-Level 2" , url: "https://www.fc-moto.com/en-en/p/alpinestars-andes-v3-drystar-motorcycle-textile-pants-black-m-APS-3227521-10-M", image: "/gear/alpinestars-andes-v3-pant.webp", },
      { name: "Klim Badlands Pro Pant",    type: "Adventure Hose",     priceMin: 350, priceMax: 550, reason: "Gore-Tex, maximaler Schutz" , url: "https://www.fc-moto.com/de-de/p/klim-badlands-pro-2023-motorrad-textilhose-braun-sand-32-KLM-4053-003-032-904", image: "/gear/klim-badlands-pro-pant.webp", },
    ],
    ...universalGear,
  },
  Motocross: {
    helmet: [
      { name: "O'Neal 3SRS MX",            type: "MX Helm",            priceMin: 80,  priceMax: 150, reason: "Einstieg, leicht, ventiliert" , url: "https://www.fc-moto.com/de-de/p/oneal-3srs-vision-motocross-helm-schwarz-grau-xs-53-54-ONL-0625-291", image: "/gear/oneal-3srs-mx.webp", },
      { name: "Fox Rampage Pro Carbon",    type: "MX Helm",            priceMin: 200, priceMax: 400, reason: "Ventiliert, CE-zertifiziert" },
      { name: "Bell Moto-10",              type: "MX Premium-Helm",    priceMin: 450, priceMax: 700, reason: "MIPS, maximale Sicherheit" , url: "https://www.fc-moto.com/en-en/p/bell-moto-10-mips-motocross-helmet-black-matt-s-55-56-BEL-37008-255-S", image: "/gear/bell-moto-10.webp", },
    ],
    jacket: [
      { name: "Fly Racing Kinetic",        type: "MX Jersey",          priceMin: 40,  priceMax: 80,  reason: "Günstig, leicht, atmungsaktiv" , url: "https://www.fc-moto.com/en-en/p/fly-racing-kinetic-fuel-motocross-jersey-black-m-FLY-70201-M-420", image: "/gear/fly-racing-kinetic.webp", },
      { name: "Fox 180 Kombo",             type: "MX Jersey + Hose",   priceMin: 100, priceMax: 200, reason: "Bewegungsfreiheit, leichter Schutz" },
      { name: "Alpinestars Techstar",      type: "MX Race-Set",        priceMin: 200, priceMax: 350, reason: "Profi-Level, optimale Passform" , url: "https://www.louis.de/artikel/alpinestars-techstar-arch-mx-jersey/212980", image: "/gear/alpinestars-techstar.webp", },
    ],
    gloves: [
      { name: "Fox Dirtpaw Race",          type: "MX Handschuhe",      priceMin: 20,  priceMax: 40,  reason: "Klassiker im Motocross" },
      { name: "Alpinestars Radar",         type: "MX Handschuhe",      priceMin: 40,  priceMax: 70,  reason: "Guter Schutz, Grip" , url: "https://www.louis.de/artikel/alpinestars-radar-mx-handschuhe/210821", image: "/gear/alpinestars-radar.webp", },
      { name: "Held Mirage",               type: "MX Handschuhe",      priceMin: 70,  priceMax: 110, reason: "CE-Level 2, Premium-Verarbeitung" },
    ],
    boots: [
      { name: "TCX Comp Evo 2",            type: "MX Stiefel",         priceMin: 100, priceMax: 180, reason: "Solider Schutz, leicht" , url: "https://www.fc-moto.com/de-de/p/tcx-comp-evo-2-michelin-motocross-stiefel-blau-rot-38-TCX-9662-RBBY-38", image: "/gear/tcx-comp-evo-2.webp", },
      { name: "Sidi Crossfire 3",          type: "MX Premium-Stiefel", priceMin: 300, priceMax: 500, reason: "Präzisionspassform, top Schutz" , url: "https://www.louis.de/artikel/sidi-crossfire-3-motocross-stiefel/219518", image: "/gear/sidi-crossfire-3.webp", },
      { name: "Alpinestars Tech 10",       type: "MX Stiefel",         priceMin: 400, priceMax: 600, reason: "Maximaler Knöchelschutz" , url: "https://www.louis.de/artikel/alpinestars-tech-10-motocross-stiefel/501360", image: "/gear/alpinestars-tech-10.webp", },
    ],
    pants: [
      { name: "O'Neal Element Racewear",   type: "MX Race Hose",       priceMin: 50,  priceMax: 100, reason: "Einstieg, leicht, haltbar" , url: "https://www.louis.de/artikel/o-neal-element-racewear-crosshose/211874", image: "/gear/oneal-element-racewear.webp", },
      { name: "Fox 180 MX Hose",           type: "MX Hose",            priceMin: 60,  priceMax: 120, reason: "Leicht, robust, Bewegungsfreiheit" , url: "https://www.louis.de/artikel/fox-180-bnkr-crosshose/211642", image: "/gear/fox-180-mx-hose.webp", },
      { name: "Alpinestars Racer MX Pant", type: "MX Hose",            priceMin: 100, priceMax: 180, reason: "CE-Knieprotektoren, atmungsaktiv" , url: "https://www.louis.de/artikel/alpinestars-racer-graphite-crosshose/211754", image: "/gear/alpinestars-racer-mx-pant.webp", },
    ],
    ...universalGear,
  },
  Klassiker: {
    helmet: [
      { name: "Biltwell Gringo S",         type: "Integral Vintage",   priceMin: 120, priceMax: 220, reason: "Retro-Look, solider Schutz" },
      { name: "Hedon Heroine Racer",       type: "Integral Vintage",   priceMin: 400, priceMax: 700, reason: "Handgefertigt, Vintage-Optik, ECE" },
      { name: "Davida Ninety Two",         type: "Jethelm Klassisch",  priceMin: 500, priceMax: 800, reason: "Britisches Handwerk, zeitlos" },
    ],
    jacket: [
      { name: "Helstons Buscador",         type: "Lederjacke Retro",   priceMin: 180, priceMax: 320, reason: "Vintage-Stil, CE-Protektoren" },
      { name: "Belstaff Tourmaster",       type: "Gewachste Baumwolle", priceMin: 300, priceMax: 600, reason: "Ikonischer Retro-Stil, wasserfest" },
      { name: "Lewis Leathers Corsair",    type: "Café Racer Leder",   priceMin: 500, priceMax: 900, reason: "Britisches Heritage, CE zertifiziert" },
    ],
    gloves: [
      { name: "Biltwell Moto",             type: "Leder Kurzhandschuh", priceMin: 30, priceMax: 60,  reason: "Klassisch, günstig" },
      { name: "Weise Texas Touring",       type: "Leder Touring",      priceMin: 40,  priceMax: 80,  reason: "Klassischer Look, gute Haptik" },
      { name: "Held Classic",              type: "Premium Leder",      priceMin: 80,  priceMax: 150, reason: "Handgefertigt, Vintage-Passform" , url: "https://www.fc-moto.com/de-de/p/held-classic-rider-motorradhandschuhe-gelb-7-HE-022003-00-57-7", image: "/gear/held-classic.webp", },
    ],
    boots: [
      { name: "H-D Jett Boot",             type: "Urban Boot",         priceMin: 80,  priceMax: 150, reason: "Alltagsoptik mit Schutz" },
      { name: "Trialmaster Belstaff",      type: "Heritage Boot",      priceMin: 200, priceMax: 400, reason: "Zeitloses Design, Knöchelschutz" , url: "https://www.fc-moto.com/de-de/p/belstaff-trialmaster-motorrad-stiefel-braun-40-BST-105088BROWN40", image: "/gear/trialmaster-belstaff.webp", },
      { name: "Wesco Boss",                type: "Heritage Stiefel",   priceMin: 400, priceMax: 700, reason: "Amerikanisches Handwerk, ikonisch" },
    ],
    pants: [
      { name: "Büse Ferno Jeans",          type: "Motorradjeans",      priceMin: 80,  priceMax: 150, reason: "Alltagsoptik, CE-Level 1" , url: "https://www.amazon.de/dp/B081FD86H9", image: "/gear/buese-ferno-jeans.webp", },
      { name: "Helstons Corden Cargo",     type: "Lederhose Retro",    priceMin: 200, priceMax: 380, reason: "Vintage-Stil, CE-Protektoren" , url: "https://www.fc-moto.com/de-de/p/helstons-corden-armalith-motorrad-textilhose-khaki-30-HT-2021027-K-30-US", image: "/gear/helstons-corden-cargo.webp", },
      { name: "Belstaff Trousers",         type: "Heritage Hose",      priceMin: 250, priceMax: 450, reason: "Zeitloses Design, wasserfest" },
    ],
    ...universalGear,
  },
  Custom: {
    helmet: [
      { name: "Biltwell Gringo S",         type: "Integral Custom",    priceMin: 120, priceMax: 220, reason: "Flaches Profil, Custom-Culture" },
      { name: "Bell Bullitt",              type: "Jethelm Custom",     priceMin: 220, priceMax: 400, reason: "Klassischer Look, ECE 22.06" , url: "https://www.fc-moto.com/en-en/p/bell-bullitt-solid-helmet-black-matt-xs-54-55-BEL-8004720001", image: "/gear/bell-bullitt.webp", },
      { name: "Hedon Heroine Racer",       type: "Integral Premium",   priceMin: 400, priceMax: 700, reason: "Handgefertigt, Unikat-Looks" },
    ],
    jacket: [
      { name: "Helstons Buscador",         type: "Lederjacke Retro",   priceMin: 180, priceMax: 320, reason: "Vintage-Stil, CE-Protektoren" },
      { name: "Roland Sands Ronin",        type: "Lederjacke Custom",  priceMin: 250, priceMax: 450, reason: "CE-Level 1, Cafe-Racer Stil" },
      { name: "Deus Ex Machina Jacket",    type: "Custom Leder",       priceMin: 350, priceMax: 600, reason: "Cult-Brand, unique Aesthetik" },
    ],
    gloves: [
      { name: "Biltwell Moto",             type: "Leder Kurzhandschuh", priceMin: 30, priceMax: 60,  reason: "Ikonisch, günstig, guter Grip" },
      { name: "Held Classic",              type: "Leder Premium",      priceMin: 60,  priceMax: 120, reason: "Handgefertigt, elegantes Design" , url: "https://www.fc-moto.com/de-de/p/held-classic-rider-motorradhandschuhe-gelb-7-HE-022003-00-57-7", image: "/gear/held-classic.webp", },
      { name: "Roland Sands Gloves",       type: "Custom Leder",       priceMin: 80,  priceMax: 150, reason: "Café-Racer Style, CE-Level 1" },
    ],
    boots: [
      { name: "H-D Jett Boot",             type: "Urban Motorradboot", priceMin: 80,  priceMax: 150, reason: "Alltagsoptik mit CE-Knöchelschutz" },
      { name: "Trialmaster Belstaff",      type: "Heritage Boot",      priceMin: 200, priceMax: 400, reason: "Zeitloses Design, Knöchelschutz" , url: "https://www.fc-moto.com/de-de/p/belstaff-trialmaster-motorrad-stiefel-braun-40-BST-105088BROWN40", image: "/gear/trialmaster-belstaff.webp", },
      { name: "Wesco Boss",                type: "Heritage Stiefel",   priceMin: 400, priceMax: 700, reason: "Ikonisch, amerikanisches Handwerk" },
    ],
    pants: [
      { name: "Büse Ferno Jeans",          type: "Motorradjeans",      priceMin: 80,  priceMax: 150, reason: "Alltagsoptik, CE-Level 1" , url: "https://www.amazon.de/dp/B081FD86H9", image: "/gear/buese-ferno-jeans.webp", },
      { name: "Roland Sands Cargo Pant",   type: "Custom Hose",        priceMin: 180, priceMax: 300, reason: "Café-Racer Stil, CE-Knieprotektoren" },
      { name: "Helstons Corden Cargo",     type: "Lederhose Custom",   priceMin: 220, priceMax: 380, reason: "Vintage-Stil, CE-Level 2" , url: "https://www.fc-moto.com/de-de/p/helstons-corden-armalith-motorrad-textilhose-khaki-30-HT-2021027-K-30-US", image: "/gear/helstons-corden-cargo.webp", },
    ],
    ...universalGear,
  },
}

const fallbackGear = gearByStyle.Naked

export function getGear(bikeStyle) {
  return gearByStyle[bikeStyle] || fallbackGear
}
