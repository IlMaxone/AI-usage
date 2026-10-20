# Cartelle locali dei progetti

L'app web crea automaticamente `nome-progetto--id/to-process/` e
`nome-progetto--id/processed/` e `nome-progetto--id/deleted/`. Queste cartelle e tutti i loro contenuti
rimangono privati ed esclusi da Git. Questo README rende visibile la radice.
`demo/` rimane l'unica eccezione versionata e contiene soltanto dati inventati.

Il precedente motore HTML OCR è ora isolato in [`../html-ocr/`](../html-ocr/).
Qui rimangono soltanto le sue cartelle foto `to-process-img/` e
`processed-images/`, conservate nelle posizioni originali. I relativi registri,
report e documenti sono in `html-ocr/projects/<nome>/`, separati da quelli
dell'app; il demo statico si trova in
[`../html-ocr/projects/demo/`](../html-ocr/projects/demo/).

Per i segmenti inserire `A1.png` e `B1.png`, `A2.png` e `B2.png`, ecc.
A è l'inizio, B la fine. Sono supportati PNG, JPEG e WebP, anche con estensioni
diverse nella stessa coppia. I numeri possono avere salti. Una coppia incompleta
rimane in attesa; nomi ambigui come `A1.png` e `A01.jpg` richiedono correzione.

Si possono depositare immagini mentre Docker è spento: il worker controlla le
cartelle all'avvio e periodicamente. Solo le immagini con almeno due letture OCR
concordi su usage, reset e timestamp vengono spostate in `processed/`.
I file da verificare rimangono in `to-process/`.

Reinserire lo stesso file riaccoda l'OCR e aggiorna la rilevazione esistente.
Le letture precedenti restano tracciate nel database, senza duplicare il consumo.
Non rinominare a mano le cartelle dei progetti né i file di `processed/`:
sono collegati al database. I dati del motore storico locale restano separati.

Il tasto **Elimina** rimuove la rilevazione dall'app e conserva gli screenshot
in `deleted/<id-rilevazione>/`, insieme a `manifest.json` con nomi e ruoli.
Per recuperare una coppia copia A e B nuovamente in `to-process/`; per una
lettura singola ricarica il file dall'app. Dopo il recupero viene eseguito un
nuovo OCR. L'archivio `deleted` non viene riprocessato automaticamente.
