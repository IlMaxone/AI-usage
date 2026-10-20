# Calibrazione e stime

Le osservazioni di fatturazione dichiarate dall'utente sono il metodo primario
quando disponibili. Il motore ricava il riferimento al 100% da percentuale
osservata, importo stimato fatturato, rapporto euro/crediti e sessione pilota
del modello con reasoning scelto. Queste dichiarazioni sono append-only in
`historical-data/billing-calibrations.jsonl` e rimangono distinte dalle letture OCR.

Le relazioni principali sono:

```text
valore al 100% = importo osservato / (percentuale osservata / 100)
euro per credito = euro del pacchetto / crediti del pacchetto
crediti al 100% = valore al 100% / euro per credito
tariffa pilota = euro pilota / minuti pilota
minuti pilota al 100% = valore al 100% / tariffa pilota
```

La percentuale usata di ogni screenshot si applica alla base calibrata.
Gli equivalenti token richiedono anche i rapporti crediti-per-milione delle
fonti online: input, cache e output sono scenari alternativi, non quantità
da sommare. I listini online senza calibrazione restano un confronto secondario.
Il settimanale conserva percentuale e reset, ma non viene convertito in costo
o token senza una capacità numerica affidabile.

## Crediti extra

Dalla cartella `html-ocr`, l'esempio seguente registra una dichiarazione utente
e rigenera i report senza OCR o accessi Internet:

```powershell
npm run credits:add -- GFP 500 20
```

Per specificare il momento esatto, aggiungere una data ISO 8601 con fuso:

```powershell
npm run credits:add -- GFP 500 20 2026-09-02T18:30:00+02:00
```

Con PowerShell: `./run-analysis.ps1 GFP -RecordExtraCredits -Credits 500 -PaidEur 20`,
eventualmente con `-PurchasedAt`. Senza data si registra il momento corrente.
Lo stesso timestamp, importo e numero di crediti non genera un duplicato.

Per regola esplicita di progetto tutti i crediti extra dichiarati sono
considerati già spesi, con residuo zero. Rimangono distinti dal piano e dalle
stime OCR. Le stime prodotte non sono addebiti ufficiali né misure ufficiali
dell'account. Il catalogo CSV dell'app principale non interviene in questi calcoli.

Torna all'[indice](README.md).
