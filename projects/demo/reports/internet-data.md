# Dati scaricati da Internet

Generato il: 2026-09-02T07:47:05.683Z

Ogni riga e uno snapshot indipendente. Prezzi espressi in USD per un milione di
token; i tassi crediti sono nell ordine input/cache/output.

| Scaricato il | Modello | Input | Cache | Output | Messaggi Plus / 5h | Crediti medi / messaggio | Crediti per 1M token | ID |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 2026-01-05T08:00:00.000Z | modello-demo | $3,00 | $0,30 | $15,00 | 20-80 | 4-20 | 120/12/600 | pricing-demo-2026-01-05 |

## Cambi BCE

Il tasso indica quante unita USD valgono 1 EUR; il reciproco e usato per
convertire i costi stimati da USD a EUR.

| Data tasso | Scaricato il | USD per EUR | EUR per USD | Fonte | ID |
| --- | --- | ---: | ---: | --- | --- |
| 2026-01-05 | 2026-01-05T08:00:02.000Z | 1,1000 | 0,9091 | https://example.invalid/demo-exchange-rate | exchange-rate-demo-2026-01-05 |

I tassi BCE sono pubblicati a scopo informativo e non rappresentano
necessariamente il cambio applicato a una transazione.

Le fonti complete, con URL, timestamp, hash e percorso della copia grezza, sono
conservate nei registri JSONL della cartella internet-data/.
