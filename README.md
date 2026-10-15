# Beyond the Signal · herní boti

Automatičtí boti, kteří hrají **Beyond the Signal** v prohlížeči na různých zařízeních
a hledají chyby. Hru nijak nemění: čtou ji jen zvenku, stejně jako hráč.

## Co bot dělá

1. Otevře hru (výchozí: živý web), přeskočí intro a vstoupí na loď.
2. Prochází místnosti a otevírá další nedokončenou opravu (level).
3. Hraje match-3: vybírá tahy podle cílů levelu, rozbíjí kryty a odpaluje nabité dílky (boosty).
4. V posledních 3 tazích použije pomůcky (EMP, Beam, Laser). Když mu dojdou tahy,
   jednou se podívá na simulovanou reklamu za +5 tahů.
5. Na každé důležité obrazovce udělá screenshot a kontrolu:
   - tlačítka mimo obrazovku, zakrytá jiným prvkem, useknutá na okraji,
   - malé dotykové plochy (pod 24 px), oříznutý text, vodorovné posouvání stránky,
   - nesmysly v textu (`undefined`, `NaN`, `null`, `[object Object]`, nepřeložené klíče…).
6. Zapisuje chyby JavaScriptu, varování v konzoli a nenačtené soubory.

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

Workflow **Herní boti – celá hra** projde všech 167 levelů od začátku do konce: každé
zařízení ve vlastní souběžné úloze, jednou týdně (neděle ráno) nebo ručně.

- Prohraný level zkusí bot znovu (výchozí 3×). Když dojde energie, podívá se na
  simulovanou reklamu za +1 energii, jako hráč.
- Screenshot dělá u desky každého levelu a u každé prohry nebo chyby.
- Každých 10 levelů ukládá **uloženou pozici** (`reports/state/…-after-N.json`).
  Další běh jde pustit odtud: `START_STATE=reports/state/…-after-60.json`.
- Jeden průchod trvá 1,5–4 hodiny na zařízení (WebKit je pomalejší).

**Minuty GitHub Actions:** veřejný repozitář je má zdarma bez omezení. Soukromý má na
bezplatném účtu 2 000 minut měsíčně. Celá hra na 3 zařízeních spotřebuje asi 600 minut,
denní kontrola asi 25 minut. Při soukromém repozitáři proto pouštěj celou hru jen na
1–2 zařízeních, nebo jednou za 14 dní.

## Spuštění v GitHub Actions

1. Vytvoř **nový** repozitář, např. `beyond-signal-tests`, a nahraj do něj obsah téhle složky.
   Do repozitáře hry ho nedávej, ten už GitHub Pages používá pro samotnou hru.
2. (Volitelně) přidej secret `BOT_SEED`, viz výše.
3. *Actions → Herní boti – denní kontrola → Run workflow*.
4. Po prvním běhu vznikne větev `gh-pages`. Nastav *Settings → Pages → Source:
   Deploy from a branch → `gh-pages` / root*. GitHub Pages u soukromého repozitáře
   vyžaduje placený účet (Pro). U bezplatného účtu buď repozitář zveřejni, nebo si report
   stahuj jako přílohu běhu (*Artifacts*).
5. Kde co najdeš:
   - **souhrnná tabulka** je přímo na stránce běhu v záložce *Summary*,
   - **report se screenshoty**: `https://<účet>.github.io/beyond-signal-tests/denni/`
     a `…/cela-hra/`,
   - **podrobný Playwright report** (video, trace krok po kroku) denní kontroly: `…/denni/playwright/`.
6. Denní kontrola běží každé ráno, celá hra každou neděli. Když boti něco najdou,
   běh je červený a GitHub ti pošle e-mail.

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
| `WORKERS` | 4 | kolik prohlížečů hraje naráz |
| `VIDEO` | 0 | `1` = nahrávat video všech běhů |

## Struktura

- `lib/page-probe.js`: čtení desky z HTML, výběr tahu, kontroly obrazovky
- `lib/player.js`: ovládání hry (navigace, tahy, pomůcky, reklama)
- `tests/playthrough.spec.js`: scénář průchodu
- `scripts/summary.mjs`: souhrn a HTML přehled
- `.github/workflows/game-tests.yml`: denní kontrola
- `.github/workflows/full-game.yml`: celá hra
- `site/index.html`: rozcestník reportů

## Poznámky

- Bot je „rozumný průměrný hráč“: vidí jen aktuální desku, nedívá se dopředu.
  Výsledek „vyhrál za 9/20 tahů“ ukazuje, že level je hratelný, nikoli kolik tahů je minimum.
  Statistiku na stovkách her dává tvůj `scripts/audit-balance.mjs` ve hře.
- Hra respektuje `prefers-reduced-motion`. Boti ho zapínají, aby byli rychlejší.
- Bot hledá prvky podle tříd v kódu hry (`data-cell`, `.hotspot`, `.win-panel`…).
  Při jejich přejmenování je potřeba upravit `lib/player.js`.
