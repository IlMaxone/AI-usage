# OCR e convalida

Il motore cerca percentuali e reset nel pannello dei limiti, in una versione
ingrandita e normalizzata e, quando necessario, nell'immagine completa. Almeno
due passaggi devono concordare sulla firma dei valori prima dell'accettazione.

Data e ora sono riconosciute separatamente nell'angolo inferiore destro con tre
passaggi; almeno due devono concordare sul timestamp completo, secondi inclusi.
La zona oraria di riferimento è `Europe/Rome`. L'ora del file e quella di
esecuzione OCR sono informazioni tecniche e non sostituiscono il timestamp
visibile nello screenshot.

Il flusso normale è:

1. Leggere le foto da `projects/<nome>/to-process-img/`.
2. Calcolare SHA-256 e confrontarlo con lo storico per evitare duplicati.
3. Convalidare uso, reset e data/ora con letture concordi.
4. Acquisire o riutilizzare le fonti necessarie per le nuove osservazioni valide.
5. Aggiungere le rilevazioni ai JSONL, rigenerare i report e archiviare le foto
   accettate in `projects/<nome>/processed-images/`.

Il testo OCR completo non viene conservato. In caso di disaccordo la foto resta
in ingresso e viene richiesta verifica manuale. Se nessuna nuova immagine supera
la validazione non si registrano nuovi snapshot Internet. In un lotto misto,
le immagini valide possono essere elaborate mentre le altre restano in attesa.

Per controllare l'archivio, da `html-ocr`:

```powershell
npm run verify:processed -- GFP
```

La verifica riesegue l'OCR e confronta hash, uso, reset e timestamp con lo storico
effettivo, comprese le osservazioni temporali già registrate. Non scarica fonti,
non sposta foto e non modifica i dati di utilizzo.

Se servono rettifiche temporali convalidate, il comando dedicato è
`npm run verify:processed:repair-times -- GFP`. Aggiunge osservazioni in
`capture-time-observations.jsonl` e rigenera i report quando necessario; gli
snapshot originali restano intatti. Non usarlo come sostituto di un controllo
dell'immagine quando il timestamp è dubbio.

Torna all'[indice](README.md) o consulta [messaggi e problemi](verifiche-problemi.md).
