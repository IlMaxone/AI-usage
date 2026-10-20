# Caricamento e OCR

Creare un progetto dall'app. Per letture singole si può caricare uno screenshot
o un batch fino a 30 immagini per invio: ogni immagine è una rilevazione autonoma.
Il limite predefinito per file è 10 MiB, configurabile con `MAX_UPLOAD_BYTES`.
Il pulsante **Avvia convalida** mette gli upload in coda al worker.

## Coppie dalla UI o dalla cartella

In **Nuova lettura** selezionare **Coppie A/B**, poi **Carica file dall’app**.
Si possono selezionare fino a 60 immagini, ovvero 30 coppie. I nomi A1/B1,
A2/B2 determinano l'abbinamento anche in ordine misto; l'anteprima elenca le
coppie riconosciute. File mancanti, nomi estranei o numeri ambigui bloccano
l'invio fino alla correzione. **Avvia convalida** carica e accoda le coppie.
Il server ricontrolla l'abbinamento numerico indipendentemente dall'ordine inviato.

L'alternativa **Cartella del progetto** mantiene il flusso Windows e offline:

Depositare `A1.png` e `B1.png`, `A2.jpg` e `B2.jpg`, ecc., in
`projects/<nome>/to-process/`. A indica l'inizio, B la fine; il numero
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
Il controllo include la modalità Fast indicata dal fulmine. Un'etichetta letta
correttamente ma senza tariffa corrispondente produce un alert specifico con
modello, reasoning e modalità mancanti nel CSV; non un generico errore di lettura.

Un singolo mantiene l'uso corrente. Un segmento misura il delta A/B quando i
reset 5h differiscono al massimo di 60 minuti; oltre la tolleranza richiede
verifica manuale. Il reset settimanale segnala coerenza, rollover o spostamento,
ma non blocca da solo una misura. La data del segmento proviene da B.

Un tentativo non convalidato passa in `unprocessed`; se fallisce una metà, si
sposta l'intero tentativo A/B. **Profilo** conserva un alert con progetto, file
e motivo. Una coppia mai valida non compare nell'archivio e non conserva
riferimenti che impediscano di ricaricarla. I due risultati A/B vengono pubblicati
insieme: una sola metà convalidata non sostituisce la coppia precedente.
Una rilettura fallita mantiene snapshot e foto dell'ultima coppia valida.
Solo le coppie completamente accettate passano a `processed`.
Le foto si aprono dalla freccia **Screenshot** sotto ogni record in **Archivio usage**.
Consultare la motivazione di verifica prima di richiedere un nuovo tentativo.

## Riletture e correzioni

Reinserire lo stesso nome/ruolo o hash nel progetto riaccoda l'OCR senza duplicare
la rilevazione. Per le coppie contano numero e ruolo anche cambiando estensione.
La stessa foto in progetti diversi resta indipendente. Si può riprovare anche
lo stesso file senza modificarlo, ricaricandolo dalla UI o copiandolo in ingresso.
`unprocessed` non viene scandita automaticamente. Una nuova acquisizione valida
della stessa coppia risolve l'alert, anche dopo un aggiornamento dell'OCR.
Una foto già registrata viene riletta e sovrascrive lo snapshot corrente anche
se il contenuto è identico: non genera un alert di duplicato. I vecchi avvisi di
questo tipo vengono chiusi all'avvio; i file disponibili sono riaccodati, mentre
quelli eliminati restano inattivi fino a un nuovo caricamento.

Una nuova lettura valida aggiorna lo snapshot corrente e conserva il precedente
in `ocr_revisions`. Le correzioni manuali dei valori sono append-only e non
riscrivono lo snapshot OCR; quelle precedenti non prevalgono su una rilettura
successiva. Il tag modello già assegnato rimane immutabile.

Torna all'[indice](README.md) o consulta [stati e messaggi](interfaccia-stati.md).
