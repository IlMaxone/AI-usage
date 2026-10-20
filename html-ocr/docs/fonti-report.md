# Fonti e report

Quando una nuova immagine supera la validazione, la modalità online acquisisce
le fonti configurate nel motore: scheda API del modello, pagina dei piani e limiti
Codex e cambio giornaliero EUR/USD della BCE. Si tratta di input esterni alle
rilevazioni locali; le loro stime non rappresentano fatturazione osservata.

Ogni acquisizione conserva URL, timestamp e hash SHA-256 del contenuto. Gli
snapshot prezzi e cambio sono in `internet-data/`; le copie delle fonti sono
in `internet-data/raw/`. `offline` riutilizza gli ultimi snapshot disponibili e
segnala errore se mancano quelli necessari. Nessun nuovo snapshot Internet viene
registrato quando non ci sono nuove immagini valide.

## Output per progetto

Gli output si trovano in `html-ocr/projects/<nome>/reports/`:

| Output | Uso |
| --- | --- |
| `dashboard.html` | Lettura riassuntiva locale, con dati osservati e stime distinti. |
| `usage-history.md` | Storico dei valori estratti dalle immagini. |
| `billing-calibration.md`, `billing-estimates.md` | Dichiarazioni di fatturazione e risultati calibrati. |
| `extra-credit-purchases.md` | Acquisti extra dichiarati separatamente. |
| `internet-data.md`, `estimates.md` | Provenienza delle fonti e confronto basato sui listini. |
| `csv/` | Esportazioni di rilevazioni, fonti, acquisti, calibrazioni, stime e totali. |

I totali online evitano di contare più volte la stessa finestra di cinque ore:
usano la percentuale massima osservata nella finestra. Non applicare a questi
report la logica dei segmenti A/B dell'app principale.

La dashboard è un HTML autonomo con stile incorporato: non richiede server,
non contiene JavaScript, non usa endpoint e non carica risorse da Internet.
Può essere aperta direttamente dal filesystem. I collegamenti alle fonti
documentano la provenienza; non sono risorse caricate automaticamente.

Il [demo inventato](../projects/demo/reports/dashboard.html) si rigenera da
`html-ocr` con `npm run demo:build`. I JSONL sorgente non vengono riscritti:
sono rigenerabili i report derivati. Non pubblicare report dei progetti reali.

Torna all'[indice](README.md).
