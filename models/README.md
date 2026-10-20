# Catalogo dei modelli

`models.csv` è la fonte dei modelli disponibili e delle tariffe dell'app web.
Contiene i modelli disponibili, le tariffe e i limiti di utilizzo dichiarati.
Non contiene credenziali, dati personali o testo OCR e può essere versionato.

Modificare il CSV con l'app ferma, poi avviare dalla cartella `web-app`:

```powershell
npm run start:windows
```

L'avvio ricrea i servizi applicativi e rilegge il file, montato in sola lettura
nel container API. Anche un riavvio dell'API ricarica il catalogo. Aggiornare
soltanto la pagina del browser non importa un CSV modificato.

| Colonna | Significato |
| --- | --- |
| `key` | Identificatore del modello e reasoning, con lettere minuscole, numeri, punti, spazi e trattini. Non è il testo che l'OCR deve riprodurre. |
| `provider` | Provider, per esempio OpenAI. |
| `name` | Nome visibile nello screenshot, per esempio GPT-6 Astra. |
| `reasoning` | Variante, per esempio high, medium, xhigh o high fast. Il vecchio suffisso flash è un alias di Fast. |
| `currency` | EUR, fisso. |
| `five_hour_window_cost` | 13.54, fisso e comune a tutti i modelli. |
| `cost_per_minute` | Tariffa in EUR per minuto equivalente, maggiore di zero. |
| `max_time_window_minutes` | Limite di utilizzo nella finestra di 5h, maggiore di zero e massimo 300 minuti; accetta minuti:secondi (`93:03`) o minuti decimali (`93.05`). |
| `available` | true per renderlo disponibile; false per disabilitarlo. |

Le tariffe attuali sono arrotondate a quattro decimali e importate senza
ricalcolarle. È accettata anche la virgola decimale se il campo è racchiuso
tra virgolette, come `"0,1455"`.
Il separatore delle colonne è sempre la virgola. Il file deve essere UTF-8;
sono accettati BOM e righe Windows CRLF.

Per aggiungere un modello aggiungere una riga con una nuova `key`. Nome e
reasoning devono consentire un riconoscimento OCR univoco; non possono esserci
due righe che rappresentano la stessa etichetta. L'identità di una key già
importata non può cambiare: per un altro modello usare un'altra key.
Una key rinominata si ricollega allo stesso modello solo se provider, nome e
reasoning corrispondono univocamente e la vecchia key è assente dal file:
UUID e tag OCR sono preservati e la rinomina resta nell'audit.

Le tariffe possono essere aggiornate solo dal CSV: al prossimo avvio vengono
ricalcolati i risultati derivati, mantenendo gli stessi tag e snapshot OCR.
Le importazioni conservano hash SHA-256, timestamp e traccia delle tariffe
precedenti. Non sono importi osservati di fatturazione.

I minuti stimati sono `(usage attribuito / 100 × 13.54 EUR) / costo al minuto`.
La percentuale attribuita determina quindi costo e tempo. Il limite dichiarato
`max_time_window_minutes` resta consultabile nel catalogo; la stima usa la tariffa
al minuto importata, con il suo arrotondamento. Il confronto esplorativo applica
la tariffa alternativa agli stessi minuti originali. Gli aggregati oltre il
100% restano lineari; una tariffa nulla rende il tempo non calcolabile.

Un modello disabilitato o rimosso dal file scompare dal catalogo disponibile e
dai confronti. I suoi tag storici rimangono nel database; i risultati interessati
sono segnalati come non calcolabili, senza sostituire il modello originale.
Per riattivarlo ripristinare la stessa key e identità nel CSV.

Un file mancante, vuoto, malformato o ambiguo impedisce l'avvio dell'API. Tutto il
file viene validato prima della sincronizzazione e gli aggiornamenti sono
atomici: non si applicano soltanto alcune righe di un catalogo errato.

## Fast, Standard e provenienza

Il fulmine nel selettore indica **Fast mode**. È indipendente dal reasoning:
`high fast` significa high con fulmine, `high` significa high senza fulmine.
`Light` è il nome UI del livello `low`, distinto da medium e high. Il catalogo
conserva le etichette aggiornate dall'utente, compreso `xhigh fast`; il vecchio
suffisso `flash` resta leggibile per compatibilità e viene mostrato come Fast.
Non aggiungere sia `xhigh flash` sia `xhigh fast`, oppure sia `light` sia `low`,
per lo stesso modello: il catalogo rifiuta le etichette equivalenti.

Su richiesta dell'utente, le varianti mancanti sono stimate con:

```text
tariffa Fast = tariffa Standard × 2,5
tariffa Standard = tariffa Fast / 2,5
limite stimato = 13,54 / tariffa non arrotondata
```

I valori già presenti rimangono invariati. Quando disponibili, i rapporti fra
importo fatturato e durata dichiarati dall'utente sono la base non arrotondata;
altrimenti si usa la tariffa del CSV. Si arrotonda solo il risultato a quattro
decimali e il limite al secondo. Il costo della finestra resta 13,54 EUR.

Questa è una **convenzione di stima degli EUR/min**, che assume un lavoro
equivalente per minuto: non è una fattura osservata. La documentazione OpenAI
consultata il 20 ottobre 2026 indica 2,5× sui limiti inclusi nell'abbonamento,
2× sui crediti acquistati e 1,5× come aumento di velocità di GPT-5.6.
Non applicare retroattivamente questi rapporti agli addebiti dichiarati.
[Fonte ufficiale](https://learn.chatgpt.com/docs/agent-configuration/speed).

`calibration-observations.jsonl` conserva le dichiarazioni originali append-only,
distinguendo addebiti da stime sul piano. `catalog-derivations.jsonl` conserva
separatamente formule, basi e risultati derivati; non sostituisce il CSV come
fonte delle tariffe dell'app. Le rettifiche indicano il record precedente.
`external-sources.jsonl` conserva URL, timestamp e hash delle fonti consultate.

## Light e controllo Medium

I listini ufficiali Standard per milione di token sono comuni ai diversi
reasoning dello stesso modello: Sol 5.6 costa 4 USD input, 0,40 USD input in
cache e 20 USD output; Astra costa rispettivamente 10, 1 e 50 USD. Il rapporto
Astra/Sol è quindi 2,5 per tutte e tre le componenti. I prezzi riportati sono
per il contesto Standard fino a 272K input; non includono strumenti o cache write.
[Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol),
[Astra](https://developers.openai.com/api/docs/models/gpt-6-astra).

Questi listini **non determinano da soli un costo al minuto né la capienza del
piano Plus**. Il confronto in `token-price-comparison.csv` usa come controllo il
Medium dichiarato: 2,29 EUR / (14:52 minuti) = 0,1540358744 EUR/min, pari a
87:54 minuti equivalenti per la convenzione di 13,54 EUR. Il valore importato
rimane 0,1540 EUR/min.

Per stimare Light, l'utente ha fornito un confronto indicativo, non una fattura
o un benchmark verificato: Light 0,26 USD/task in 7,85 s, Medium 0,50 USD/task
in 11,97 s. Si rapportano costi **per unità di tempo**:

```text
fattore Light/Medium = (0,26 / 7,85) / (0,50 / 11,97) = 0,7929171975
Sol Light = Medium misurato × fattore = 0,1221 EUR/min
Astra Light = Sol Light × rapporto listini 2,5 = 0,3053 EUR/min
```

Il rapporto 0,26/0,50 da solo darebbe il costo relativo per task, non per minuto.
La durata end-to-end include già l'attesa iniziale: TTFT non va sommato ancora;
i token/s di output non misurano input, cache o reasoning. Si assume trasferibile
il profilo dei task della tabella; i risultati Light sono **stime provvisorie**.
Non si equiparano USD ed EUR: la valuta si elimina nei rapporti e la base
assoluta resta la calibrazione Medium in EUR. Non si stimano conteggi di token
osservati a partire dal solo budget.

Le varianti Fast seguono la convenzione 2,5× descritta sopra. Nuove misure reali
possono sostituire queste tariffe nel CSV, conservando le dichiarazioni e la
provenienza precedenti nei registri append-only.
