# Diagnosi OCR del 21 ottobre 2026

Analisi di un `error_logs.json` locale con 10 alert, confrontati con le 20 foto
dei tentativi conservati in `unprocessed`. Report e prove reali rimangono
privati e ignorati da Git. Qui si riportano cause tecniche e risultati
aggregati, senza testo OCR completo, conversazioni o nomi dei progetti reali.

## Cause del report

| Messaggio precedente | Alert | Riscontro sulle foto |
| --- | ---: | --- |
| Tag immutabile contraddetto | 3 | Le nuove foto mostrano un modello diverso da quello archiviato. Le letture precedenti sono conservate. |
| Modelli diversi oppure reset incoerenti | 3 | Due coppie mostrano effettivamente modelli diversi; una aveva un falso salto del reset al giorno successivo. |
| Selettore modello/Fast non confermato | 1 | Le bande nere spostavano il selettore rispetto ai ritagli fissi. |
| Usage/reset senza accordo | 2 | Vecchia UI senza data visibile del reset settimanale. |
| Timestamp senza accordo | 1 | Immagine ricostruita con bande nere. La rilettura risolve il timestamp, ma rivela anche reset A/B diversi. |

I 10 alert erano storici: `tentativi` vuoto e `dettaglio_disponibile=false`.
Il solo JSON non permette di ricostruire i singoli passaggi originali. Le cause
sono state riprodotte sulle foto con il worker locale, senza scritture nel
database operativo.

## Correzioni nel worker principale

**Ritagli.** Il worker individua le bande orizzontali uniformi quasi nere e
calcola le coordinate rispetto al desktop effettivo. Se il ritaglio ampio del
timestamp non basta, prova trasformazioni dell'angolo Windows più stretto.
Servono sempre due letture concordi; orario del file e orario del PC non
sostituiscono quello visibile. Le date impossibili vengono rifiutate.

**Selettore.** I ritagli seguono il desktop effettivo. Un'etichetta localizzata
può fornire un ritaglio di riga che esclude microfono e pulsanti adiacenti.
Anche questa regione deve ottenere autonomamente almeno due letture concordi
di modello, reasoning e Fast. Non si sommano singoli voti di regioni diverse.

**Reset 5h.** Il pannello mostra ore e minuti, mentre il timestamp può avere i
secondi. Reset 18:10 e screenshot 18:10:24 restano nello stesso giorno. Con
residuo 0% si tollera inoltre il pannello esaurito rimasto visibile fino a 60
minuti dopo il reset. Il normale passaggio notturno resta valido. La tolleranza
A/B rimane 60 minuti: non viene allargata per accettare dati diversi.

**Vecchia UI.** Si riconoscono le etichette `Limite di 5 ore` e quelle
settimanali spezzate su più righe. Quando almeno due passaggi segnalano il reset
settimanale assente, l'alert chiede uno screenshot con quel dettaglio visibile.
Il motore non inventa una data per completare la rilevazione.

**Messaggi.** `PAIR_MODEL_MISMATCH` distingue modelli/reasoning diversi da
`PAIR_RESET_MISMATCH`, che riporta lo scarto in minuti. Il conflitto immutabile
indica modello letto e modello archiviato. Il JSON separa lo stato del tentativo
fallito da `stato_rilevazione_attuale` e aggiunge
`ultima_lettura_valida_conservata`: un archivio `VALIDATED` non rende valido il
nuovo tentativo fallito.

## Dati ancora da correggere

Le coppie con modelli diversi restano bloccate: la differenza di percentuale
non consente di attribuire tutta la sessione a un unico modello. Per una nuova
sessione usare un nuovo numero A/B, conservando il tag della sessione precedente.

Il timestamp della foto ricostruita ora viene letto, ma nel file iniziale era
rimasto il reset del template, diverso da quello della partenza: un errore
nella ricostruzione generata, non nella lettura di quel numero. È stata creata
una copia distinta con reset 20:41, mantenendo i valori dichiarati 3%/69%,
timestamp 17:55:24 e la dicitura di ricostruzione. Partenza e copia corretta
superano la verifica OCR della coppia. Originali e database operativo rimangono
invariati: la copia si può caricare esplicitamente come ricostruzione, distinta
da uno screenshot acquisito. Il worker non cambia i numeri dentro le foto.

## Riprova dal profilo

Accanto a **Debug**, **Riprova** riaccoda gli alert aperti dell'utente corrente.
Le foto vengono copiate in ingressi privati e processate dal normale worker.
Gli alert si chiudono solo dopo la convalida. Le letture valide precedenti
restano disponibili e vengono sostituite insieme solo dopo il successo A/B.
Un altro clic salta le coppie già accodate o in elaborazione.

I nuovi alert conservano i riferimenti a entrambe le foto anche dopo la
rimozione di una coppia mai convalidata. I vecchi alert potrebbero conservare
solo il percorso della foto principale e i nomi originali delle altre: questi
non identificano in sicurezza un file rinominato con UUID.
`RETRY_PAIR_REFERENCE_MISSING` chiede quindi un solo nuovo caricamento A/B.
Non si abbinano file per ordine, vicinanza temporale o somiglianza.
`RETRY_IMAGE_UNAVAILABLE` segnala una foto eliminata o non accessibile.

## Verifica

Sul campione dei tentativi falliti, la convalida completa della singola immagine
passa da 14/20 a 17/20; il solo selettore passa da 17/20 a 19/20. Le tre foto
ancora incomplete non mostrano il reset settimanale; una non mostra neppure il
nome del modello. Gli hash di tutte le 20 sorgenti sono invariati. Questi numeri
non equivalgono a 17 coppie accettate: i vincoli A/B e i tag precedenti rimangono
controlli separati. Due cause del report sono risolte; gli altri otto alert
richiedono dati coerenti o informazioni visibili aggiuntive.

Il confronto reale controlla hash invariati e accordi OCR senza importare le
foto. La regressione dell'app principale conferma tutte le 64 immagini già
convalidate: stessi valori di utilizzo, timestamp e tag, con hash invariati.
Typecheck, 52 test backend, integrazione e build Angular passano; rimane il
preesistente avviso sul budget CSS. La regressione del motore HTML separato verifica 29 immagini reali con
zero errori e zero timestamp rettificati. I test automatici coprono bande nere,
reset al minuto e notturni, pannelli incompleti, isolamento tra utenti,
riaccodamento, clic ripetuti, rinomina, riferimenti storici mancanti e
conservazione degli snapshot validi. Vedere la
[procedura di sviluppo](verifiche-sviluppo.md).

Torna all'[indice](README.md).
