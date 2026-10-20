# Avvio e comandi

Richiede Node.js 24, npm e, per il launcher Windows, PowerShell. Il motore usa
Sharp e Tesseract locali: le foto non vengono inviate a servizi OCR esterni.

Dalla radice del repository, preparare le sole dipendenze di questo motore:

```powershell
cd html-ocr
npm install
```

I modelli linguistici vengono conservati in `html-ocr/ocr-cache/`. Il primo
utilizzo può richiedere un download; per lavorare senza rete preparare prima
cache OCR e snapshot Internet del progetto.

| Comando da `html-ocr` | Effetto |
| --- | --- |
| `npm run analyze -- GFP` | Analizza le nuove foto, acquisisce le fonti necessarie e aggiorna i report. |
| `npm run analyze:offline -- GFP` | Usa gli ultimi snapshot prezzi e cambio già disponibili. |
| `npm run analyze:dry-run -- GFP` | Esegue la convalida senza salvare rilevazioni o spostare foto. |
| `npm run verify:processed -- GFP` | Verifica l'archivio senza cambiare le rilevazioni. |
| `npm run verify:processed:repair-times -- GFP` | Aggiunge rettifiche temporali convalidate, senza riscrivere gli snapshot. |
| `npm run demo:build` | Rigenera offline i report dimostrativi. |

Per combinare esplicitamente offline e dry-run:

```powershell
node ./scripts/analyze.mjs --project GFP --dry-run --offline
```

`dry-run` può creare cartelle e cache tecniche e, senza `offline`, acquisire
fonti di rete. Non va interpretato come una modalità completamente priva di
accessi al filesystem o alla rete. `offline` richiede snapshot già presenti
quando servono nuove stime.

Il launcher equivalente è `./run-analysis.ps1 GFP`, con opzioni `-DryRun`,
`-Offline` e `-VerifyProcessed`. Dalla radice si può invece usare
`npm --prefix html-ocr run analyze -- GFP`.
Gli argomenti posizionali dopo `--` evitano che npm interpreti le opzioni del
programma come configurazioni proprie. Il nome progetto accetta lettere,
numeri, punti, trattini e underscore, con massimo 64 caratteri.

Gli acquisti extra sono descritti nella [guida alle stime](calibrazione-stime.md).
Torna all'[indice](README.md).
