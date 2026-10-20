# Verifiche e sviluppo

Le dipendenze di sviluppo si installano separatamente in `web-app/backend` e
`web-app/frontend`. Dalla radice del repository:

```powershell
npm --prefix web-app/backend run typecheck
npm --prefix web-app/backend test
npm --prefix web-app/frontend run build
npm --prefix web-app/frontend run test:pairs
```

I test backend coprono formule, calibrazione, uso singolo e segmenti, timestamp,
tag modello, import CSV, cartelle e cancellazione recuperabile. La build Angular
verifica anche i template con controllo strict. Un avviso di budget CSS va
distinto da un errore che interrompe la compilazione.

Per controllare i servizi da `web-app` senza mostrare la configurazione risolta
che potrebbe contenere segreti:

```powershell
docker compose config --quiet
docker compose ps
```

Controllare anche `/api/health` e la pagina frontend. Una build riuscita non
dimostra da sola che il database risponda o che le foto siano raggiungibili.

## Prova di integrazione isolata

Lo script [evo3-smoke.cjs](../backend/scripts/evo3-smoke.cjs) usa un database
temporaneo e immagini sintetiche. Con il servizio `db` attivo, da `web-app`:

```powershell
docker compose build api
$checksDir = (Resolve-Path backend/scripts).Path
docker compose run --rm --no-deps -v "${checksDir}:/checks:ro" --entrypoint node api /checks/evo3-smoke.cjs
```

Verifica import e aggiornamento CSV, minuti da percentuale e tariffa, rollback,
tag stabili, coppie atomiche, alert privati, riletture e recupero senza duplicati.
Controlla che il primo fallimento lasci solo alert e foto, e che una rilettura
fallita conservi entrambi gli snapshot e le foto precedentemente accettati.
Non importa screenshot reali. L'utente PostgreSQL configurato deve poter creare
e rimuovere il database temporaneo; lo script lo elimina alla fine.

Per modifiche al parser OCR rispettare anche la verifica dell'archivio reale
prevista dalle [regole comuni](../../AGENTS.md). Non confondere questa verifica
storica con il test sintetico dei servizi web.

## Diagnosi del selettore su immagini reali

Da `web-app`, con l'immagine API aggiornata:

```powershell
$checksDir = (Resolve-Path backend/scripts).Path
docker compose run --rm --no-deps -v "${checksDir}:/checks:ro" --entrypoint node api /checks/verify-model-ocr.cjs /data/projects/<nome>/to-process-img/<cartella>
```

Non sposta immagini né scrive nel database. Il rapporto distingue `MATCHED`,
`UNAVAILABLE` (variante assente) e `UNREADABLE`, con hash e passaggi concordi;
non contiene testo OCR completo o dati personali. `accepted` conta solo il
riconoscimento del modello, non la convalida completa di usage e timestamp.
Un terzo argomento facoltativo limita i file a nomi separati da virgole.
Salvare eventuali rapporti di progetti reali solo in cartelle ignorate da Git.

Il tema applicato è Warm Workbench. Il [mockup alternativo conservato](../mockups/03-aurora-glass.html)
è solo un riferimento. Per una verifica grafica con dati inventati è disponibile
[ui-fixture.mjs](../scripts/ui-fixture.mjs), che usa la build locale su porta 4411
e non l'account reale. Va avviato e fermato separatamente.

Torna all'[indice](README.md).
