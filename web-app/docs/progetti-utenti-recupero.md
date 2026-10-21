# Progetti, utenti e recupero delle cartelle

## Struttura privata

```text
projects/
├── .storage-key                       chiave locale, privata
├── .owners/                           riferimenti opachi di recupero
└── <UUID-spazio-utente>/
    └── <nome-normalizzato>--<UUID-progetto>/
        ├── .project.json              identità firmata del progetto
        ├── to-process/
        ├── processed/
        ├── unprocessed/
        └── deleted/
```

L'UUID dello spazio è distinto dall'account SQL: rimane stabile durante il
recupero anche se la registrazione dopo un reset genera un nuovo ID account.
Nome e colore restano leggibili nell'app. Il suffisso UUID identifica il
progetto; il nome nella cartella è limitato per contenere la lunghezza dei
percorsi Windows. Il percorso corretto è mostrato in Nuova lettura.

Due utenti possono creare entrambi `GFP`: le loro cartelle hanno UUID diversi.
Nello stesso account, nomi equivalenti dopo normalizzazione di maiuscole,
accenti e separatori vengono rifiutati. Le API di progetto, immagini, inbox,
notifiche e retry restano filtrate per proprietario. Il selettore Windows usa
il percorso restituito dall'API autenticata e rifiuta attraversamenti o link
verso un altro spazio. Le cartelle non sono risorse pubbliche del server.

## Cosa viene recuperato

L'app registra un `.project.json` firmato con ID, spazio proprietario, nome,
colore, percorso e stato di eliminazione. All'avvio, all'accesso, nella lista
progetti e nel ciclo del worker, i metadati validi dello spazio dell'utente
permettono di ricreare i progetti mancanti. La scansione è idempotente: conserva
l'UUID originale e non duplica progetti già presenti.

Un progetto eliminato conserva un metadato di eliminazione e non viene riaperto
automaticamente. Metadati alterati, spostati in un altro spazio, non firmati o
in conflitto vengono ignorati e richiedono verifica. Una cartella arbitraria
senza metadati non viene assegnata al primo account disponibile.

Il recupero ricrea i progetti, non il database delle rilevazioni: snapshot,
correzioni, tag e notifiche eliminati dal reset non tornano dalle sole foto.
`processed`, `unprocessed` e `deleted` restano conservate. Per nuovi test OCR
ricaricare A/B dalla UI o inserirle con i nomi originali in `to-process`.
Questa rimane l'unica cartella scandita automaticamente per importare immagini.

## Identità dopo un reset

Prima del reset, un accesso con email e password stabilisce il riferimento
locale al proprio spazio. Si usa una derivazione lenta della password e una
chiave locale: i file di recupero non contengono email, password in chiaro o
hash bcrypt. I riferimenti sono opachi e firmati; non sono un backup SQL.

Dopo il reset registrarsi con **la stessa email e password dell'ultimo accesso**.
L'app riconosce il riferimento e recupera esclusivamente quello spazio. Una
password o un'email diversa crea una nuova identità senza recuperare cartelle
altrui. Non si ricreano automaticamente account o credenziali.

All'aggiornamento da una versione precedente occorre accedere nuovamente: i
vecchi token senza l'identità dello spazio vengono rifiutati. Questo primo
accesso abilita anche il recupero dei vecchi account nei reset successivi.

Conservare **l'intera `projects/`**, compresi `.storage-key` e `.owners/`, quando
si trasferisce l'archivio. La chiave è generata una volta e rimane fuori da Git,
indipendente da `JWT_SECRET`. Senza chiave o riferimento non si tenta di
indovinare il proprietario. I normali backup SQL e delle foto restano separati.

## Cartelle delle vecchie versioni

Le cartelle con un proprietario ancora registrato vengono migrate con i
riferimenti DB e i manifest delle foto eliminate. Le foto storiche HTML OCR
in `to-process-img` e `processed-images` restano nella posizione originale.

Se il database è già stato azzerato, le vecchie cartelle piatte non conservano
il proprietario. Serve un'associazione locale esplicita a un account scelto;
non esiste un endpoint che consenta a qualunque account di reclamarle.
L'operazione autorizzata nel progetto corrente migra solo quelle confermate
dall'utente. I progetti successivi hanno già i metadati per il recupero.

## Verifiche

`private-projects-smoke.cjs` usa un database temporaneo e file inventati per
verificare omonimi fra utenti, blocco dei duplicati nello stesso account,
accessi negati, recupero idempotente, firme, reset simulati, credenziali diverse,
progetti eliminati, rinomina e migrazione senza spostare le foto HTML OCR.
I test dei percorsi Windows controllano anche i link e i percorsi non validi.

Nella verifica del 21 ottobre 2026 sono passati 52 test backend, entrambe le
prove integrate sulla build Docker finale, i test del selettore Windows e
del raggruppamento modelli. La migrazione locale ha conservato gli hash di
tutte le 84 immagini e ricreato cinque progetti senza importare rilevazioni.
La verifica separata dell'archivio HTML OCR ha confermato 29 immagini, senza
errori né correzioni ai timestamp.

Torna all'[indice](README.md).
