# AI Usage

Applicazione locale per analizzare l'utilizzo AI da screenshot, con OCR locale,
progetti separati e calcoli basati sul catalogo CSV. L'app Docker è il percorso
principale; il precedente motore con report HTML rimane disponibile come
strumento secondario indipendente dentro [`html-ocr/`](html-ocr/).

## Avvio dell'app principale

Richiede Docker Desktop attivo. Dalla cartella `web-app`, preparare `.env`
seguendo il [README dell'app](web-app/README.md), poi eseguire:

```powershell
cd web-app
npm run start:windows
```

Aprire [l'app su localhost:4400](http://localhost:4400).
API, worker OCR, frontend e PostgreSQL hanno dipendenze e avvio propri.
Su Windows il pulsante **Carica immagini** apre il selettore nella cartella
`to-process` del progetto. Il motore storico non viene avviato da Docker.

## Struttura del repository

```text
web-app/                  app principale, Docker, API, worker e interfaccia
models/                   catalogo CSV e documentazione delle tariffe
projects/                 foto locali, escluse da Git salvo il demo inventato
html-ocr/                 motore secondario, dipendenze, cache, dati e documenti
AGENTS.md                 regole comuni per lo sviluppo
```

L'app salva lo stato nel database Docker. Per ogni progetto le immagini si
trovano in `projects/<nome>--<id>/to-process`, `processed` e `deleted`.
Le coppie seguono i nomi A1/B1, A2/B2, ecc. Si possono inserire anche offline:
il worker controlla le cartelle all'avvio e periodicamente. Il caricamento
singolo o multiplo di immagini singole rimane disponibile nell'app.

Almeno due letture OCR devono concordare per validare uso, reset e data/ora.
Un file dubbio resta in ingresso e richiede verifica manuale. Reinserire una
stessa immagine aggiorna l'OCR conservando traccia della lettura precedente.
**Elimina** conserva le foto in `deleted` per un eventuale recupero.

## Modelli e costi

[`models/models.csv`](models/models.csv) definisce i modelli disponibili, la
tariffa al minuto e `max_time_window_minutes`. La pagina **Modelli** è di sola
consultazione e mostra il logo OpenAI per i modelli del provider.
Il costo della finestra è fisso a 13,54 EUR. Il CSV viene riletto all'avvio:
dopo una modifica eseguire nuovamente `npm run start:windows` da `web-app`.

I valori come `93:03` indicano minuti:secondi. I minuti equivalenti usano il
limite esplicito, evitando errori dovuti alle tariffe arrotondate. Il modello
viene riconosciuto dallo screenshot; il tag assegnato è immutabile. Il badge
**Tag OCR immutabile** compare quando il modello ha ricevuto una prima
associazione OCR convalidata: la sua assenza non indica indisponibilità.
In **Analisi usage** l'interruttore esplorativo confronta temporaneamente altre
tariffe sugli stessi minuti equivalenti, senza salvare cambi al modello.

Vedere la [guida del catalogo](models/README.md) per formato, limiti e calcoli.

## Motore secondario HTML OCR

Codice, pacchetto npm, launcher PowerShell, dipendenze, cache OCR, registri JSONL,
fonti scaricate, report statici e documentazione storica sono raccolti in
[`html-ocr/`](html-ocr/). I file dati spostati mantengono il contenuto originale.
Il [documento originale](html-ocr/ai-usage-analytics.md) è conservato senza
modifiche al contenuto.

Le foto storiche restano nelle posizioni originali:
`projects/<nome>/to-process-img` e `projects/<nome>/processed-images`.
Il vecchio motore usa questi percorsi solo per le proprie foto; dati e report
sono ora in `html-ocr/projects/<nome>/`. Non usa il database, il CSV dei modelli
o i servizi dell'app e non esiste sincronizzazione tra i due flussi.

I vecchi comandi si eseguono esplicitamente da `html-ocr`, per esempio:

```powershell
cd html-ocr
npm run analyze:dry-run -- GFP
npm run verify:processed -- GFP
```

La [guida completa del motore secondario](html-ocr/README.md) contiene tutti i
rimandi a comandi e migrazione. Il [demo statico inventato](html-ocr/projects/demo/reports/dashboard.html)
resta consultabile senza server e senza JavaScript.

## Guide per argomento

I README dei due applicativi sono punti di ingresso sintetici. Le guide complete
sono suddivise in documenti brevi e indipendenti:

- [Documentazione dell'app principale](web-app/docs/README.md): configurazione,
  architettura, OCR, modelli, interfaccia, backup, verifiche e problemi.
- [Documentazione HTML OCR](html-ocr/docs/README.md): comandi, dati, convalida,
  calibrazione, fonti, report, migrazione e sviluppo.

## Dati privati e verifiche

Le cartelle reali in `projects/` e `html-ocr/projects/`, le dipendenze, le cache,
i modelli OCR, i backup e i file `.env` sono esclusi da Git. I soli progetti
versionabili sono i demo con dati inventati. Il testo OCR completo non viene
conservato e le stime rimangono distinte dai dati osservati o fatturati.

Il lavoro è sviluppato con il supporto di OpenAI Codex e richiede revisione
umana e verifiche proporzionate alle modifiche. Le regole comuni sono in
[`AGENTS.md`](AGENTS.md); la documentazione specifica resta accanto al rispettivo
applicativo.
