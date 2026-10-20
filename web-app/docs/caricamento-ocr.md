# Caricamento e OCR

Creare un progetto dall'app. Per letture singole si può caricare uno screenshot
o un batch fino a 30 immagini per invio: ogni immagine è una rilevazione autonoma.
Il limite predefinito per file è 10 MiB, configurabile con `MAX_UPLOAD_BYTES`.
Il pulsante **Avvia convalida** mette gli upload in coda al worker.

## Coppie dalla cartella del progetto

Depositare `A1.png` e `B1.png`, `A2.jpg` e `B2.jpg`, ecc., in
`projects/<nome>--<id>/to-process/`. A indica l'inizio, B la fine; il numero
determina la coppia, indipendentemente dall'ordine. Sono supportati PNG, JPEG
e WebP, anche con estensioni diverse nella stessa coppia.

La numerazione può avere salti. Una coppia incompleta resta in attesa; nomi
equivalenti o ambigui come A1 e A01 richiedono correzione. **Carica immagini**
apre il selettore Windows nella cartella del progetto. Si possono anche copiare
le foto offline: il worker esegue una scansione all'avvio e circa ogni cinque
secondi, senza una sessione browser aperta. Le copie ancora in scrittura non
vengono importate.

## Convalida e misura

Il worker calcola SHA-256 e svolge tre letture locali della zona usage e tre
letture della data/ora in basso a destra. Servono almeno due passaggi concordi
per valori e reset e almeno due per il timestamp visibile. L'ora del file e
quella dell'esecuzione non sostituiscono il timestamp dello screenshot.
Il modello con reasoning richiede anche letture concordi del selettore in
fondo all'immagine, secondo la [guida modelli](modelli-costi.md).

Un singolo mantiene l'uso corrente. Un segmento misura il delta A/B quando i
reset 5h differiscono al massimo di 60 minuti; oltre la tolleranza richiede
verifica manuale. Il reset settimanale segnala coerenza, rollover o spostamento,
ma non blocca da solo una misura. La data del segmento proviene da B.

Un'immagine non convalidata resta in ingresso. Solo i file accettati passano a
`processed`; una metà già convalidata conserva il collegamento all'altra.
Consultare la motivazione di verifica prima di richiedere un nuovo tentativo.

## Riletture e correzioni

Reinserire lo stesso nome/ruolo o hash nel progetto riaccoda l'OCR senza duplicare
la rilevazione. La stessa foto in progetti diversi resta indipendente; non si
ricombinano metà di record diversi. Un tentativo non accettato non viene ripetuto
senza una modifica del file o una richiesta esplicita di convalida.

Una nuova lettura valida aggiorna lo snapshot corrente e conserva il precedente
in `ocr_revisions`. Le correzioni manuali dei valori sono append-only e non
riscrivono lo snapshot OCR; quelle precedenti non prevalgono su una rilettura
successiva. Il tag modello già assegnato rimane immutabile.

Torna all'[indice](README.md) o consulta [stati e messaggi](interfaccia-stati.md).
