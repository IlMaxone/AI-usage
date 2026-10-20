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
| `key` | Identificatore del modello e reasoning, con lettere minuscole, numeri, punti e trattini. |
| `provider` | Provider, per esempio OpenAI. |
| `name` | Nome visibile nello screenshot, per esempio GPT-6 Astra. |
| `reasoning` | Variante, per esempio high. |
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

I minuti equivalenti sono `usage attribuito / 100 × max_time_window_minutes`.
Il limite dichiarato prevale sul rapporto tra costo finestra e tariffa, che
risentirebbe degli arrotondamenti. Il costo originale resta
`usage attribuito / 100 × 13.54 EUR`; il confronto esplorativo applica la tariffa
alternativa ai minuti equivalenti originali. Gli aggregati oltre il 100%
restano lineari: il limite indica la durata al 100% di una singola finestra.

Un modello disabilitato o rimosso dal file scompare dal catalogo disponibile e
dai confronti. I suoi tag storici rimangono nel database; i risultati interessati
sono segnalati come non calcolabili, senza sostituire il modello originale.
Per riattivarlo ripristinare la stessa key e identità nel CSV.

Un file mancante, vuoto, malformato o ambiguo impedisce l'avvio dell'API. Tutto il
file viene validato prima della sincronizzazione e gli aggiornamenti sono
atomici: non si applicano soltanto alcune righe di un catalogo errato.
