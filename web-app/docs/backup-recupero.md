# Backup e recupero

Eseguire i comandi da `web-app`. Il database e le foto sono archivi diversi:
un dump SQL non contiene gli screenshot.

## Backup completo

```powershell
npm run db:backup
```

Il comando usa `pg_dump` sul servizio `db` e salva un file SQL con timestamp
in `web-app/backups/`, esclusa da Git. Non ferma lo stack e non modifica i dati.
Gli script di backup usano nomi di database e utente configurati localmente.

Per un insieme coerente di SQL e file, fermare temporaneamente le scritture di
API e worker, creare il dump lasciando `db` attivo e copiare le cartelle foto
`projects/<nome>/`, incluso `deleted`. Conservare anche l'eventuale vecchio
archivio `web-app/storage/uploads/`, il CSV e la configurazione locale in un
luogo privato. I dati di `html-ocr` hanno un [backup separato](../../html-ocr/docs/migrazione-privacy.md).

Il ripristino SQL è un'operazione manuale sul database scelto: interrompere le
scritture, importare il dump con `psql` usando utente e database corretti,
ripristinare le cartelle foto corrispondenti e riavviare lo stack. Non è previsto
un comando npm di restore. Prima di riprendere l'uso controllare health e galleria.

## Eliminazione dall'app

**Elimina rilevazione**, dopo la conferma, sposta prima le foto in
`deleted/<id-rilevazione>/`. Un `manifest.json` conserva nomi e ruoli; poi vengono
rimossi record e dati OCR collegati. In caso di errore SQL gli spostamenti sono
annullati. È una conservazione dei file, non un ripristino automatico dello
stato precedente nel database.

Per recuperare una coppia copiare A e B in `to-process`; per un singolo usare
l'upload dall'app. Il worker esegue una nuova convalida. `deleted` non viene
scansionato automaticamente. L'eliminazione di un progetto è logica e rimane
distinta dalla rimozione delle sue singole rilevazioni.

## Reset del database

**Il reset elimina il volume PostgreSQL e i suoi dati.** I comandi disponibili
sono `npm run db:reset` e `npm run db:reset:with-backup`; il secondo crea prima
il dump. Non eseguire il reset per risolvere un semplice problema OCR o un CSV
errato. Il controllo del volume atteso è `ai-usage-web_postgres-data`.

Le cartelle foto e `storage/uploads` non vengono cancellate dal reset, ma i
collegamenti nel database vanno persi. Le foto rimaste sul disco non sono un
sostituto del backup SQL e non ricreano automaticamente account e record.

Torna all'[indice](README.md).
