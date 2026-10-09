import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../src/js/app.js', import.meta.url), 'utf8')
const nav = readFileSync(new URL('../src/js/nav.js', import.meta.url), 'utf8')
const auth = readFileSync(new URL('../src/js/auth.js', import.meta.url), 'utf8')
const landing = readFileSync(new URL('../src/js/landing.js', import.meta.url), 'utf8')
const quiz = readFileSync(new URL('../src/js/quiz.js', import.meta.url), 'utf8')
const bikeDetail = readFileSync(new URL('../src/js/bike-detail.js', import.meta.url), 'utf8')
const map = readFileSync(new URL('../src/js/karte.js', import.meta.url), 'utf8')

test('direkte Motorrad- und geteilte Strecken-URLs werden vor gespeichertem Resume ausgewertet', () => {
  const direct = app.indexOf("const slug = params.get('motorrad')")
  const sharedRoute = app.indexOf("if (/[#&]strecke=/.test(window.location.hash))")
  const restore = app.indexOf('const saved = readRestoreState()')
  assert.ok(direct >= 0 && direct < restore)
  assert.ok(sharedRoute >= 0 && sharedRoute < restore)
})

test('ältere ?bike=-Direktlinks warten auf den Vollkatalog statt unvollständige Seed-Daten zu zeigen', () => {
  const direct = app.slice(app.indexOf("const bikeName = params.get('bike')"), app.indexOf('// Geteilte Strecke'))
  assert.match(direct, /Promise\.all\(\[ladeVollkatalog\(\), import\('\.\/garage\.js'\)\]\)/)
  assert.ok(direct.indexOf('ladeVollkatalog()') < direct.indexOf('findBikeByShortName(bikeName)'))
})

test('Resume speichert nur geprüfte öffentliche Ansichten dauerhaft und aktualisiert Tabwechsel', () => {
  assert.match(nav, /createResumeState\(\)/)
  assert.match(nav, /resumeState\.save\(top\.view, window\.scrollY\)/)
  assert.match(nav, /resumeState\.clear\(\)/)
  assert.match(readFileSync(new URL('../src/js/bike-detail.js', import.meta.url), 'utf8'), /updateCurrentView\(\{ screen: 'konfigurator', bike: data\.fullName, tab: tabName \}\)/)
})

test('Konfigurator-Resume wartet auf den Vollkatalog und erhält die technischen Quelldaten', () => {
  const branch = app.slice(app.indexOf("if (view.screen === 'konfigurator')"), app.indexOf("if (view.screen !== 'garage')"))
  assert.ok(branch.indexOf('await ladeVollkatalog()') >= 0)
  assert.ok(branch.indexOf('await ladeVollkatalog()') < branch.indexOf('findBikeByShortName(view.bike)'))
})

test('abgeschlossenes Match-Resume validiert gespeicherte Antworten gegen den Sieger', () => {
  const start = app.indexOf("if (view.screen === 'match-result')")
  const end = app.indexOf("if (view.screen === 'deckblatt')", start)
  const branch = app.slice(start, end)
  assert.ok(start >= 0 && end > start)
  assert.ok(branch.indexOf('await ladeVollkatalog()') < branch.indexOf('findBestBike(answers)'))
  assert.match(branch, /findBestBike\(answers\)\?\.name !== view\.bike/)
  assert.match(branch, /loadGarage\(answers\)/)
  const garage = readFileSync(new URL('../src/js/garage.js', import.meta.url), 'utf8')
  assert.match(garage, /screen: "match-result", bike: bikeData\.name/)
})

test('Quiz-Fortsetzung ist ausdrücklich wählbar und speichert keinen Auth-Zustand', () => {
  assert.match(landing, /hero-cta-resume/)
  assert.match(landing, /startQuiz\(true\)/)
  assert.match(quiz, /initQuiz\(\{ resume = false \} = \{\}\)/)
  assert.match(quiz, /quizProgress\.save\(currentQuestionIndex, answers\)/)
  assert.match(quiz, /quizProgress\.clear\(\)/)
})

test('wiederhergestellter Karten-Reiter fordert keinen Standort an; die Standorttaste bleibt ausdrücklich', () => {
  assert.match(app, /openKonfigurator\(bikeData, null, view\.tab, \{ restoring: true \}\)/)
  assert.match(bikeDetail, /bindKarteViewEvents\(\{ requestLocation: !restoring \}\)/)
  assert.match(bikeDetail, /initHubMap\(document\.querySelector\('\.konf-karte-hub \.hub-map'\), \{ requestLocation \}\)/)
  assert.match(map, /if \(!userLocationKnown && requestLocation\) getUserLocation\(\)/)
  assert.match(map, /else if \(requestLocation\) getUserLocation\(\)\.then/)
  assert.match(bikeDetail, /retryHubLocation\(\)/)
})

test('OAuth-Redirect bleibt auf dem aktuellen Ursprung und enthält keine freie Return-URL', () => {
  const oauth = auth.slice(auth.indexOf('function starteOAuth('), auth.indexOf('/**\n * Rendert fuer jeden eingeschalteten Anbieter'))
  assert.match(oauth, /redirectTo: window\.location\.origin \+ window\.location\.pathname/)
  assert.doesNotMatch(oauth, /searchParams\.get\(['"]return|redirectTo:\s*[^\n]*user/i)
})
