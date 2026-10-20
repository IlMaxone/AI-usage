# Verifiche e problemi

Eseguire i comandi da `html-ocr`. Per un controllo senza nuovi dati o rete:

```powershell
node --check scripts/analyze.mjs
node --check scripts/report-renderers.mjs
node scripts/analyze.mjs --project demo --dry-run --offline
```

`npm run demo:build` rigenera invece i report inventati. Dopo modifiche al parser
è obbligatorio eseguire `npm run verify:processed -- <nome>` su almeno un
progetto reale e controllare il riepilogo finale. Una verifica completa può
durare diversi minuti perché ogni immagine viene riletta più volte.

## Messaggi e azioni

| Messaggio o situazione | Significato e azione |
| --- | --- |
| `HTML OCR secondario` | Avvio del solo motore manuale, senza sincronizzazione Docker. |
| `Nessuna nuova immagine da elaborare` | Ingresso vuoto; in modalità normale i report possono essere rigenerati. |
| `Gia registrata` | Hash già presente: nessuna nuova osservazione duplicata. |
| `Da controllare manualmente` | OCR non convalidato; controllare la foto lasciata in ingresso. |
| `Verifica fallita` | Archivio non coerente con lettura o storico; esaminare il motivo prima di correggere. |
| Snapshot mancanti in modalità offline | Preparare fonti disponibili o effettuare un'esecuzione online quando appropriato. |
| Dipendenze mancanti | Installare da `html-ocr`, non dalla radice del repository. |

I codici di uscita sono 0 per completamento regolare, 1 per errore operativo e
2 per immagini o verifiche non superate. Il riepilogo include numero di immagini,
rettifiche temporali ed errori. Non sono previste notifiche desktop o notifiche
verso l'app principale.

Il launcher `./run-analysis.ps1 GFP -DryRun -Offline` cerca Node.js nel PATH
e nei percorsi Windows previsti, ma richiede le dipendenze locali del motore.
Usare un nome progetto valido e controllare i [percorsi foto](struttura-dati.md).
La modalità offline non sostituisce la cache linguistica OCR se questa manca.

Prima del commit verificare sintassi, link documentali e assenza di dati reali
nello staging. Le regole complete sono in [AGENTS.md](../AGENTS.md).

Torna all'[indice](README.md).
