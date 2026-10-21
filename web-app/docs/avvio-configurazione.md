# Avvio e configurazione

Richiede Docker Desktop attivo; l'avvio Windows e il selettore nativo richiedono
anche Node.js e PowerShell sul computer. Dalla radice entrare in `web-app`.
Al primo avvio creare il file di configurazione senza sovrascriverne uno esistente:

```powershell
cd web-app
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Modificare `.env`: sostituire `POSTGRES_PASSWORD` e `JWT_SECRET` con segreti
robusti, poi eseguire `npm run start:windows`. Aprire
[localhost:4400](http://localhost:4400), registrarsi o accedere. Il file `.env`
non deve essere pubblicato.

Il passaggio alle cartelle UUID richiede un nuovo accesso: i token precedenti
non identificano lo spazio utente. Le cartelle già associate al proprio account
vengono migrate; per un database già azzerato seguire il
[recupero dei progetti](progetti-utenti-recupero.md).

| Variabile | Uso e valore di esempio |
| --- | --- |
| `POSTGRES_DB`, `POSTGRES_USER` | Database e utente, predefiniti `ai_usage`. |
| `POSTGRES_PASSWORD`, `JWT_SECRET` | Segreti locali obbligatori. |
| `JWT_EXPIRES_IN` | Durata token, `15m`. |
| `API_PORT`, `FRONTEND_PORT` | Porte esposte, `3000` e `4400`. |
| `CORS_ORIGIN` | Origine browser consentita, `http://localhost:4400`. |
| `PUBLIC_API_URL` | URL API incorporato nella build frontend. |
| `MAX_UPLOAD_BYTES` | Limite per immagine, `10485760` byte. |
| `OCR_POLL_INTERVAL_MS` | Intervallo del ciclo worker, `2000` ms. |

## Avvio Windows e altre piattaforme

`start:windows` costruisce e ricrea API, worker e frontend, attende Docker e
avvia il selettore locale su `127.0.0.1:4410`. **Carica immagini** apre
`to-process` del progetto; una selezione da altre cartelle viene copiata, con
originali preservati. Il selettore verifica JWT, proprietario e origine.

Per diagnosi si può eseguire `npm run desktop:picker` in primo piano e fermarlo
con Ctrl+C. Il selettore avviato automaticamente resta in background fino alla
chiusura della sessione Windows. La porta 4410 deve essere disponibile.

Senza selettore Windows, usare da `web-app`:

```powershell
docker compose up --build -d --wait
```

Upload dal browser e scansione cartelle funzionano anche senza dialogo nativo.
`docker compose down` ferma lo stack conservando il volume database se non si
richiede la rimozione dei volumi. Non avvia o ferma il motore HTML OCR.

Dopo una modifica del CSV usare `npm run start:windows`, oppure riavviare l'API
già aggiornata con `docker compose restart api`. Il refresh del browser non
reimporta il catalogo. Le modifiche al codice o a `PUBLIC_API_URL` richiedono
invece una ricompilazione dei servizi interessati.

Torna all'[indice](README.md).
