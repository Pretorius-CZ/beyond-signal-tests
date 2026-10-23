# Beyond the Signal · herní boti

Automatičtí boti, kteří hrají **Beyond the Signal** v prohlížeči na různých zařízeních
a hledají chyby. Hru nijak nemění: čtou ji jen zvenku, stejně jako hráč.

## Co bot dělá

1. Otevře hru (výchozí: živý web), přeskočí intro a vstoupí na loď.
2. Prochází místnosti a otevírá další nedokončenou opravu (level).
3. Hraje match-3: vybírá tahy podle cílů levelu, rozbíjí kryty a odpaluje nabité dílky (boosty).
   Náboj umí i přesunout (výměnou s dílkem, který tím udělá kombinaci) a dovést ho tam, kde výbuch zasáhne nejvíc.
4. V posledních 3 tazích použije pomůcky (EMP, Beam, Laser). Když mu dojdou tahy,
   jednou se podívá na simulovanou reklamu za +5 tahů.
5. Na každé důležité obrazovce udělá screenshot a kontrolu:
   - tlačítka mimo obrazovku, zakrytá jiným prvkem, useknutá na okraji,
   - malé dotykové plochy (pod 24 px), oříznutý text, vodorovné posouvání stránky,
   - nesmysly v textu (`undefined`, `NaN`, `null`, `[object Object]`, nepřeložené klíče…).
6. Zapisuje chyby JavaScriptu, varování v konzoli a nenačtené soubory.

Boti hrají na `https://game.playbeyondthesignal.com/` (hlavní doména je teď web hry).
Do statistik ve hře boti ve výchozím stavu nic neposílají. Jak je tam pustit
a zároveň umět odfiltrovat, popisuje sekce Statistiky.

## Zařízení

iPhone SE, iPhone 15 Pro Max, Pixel 7, Galaxy S9+, telefon na šířku, iPad Mini,
notebook 1366×768, desktop 1920×1080 a v GitHub Actions navíc Firefox.
V GitHub Actions běží iPhony a iPady ve skutečném WebKitu (jádro Safari).
Seznam se upravuje v `playwright.config.js`.

## Statistiky: boti ve hře, ale odfiltrovatelní

Boti chodí na hru přes odkaz s UTM štítkem
`?utm_source=automated_test&utm_medium=bot&utm_campaign=qa_01`, takže v balance.html
uvidíš jejich návštěvy jako samostatnou kampaň.

Pokusy o levely ale UTM štítek nenesou. Aby boti nezkreslili dashboard obtížnosti, jsou dvě možnosti:

- **Bez `BOT_SEED` (výchozí):** odesílání do Supabase je zablokované, boti ve statistikách vůbec nejsou.
- **S `BOT_SEED`:** boti posílají data a každý vystupuje pod **pevnou identitou zařízení**
  (jedna na zařízení + jazyk + typ běhu). Jejich seznam je v souhrnu každého běhu
  („Identity botů“). V balance.html je **jednou označ jako testery**. Výchozí pohled je pak
  vynechá ze všeho a přepínačem „zahrnout testery“ je zobrazíš.

`BOT_SEED` je libovolný tajný text (např. dlouhé náhodné heslo). Ulož ho do
*Settings → Secrets and variables → Actions → New repository secret*. Dokud ho nezměníš,
identity botů zůstávají stejné.

Pozor: server přijme nejvýš 300 pokusů na zařízení za den. Denní kontrola a celá hra
proto mají oddělené identity.

## Celá hra

Workflow **Herní boti – celá hra** projde všechny levely od začátku do konce (teď 187;
počet si bot zjistí sám, při změně hry stačí upravit `EXPECTED_LEVELS` v workflow).
Každé zařízení běží ve vlastní souběžné úloze. Spouští se jen ručně.

- Prohraný level zkusí bot znovu (výchozí 3×). Když dojde energie, podívá se na
  simulovanou reklamu za +1 energii, jako hráč.
- Screenshot dělá u desky každého levelu a u každé prohry nebo chyby.
- Každých 10 levelů ukládá **uloženou pozici** (`reports/state/…-after-N.json`).
  Další běh jde pustit odtud: `START_STATE=reports/state/…-after-60.json`.
- Jeden průchod trvá 1,5–4 hodiny na zařízení (WebKit je pomalejší).

**Minuty GitHub Actions:** veřejný repozitář je má zdarma bez omezení. Soukromý má na
bezplatném účtu 2 000 minut měsíčně. Celá hra na 3 zařízeních spotřebuje asi 600 minut,
rychlá kontrola asi 25 minut. Při soukromém repozitáři proto pouštěj celou hru jen na
1–2 zařízeních, nebo jednou za 14 dní.

## Další kontroly (samostatné workflow)

Všechny se pouštějí ručně (*Actions → název → Run workflow*), kromě změn vzhledu.
Výsledek je v záložce *Summary* běhu a podrobně v příloze (*Artifacts*).

| Workflow | Co dělá | Trvá |
|---|---|---|
| **Kontrola – balanc levelů** | Simuluje každý level stovkykrát se zkušeným a s běžným hráčem (přímo kódem hry, bez prohlížeče). Ukáže, kolik % hráčů level vyhraje s danými tahy, a navrhne počet tahů pro cílovou úspěšnost (výchozí 75 %). Graf obtížnosti + tabulka. | 20–40 min |
| **Kontrola – opičák (netrpělivý hráč)** | Rychlé ťukání během animací, dvojklik, tahy prstem, otočení telefonu, odchod do jiné aplikace, Escape/Zpět, pomůcky, obnovení stránky. Po každém kontroluje, že deska a tahy dávají smysl. | 5–15 min |
| **Kontrola – čeština** | Najde texty bez českého překladu ve zdrojovém kódu hry a pak projde celou hru v češtině (každé zařízení souběžně) a hledá zbylou angličtinu a useknutý text. Do pole „levels“ jde zadat např. 8 pro rychlou kontrolu. | 2–4 h (rychlá 10 min) |
| **Kontrola – výkon a paměť** | Rychlost načtení (normálně i slabý telefon s 3G), plynulost, zaseknutí a jestli paměť roste s počtem levelů (únik). Jen Chromium. | 10–20 min |
| **Kontrola – přístupnost** | Automatická kontrola WCAG 2.2 (axe) hlavních obrazovek + ovládání klávesnicí. | 5–10 min |
| **Kontrola – slepý playtest (bot)** | Projde stránku playtest.html jako člověk: odehraje všech 200 testů co nejrychleji a ohodnotí je podle hvězd, které by dostal hráč (★★★ = Lehké, ★★ = Akorát, ★ nebo prohra = Těžké). Hodnocení zapíše do databáze s poznámkou „BOT“. Každé zařízení = jeden průchod. | 1,5–4 h |
| **Kontrola – změny vzhledu** | Každý den v 7:41 vyfotí stejné obrazovky a porovná je s minulým během. Změny ukáže vedle sebe (minule / teď / rozdíl). Dílky na desce a odpočet energie jsou při focení skryté. | 5–10 min |

Lokálně se vybírá sada proměnnou `SUITE` (`playthrough`, `chaos`, `czech`, `perf`, `a11y`, `visual`, `playtest`):

```bash
SUITE=chaos npx playwright test --project="Pixel 7 (Android)"
node scripts/suite-summary.mjs chaos
GAME_DIR=../TG_game SAMPLES=200 node scripts/balance.mjs && node scripts/balance-report.mjs
```

Pokud hra umí přesouvat náboje, balanc každý level zahraje i bez téhle možnosti a v reportu ukáže
„Dopad přesunu nábojů“: o kolik procent se díky pravidlu vyhrává častěji.

Adresu hry pro všechny kontroly jde změnit bez úpravy kódu: *Settings → Secrets and variables → Actions →
Variables → New repository variable* `GAME_URL` (např. `https://game.playbeyondthesignal.com/?utm_source=automated_test&utm_medium=bot&utm_campaign=qa_01`).

Balanc je odhad: simulovaný „běžný hráč“ je slabší než člověk a nepoužívá reklamy ani pomůcky.
Ber ho hlavně jako pořadí (které levely jsou nejtěžší / skoky v obtížnosti) a porovnej s reálnými daty v balance.html.

## Spuštění v GitHub Actions

1. Vytvoř **nový** repozitář, např. `beyond-signal-tests`, a nahraj do něj obsah téhle složky.
   Do repozitáře hry ho nedávej, ten už GitHub Pages používá pro samotnou hru.
2. (Volitelně) přidej secret `BOT_SEED`, viz výše.
3. *Settings → Pages → Source: GitHub Actions*.
4. *Actions → Herní boti – celá hra (nebo rychlá kontrola) → Run workflow*.
5. Kde co najdeš:
   - **souhrnná tabulka** je přímo na stránce běhu v záložce *Summary*,
   - **report se screenshoty celé hry**: `https://<účet>.github.io/beyond-signal-tests/`,
   - ostatní kontroly mají report v příloze běhu (*Artifacts*, rozbalit a otevřít `index.html`).
6. Automaticky (každý den) běží jen **změny vzhledu**, vše ostatní se pouští ručně.
   Když boti něco najdou, běh je červený nebo žlutý a GitHub ti pošle e-mail.

## Spuštění u sebe

```bash
npm ci
npx playwright install
npx playwright test                                   # proti živému webu
BASE_URL=http://127.0.0.1:5173/ npx playwright test   # proti lokální verzi (npm run dev ve hře)
npx playwright test --project="iPhone SE (malý telefon)" --headed   # jedno zařízení, s oknem
node scripts/summary.mjs                              # vytvoří reports/index.html
```

Na Windows se proměnné nastavují jinak, např. v PowerShellu: `$env:LEVELS=10; npx playwright test`.

| Proměnná | Výchozí | Význam |
|---|---|---|
| `BASE_URL` | živý web s UTM štítkem | adresa hry |
| `LEVELS` | 3 | kolik levelů bot zkusí projít, `all` = celá hra |
| `RETRIES` | 0 (celá hra 3) | kolikrát zkusit prohraný level znovu |
| `START_STATE` | – | pokračovat z uložené pozice |
| `SHOTS` | všechny | `key` = jen desky, prohry a chyby |
| `BOT_SEED` | – | zapne posílání do statistik pod pevnými identitami |
| `LANGS` | en | jazyky, např. `en,cs` |
| `USE_ADS` | 1 | `0` = bez simulované reklamy |
| `USE_HELPERS` | 1 | `0` = bez pomůcek, „čistá“ hratelnost |
| `CHARGE_SWAP` | 1 | `0` = bot nepřesouvá náboje (Pulse/Nova) výměnou s dílkem, jen je odpaluje |
| `WORKERS` | 4 | kolik prohlížečů hraje naráz |
| `VIDEO` | 0 | `1` = nahrávat video všech běhů |
| `AD_MAX_WAIT` | 120 | jak dlouho (s) bot nejvýš čeká, než reklama půjde zavřít |

## Reklamy

Bot zvládá okamžitou testovací reklamu, reklamu s odpočtem (čeká, než se odemkne nebo
objeví tlačítko „Zavřít“, „Získat odměnu“, „×“…) i skutečnou reklamní síť v testovacím režimu.
Nikdy nemačká „zrušit bez odměny“. Doba čekání se zapisuje do výsledků (`adSeconds`).

Pro jistotu může hra označit prvky reklamy atributy, pak je bot najde vždy:
`data-bot="ad"` na okně reklamy, `data-bot="ad-start"` na tlačítku spuštění a
`data-bot="ad-close"` na tlačítku zavření / převzetí odměny.

Boti nesmí sledovat ani proklikávat **ostré** reklamy (reklamní síť by to vyhodnotila
jako podvod). V testovacím provozu (UTM `automated_test`) má hra načítat reklamy
v testovacím režimu sítě.

## Struktura

- `lib/page-probe.js`: čtení desky z HTML, výběr tahu, kontroly obrazovky
- `lib/player.js`: ovládání hry (navigace, tahy, pomůcky, reklama)
- `tests/playthrough.spec.js`: scénář průchodu
- `tests/chaos|czech|perf|a11y|visual.spec.js`, `scripts/balance*.mjs`, `scripts/czech-static.mjs`, `scripts/visual-compare.mjs`, `scripts/suite-summary.mjs`: další kontroly
- `scripts/summary.mjs`: souhrn a HTML přehled
- `.github/workflows/game-tests.yml`: rychlá kontrola
- `.github/workflows/full-game.yml`: celá hra
- `site/index.html`: rozcestník reportů

## Poznámky

- Bot je „rozumný průměrný hráč“: vidí jen aktuální desku, nedívá se dopředu.
  Výsledek „vyhrál za 9/20 tahů“ ukazuje, že level je hratelný, nikoli kolik tahů je minimum.
  Statistiku na stovkách her dává tvůj `scripts/audit-balance.mjs` ve hře.
- Hra respektuje `prefers-reduced-motion`. Boti ho zapínají, aby byli rychlejší.
- Bot hledá prvky podle tříd v kódu hry (`data-cell`, `.hotspot`, `.win-panel`…).
  Při jejich přejmenování je potřeba upravit `lib/player.js`.
