# Stime derivate

Generato il: 2026-09-02T07:47:05.684Z

Le stime non sono misure di token realmente consumati. La capacita della finestra
di 5 ore e stimata moltiplicando l intervallo ufficiale di messaggi per
l intervallo ufficiale di crediti medi per messaggio. I token sono mostrati come
tre equivalenti separati perche input, cache e output consumano crediti a tassi
diversi; non devono essere sommati.

| Rilevazione | Usato 5h | Crediti stimati | Token equivalenti input | Token equivalenti cache | Token equivalenti output | Costo USD | Costo EUR | EUR per USD | Prezzi scaricati il |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 2026-01-05T09:15:00 | 20% | 16,00-320,00 | 133.333-2.666.667 | 1.333.333-26.666.667 | 26.667-533.333 | $0,40-$8,00 | EUR 0,36-EUR 7,27 | 0,9091 (2026-01-05) | 2026-01-05T08:00:00.000Z |
| 2026-01-05T12:00:00 | 55% | 44,00-880,00 | 366.667-7.333.333 | 3.666.667-73.333.333 | 73.333-1.466.667 | $1,10-$22,00 | EUR 1,00-EUR 20,00 | 0,9091 (2026-01-05) | 2026-01-05T08:00:00.000Z |
| 2026-01-06T16:30:00 | 70% | 56,00-1120,00 | 466.667-9.333.333 | 4.666.667-93.333.333 | 93.333-1.866.667 | $1,40-$28,00 | EUR 1,27-EUR 25,45 | 0,9091 (2026-01-05) | 2026-01-05T08:00:00.000Z |

## Totale senza doppio conteggio

Sono considerate 2 finestre di 5 ore distinte su 3 rilevazioni. Nella stessa finestra viene usata
soltanto la percentuale massima osservata.

- Crediti stimati: 100,00-2000,00
- Token equivalenti input: 833.333-16.666.667
- Token equivalenti cache: 8.333.333-166.666.667
- Token equivalenti output: 166.667-3.333.333
- Costo API equivalente: USD 2,50-50,00; EUR 2,27-45,45

La percentuale settimanale resta nello storico grezzo. Non viene convertita in
token o costo perche la fonte ufficiale non pubblica una capacita settimanale
numerica.
