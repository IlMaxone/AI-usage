function formatDecimal(value, digits = 2) {
  return new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatInteger(value) {
  return new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 }).format(value);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function displayLocalDate(value) {
  if (!value) return 'Non disponibile';
  const [date, time = ''] = value.split('T');
  const [year, month, day] = date.split('-');
  return day + '/' + month + '/' + year + (time ? ' · ' + time.slice(0, 8) : '');
}

function displayInstant(value, timeZone) {
  if (!value) return 'Non disponibile';
  return new Intl.DateTimeFormat('it-IT', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(value));
}

function csvCell(value) {
  return '"' + String(value ?? '').replaceAll('"', '""') + '"';
}

function csvDocument(headers, rows) {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(','));
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

export function estimateUsage(usage, pricing) {
  const messages = pricing.chatGptPlus.fiveHourLocalMessages;
  const average = pricing.chatGptPlus.averageCreditsPerMessage;
  const allowanceCredits = {
    min: messages.min * average.min,
    max: messages.max * average.max,
  };
  const usedRatio = usage.fiveHour.usedPct / 100;
  const usedCredits = {
    min: allowanceCredits.min * usedRatio,
    max: allowanceCredits.max * usedRatio,
  };
  const rates = pricing.creditsPerMillionTokens;
  const prices = pricing.apiPricesUsdPerMillionTokens;
  const usdPerCredit = [
    prices.input / rates.input,
    prices.cachedInput / rates.cachedInput,
    prices.output / rates.output,
  ];
  const equivalent = (rate) => ({
    min: usedCredits.min / rate * 1_000_000,
    max: usedCredits.max / rate * 1_000_000,
  });

  return {
    allowanceCredits,
    usedCredits,
    tokenEquivalent: {
      input: equivalent(rates.input),
      cachedInput: equivalent(rates.cachedInput),
      output: equivalent(rates.output),
    },
    apiCostUsd: {
      min: usedCredits.min * Math.min(...usdPerCredit),
      max: usedCredits.max * Math.max(...usdPerCredit),
    },
  };
}

export function deriveBillingCalibration(calibration) {
  if (!calibration) return null;
  const { planWindow, creditPack, billingObservations, pilot } = calibration;
  if (
    !planWindow || !Number.isFinite(planWindow.observedUsagePct) ||
    planWindow.observedUsagePct <= 0 || planWindow.observedUsagePct > 100 ||
    !Number.isFinite(planWindow.estimatedBilledEur) || planWindow.estimatedBilledEur <= 0 ||
    !creditPack || !Number.isFinite(creditPack.credits) || creditPack.credits <= 0 ||
    !Number.isFinite(creditPack.paidEur) || creditPack.paidEur <= 0 ||
    !Array.isArray(billingObservations) || billingObservations.length === 0 ||
    !pilot?.reasoning
  ) {
    throw new Error('Calibrazione di fatturazione non valida: ' + (calibration.id ?? 'ID mancante') + '.');
  }

  const observations = billingObservations.map((item) => {
    if (
      !item.reasoning || !Number.isFinite(item.durationSeconds) || item.durationSeconds <= 0 ||
      !Number.isFinite(item.billedEur) || item.billedEur <= 0
    ) {
      throw new Error('Osservazione di fatturazione non valida nella calibrazione ' + calibration.id + '.');
    }
    return {
      ...item,
      durationMinutes: item.durationSeconds / 60,
      eurPerMinute: item.billedEur / (item.durationSeconds / 60),
    };
  });
  const pilotObservation = observations.find((item) => (
    item.reasoning === pilot.reasoning &&
    (item.executionMode ?? null) === (pilot.executionMode ?? null)
  ));
  if (!pilotObservation) {
    throw new Error('Osservazione del pilota non trovata nella calibrazione ' + calibration.id + '.');
  }

  const fullWindowEur = planWindow.estimatedBilledEur / (planWindow.observedUsagePct / 100);
  const eurPerCredit = creditPack.paidEur / creditPack.credits;
  const fullWindowCredits = fullWindowEur / eurPerCredit;
  return {
    ...calibration,
    observations,
    pilotObservation,
    fullWindowEur,
    eurPerCredit,
    creditsPerEur: 1 / eurPerCredit,
    fullWindowCredits,
    fullWindowPilotMinutes: fullWindowEur / pilotObservation.eurPerMinute,
  };
}

export function selectBillingCalibration(calibrations) {
  if (calibrations.length === 0) return null;
  return deriveBillingCalibration(
    calibrations.slice().sort((a, b) => a.recordedAt.localeCompare(b.recordedAt)).at(-1),
  );
}

export function estimateCalibratedUsage(usage, calibration, pricing) {
  const derived = calibration?.fullWindowCredits === undefined
    ? deriveBillingCalibration(calibration)
    : calibration;
  if (!derived) return null;
  const usedRatio = usage.fiveHour.usedPct / 100;
  const usedCredits = derived.fullWindowCredits * usedRatio;
  const equivalent = (rate) => rate ? usedCredits / rate * 1_000_000 : null;
  return {
    usedRatio,
    usedCredits,
    equivalentEur: derived.fullWindowEur * usedRatio,
    pilotMinutes: derived.fullWindowPilotMinutes * usedRatio,
    tokenEquivalent: pricing ? {
      input: equivalent(pricing.creditsPerMillionTokens.input),
      cachedInput: equivalent(pricing.creditsPerMillionTokens.cachedInput),
      output: equivalent(pricing.creditsPerMillionTokens.output),
    } : null,
  };
}

export function selectUsageWindows(usages) {
  const byReset = new Map();
  for (const usage of usages) {
    const key = usage.fiveHour.resetsAtLocal;
    const current = byReset.get(key);
    if (
      !current ||
      usage.fiveHour.usedPct > current.fiveHour.usedPct ||
      (
        usage.fiveHour.usedPct === current.fiveHour.usedPct &&
        usage.capturedAtLocal > current.capturedAtLocal
      )
    ) {
      byReset.set(key, usage);
    }
  }
  return [...byReset.values()].sort(
    (a, b) => a.fiveHour.resetsAtLocal.localeCompare(b.fiveHour.resetsAtLocal),
  );
}

export function selectExchangeRate(usage, exchangeRateSnapshots) {
  if (exchangeRateSnapshots.length === 0) return null;
  const captureDate = usage.capturedAtLocal.slice(0, 10);
  const sorted = exchangeRateSnapshots
    .slice()
    .sort((a, b) => a.rateDate.localeCompare(b.rateDate) || a.fetchedAt.localeCompare(b.fetchedAt));
  const priorOrSame = sorted.filter((item) => item.rateDate <= captureDate);
  return priorOrSame.at(-1) ?? sorted[0];
}

export function aggregateTotals(usages, pricingSnapshots, exchangeRateSnapshots) {
  const pricingById = new Map(pricingSnapshots.map((item) => [item.id, item]));
  const windows = selectUsageWindows(usages);
  const totals = {
    windows: windows.length,
    includedWindows: 0,
    excludedWindows: 0,
    credits: { min: 0, max: 0 },
    tokenEquivalent: {
      input: { min: 0, max: 0 },
      cachedInput: { min: 0, max: 0 },
      output: { min: 0, max: 0 },
    },
    apiCostUsd: { min: 0, max: 0 },
    apiCostEur: { min: 0, max: 0 },
    exchangeRatesUsed: new Set(),
  };

  for (const usage of windows) {
    const pricing = pricingById.get(usage.pricingSnapshotId) ?? pricingSnapshots.at(-1);
    const exchangeRate = selectExchangeRate(usage, exchangeRateSnapshots);
    if (!pricing || !exchangeRate) {
      totals.excludedWindows += 1;
      continue;
    }
    const estimate = estimateUsage(usage, pricing);
    totals.includedWindows += 1;
    totals.credits.min += estimate.usedCredits.min;
    totals.credits.max += estimate.usedCredits.max;
    for (const kind of ['input', 'cachedInput', 'output']) {
      totals.tokenEquivalent[kind].min += estimate.tokenEquivalent[kind].min;
      totals.tokenEquivalent[kind].max += estimate.tokenEquivalent[kind].max;
    }
    totals.apiCostUsd.min += estimate.apiCostUsd.min;
    totals.apiCostUsd.max += estimate.apiCostUsd.max;
    totals.apiCostEur.min += estimate.apiCostUsd.min * exchangeRate.eurPerUsd;
    totals.apiCostEur.max += estimate.apiCostUsd.max * exchangeRate.eurPerUsd;
    totals.exchangeRatesUsed.add(exchangeRate.id);
  }

  return {
    ...totals,
    exchangeRatesUsed: [...totals.exchangeRatesUsed],
    sourceSnapshots: usages.length,
  };
}

export function aggregateCalibratedTotals(usages, calibrations, pricingSnapshots) {
  const calibration = selectBillingCalibration(calibrations);
  if (!calibration) return null;
  const pricingById = new Map(pricingSnapshots.map((item) => [item.id, item]));
  const windows = selectUsageWindows(usages);
  const totals = {
    calibration,
    windows: windows.length,
    sourceSnapshots: usages.length,
    usedCredits: 0,
    equivalentEur: 0,
    pilotMinutes: 0,
    tokenEquivalent: { input: 0, cachedInput: 0, output: 0 },
    tokenWindows: 0,
  };

  for (const usage of windows) {
    const pricing = pricingById.get(usage.pricingSnapshotId) ?? pricingSnapshots.at(-1);
    const estimate = estimateCalibratedUsage(usage, calibration, pricing);
    totals.usedCredits += estimate.usedCredits;
    totals.equivalentEur += estimate.equivalentEur;
    totals.pilotMinutes += estimate.pilotMinutes;
    if (estimate.tokenEquivalent) {
      totals.tokenWindows += 1;
      for (const kind of ['input', 'cachedInput', 'output']) {
        totals.tokenEquivalent[kind] += estimate.tokenEquivalent[kind];
      }
    }
  }
  return totals;
}

export function aggregateExtraCreditPurchases(purchases) {
  const totals = { count: purchases.length, credits: 0, paidEur: 0 };
  for (const item of purchases) {
    if (
      !Number.isInteger(item.credits) || item.credits <= 0 ||
      !Number.isFinite(item.paidEur) || item.paidEur <= 0 ||
      item.currency !== 'EUR' || Number.isNaN(Date.parse(item.purchasedAt))
    ) {
      throw new Error('Acquisto di crediti extra non valido: ' + (item.id ?? 'ID mancante') + '.');
    }
    totals.credits += item.credits;
    totals.paidEur += item.paidEur;
  }
  totals.paidEur = Math.round(totals.paidEur * 100) / 100;
  return totals;
}

export function aggregatePrimaryConsumption(usages, calibrations, pricingSnapshots, purchases) {
  const plan = aggregateCalibratedTotals(usages, calibrations, pricingSnapshots);
  const extra = aggregateExtraCreditPurchases(purchases);
  const pricing = pricingSnapshots.at(-1);
  if (!plan && extra.count === 0) return null;
  const extraTokenEquivalent = {
    input: pricing ? extra.credits / pricing.creditsPerMillionTokens.input * 1_000_000 : 0,
    cachedInput: pricing ? extra.credits / pricing.creditsPerMillionTokens.cachedInput * 1_000_000 : 0,
    output: pricing ? extra.credits / pricing.creditsPerMillionTokens.output * 1_000_000 : 0,
  };
  return {
    plan,
    extra,
    usedCredits: (plan?.usedCredits ?? 0) + extra.credits,
    spentEur: (plan?.equivalentEur ?? 0) + extra.paidEur,
    pilotMinutes: plan
      ? plan.pilotMinutes + extra.paidEur / plan.calibration.pilotObservation.eurPerMinute
      : null,
    tokenEquivalent: {
      input: (plan?.tokenEquivalent.input ?? 0) + extraTokenEquivalent.input,
      cachedInput: (plan?.tokenEquivalent.cachedInput ?? 0) + extraTokenEquivalent.cachedInput,
      output: (plan?.tokenEquivalent.output ?? 0) + extraTokenEquivalent.output,
    },
    tokenConversionAvailable: Boolean(pricing),
  };
}

export function renderUsageCsv(usages) {
  const headers = [
    'rilevazione_locale',
    'fuso_orario',
    'residuo_5h_percento',
    'usato_5h_percento',
    'reset_5h_locale',
    'residuo_settimanale_percento',
    'usato_settimanale_percento',
    'reset_settimanale_locale',
    'immagine',
    'sha256',
    'confidenza_ocr_percento',
    'origine_data',
    'modifica_file_utc',
  ];
  const rows = usages
    .slice()
    .sort((a, b) => a.capturedAtLocal.localeCompare(b.capturedAtLocal))
    .map((item) => [
      item.capturedAtLocal,
      item.timeZone,
      item.fiveHour.remainingPct,
      item.fiveHour.usedPct,
      item.fiveHour.resetsAtLocal,
      item.weekly.remainingPct,
      item.weekly.usedPct,
      item.weekly.resetsOnLocal,
      item.sourceImage,
      item.imageSha256,
      item.extraction.ocrConfidence,
      item.extraction.captureDateSource,
      item.extraction.sourceFileModifiedAt,
    ]);
  return csvDocument(headers, rows);
}

export function renderInternetCsv(pricingSnapshots) {
  const headers = [
    'scaricato_utc',
    'modello',
    'reasoning',
    'input_usd_per_milione',
    'cache_usd_per_milione',
    'output_usd_per_milione',
    'messaggi_5h_min',
    'messaggi_5h_max',
    'crediti_medi_messaggio_min',
    'crediti_medi_messaggio_max',
    'crediti_per_milione_input',
    'crediti_per_milione_cache',
    'crediti_per_milione_output',
    'capacita_settimanale',
    'url_prezzi',
    'scaricato_prezzi_utc',
    'url_limiti',
    'scaricato_limiti_utc',
    'snapshot_id',
  ];
  const rows = pricingSnapshots.map((item) => {
    const modelSource = item.sources.find((source) => source.kind === 'api-model-pricing');
    const planSource = item.sources.find((source) => source.kind === 'chatgpt-plan-limits');
    return [
      item.fetchedAt,
      item.model,
      item.reasoning,
      item.apiPricesUsdPerMillionTokens.input,
      item.apiPricesUsdPerMillionTokens.cachedInput,
      item.apiPricesUsdPerMillionTokens.output,
      item.chatGptPlus.fiveHourLocalMessages.min,
      item.chatGptPlus.fiveHourLocalMessages.max,
      item.chatGptPlus.averageCreditsPerMessage.min,
      item.chatGptPlus.averageCreditsPerMessage.max,
      item.creditsPerMillionTokens.input,
      item.creditsPerMillionTokens.cachedInput,
      item.creditsPerMillionTokens.output,
      item.chatGptPlus.weeklyCapacity ?? 'non pubblicata',
      modelSource?.url,
      modelSource?.fetchedAt,
      planSource?.url,
      planSource?.fetchedAt,
      item.id,
    ];
  });
  return csvDocument(headers, rows);
}

export function renderEstimatesCsv(usages, pricingSnapshots, exchangeRateSnapshots) {
  const pricingById = new Map(pricingSnapshots.map((item) => [item.id, item]));
  const headers = [
    'rilevazione_locale',
    'usato_5h_percento',
    'crediti_stimati_min',
    'crediti_stimati_max',
    'token_equivalenti_input_min',
    'token_equivalenti_input_max',
    'token_equivalenti_cache_min',
    'token_equivalenti_cache_max',
    'token_equivalenti_output_min',
    'token_equivalenti_output_max',
    'costo_api_usd_min',
    'costo_api_usd_max',
    'cambio_eur_per_usd',
    'costo_api_eur_min',
    'costo_api_eur_max',
    'data_tasso_bce',
    'cambio_scaricato_utc',
    'snapshot_cambio_id',
    'prezzi_scaricati_utc',
    'snapshot_prezzi_id',
  ];
  const rows = usages.map((item) => {
    const pricing = pricingById.get(item.pricingSnapshotId) ?? pricingSnapshots.at(-1);
    const exchangeRate = selectExchangeRate(item, exchangeRateSnapshots);
    if (!pricing || !exchangeRate) return [item.capturedAtLocal, item.fiveHour.usedPct];
    const estimate = estimateUsage(item, pricing);
    return [
      item.capturedAtLocal,
      item.fiveHour.usedPct,
      estimate.usedCredits.min,
      estimate.usedCredits.max,
      estimate.tokenEquivalent.input.min,
      estimate.tokenEquivalent.input.max,
      estimate.tokenEquivalent.cachedInput.min,
      estimate.tokenEquivalent.cachedInput.max,
      estimate.tokenEquivalent.output.min,
      estimate.tokenEquivalent.output.max,
      estimate.apiCostUsd.min,
      estimate.apiCostUsd.max,
      exchangeRate.eurPerUsd,
      estimate.apiCostUsd.min * exchangeRate.eurPerUsd,
      estimate.apiCostUsd.max * exchangeRate.eurPerUsd,
      exchangeRate.rateDate,
      exchangeRate.fetchedAt,
      exchangeRate.id,
      pricing.fetchedAt,
      pricing.id,
    ];
  });
  return csvDocument(headers, rows);
}

export function renderExchangeRatesCsv(exchangeRateSnapshots) {
  const headers = [
    'data_tasso_bce',
    'scaricato_utc',
    'valuta_base',
    'valuta_quotata',
    'usd_per_eur',
    'eur_per_usd',
    'fonte',
    'sha256',
    'file_grezzo',
    'snapshot_id',
    'nota',
  ];
  const rows = exchangeRateSnapshots.map((item) => [
    item.rateDate,
    item.fetchedAt,
    item.baseCurrency,
    item.quoteCurrency,
    item.usdPerEur,
    item.eurPerUsd,
    item.source.url,
    item.source.sha256,
    item.source.rawFile,
    item.id,
    item.note,
  ]);
  return csvDocument(headers, rows);
}

export function renderExtraCreditPurchasesCsv(purchases) {
  aggregateExtraCreditPurchases(purchases);
  const headers = [
    'acquistati_utc',
    'registrati_utc',
    'crediti_acquistati',
    'crediti_considerati_spesi',
    'residuo_assunto_crediti',
    'importo_pagato_eur',
    'eur_per_credito',
    'origine',
    'id',
  ];
  const rows = purchases
    .slice()
    .sort((a, b) => a.purchasedAt.localeCompare(b.purchasedAt))
    .map((item) => [
      item.purchasedAt,
      item.recordedAt,
      item.credits,
      item.credits,
      0,
      item.paidEur,
      item.paidEur / item.credits,
      item.source,
      item.id,
    ]);
  return csvDocument(headers, rows);
}

export function renderBillingCalibrationCsv(calibrations) {
  const headers = [
    'calibrazione_id',
    'registrata_utc',
    'modello',
    'pilota_reasoning',
    'osservazione_reasoning',
    'modalita_esecuzione',
    'durata_secondi',
    'durata_minuti',
    'fatturato_eur',
    'eur_per_minuto',
    'uso_piano_osservato_percento',
    'costo_osservato_eur',
    'valore_100_percento_eur',
    'crediti_pacchetto',
    'costo_pacchetto_eur',
    'eur_per_credito',
    'crediti_100_percento',
    'minuti_pilota_100_percento',
    'origine',
  ];
  const rows = calibrations.flatMap((item) => {
    const derived = deriveBillingCalibration(item);
    return derived.observations.map((observation) => [
      derived.id,
      derived.recordedAt,
      derived.model,
      derived.pilot.reasoning,
      observation.reasoning,
      observation.executionMode ?? 'standard',
      observation.durationSeconds,
      observation.durationMinutes,
      observation.billedEur,
      observation.eurPerMinute,
      derived.planWindow.observedUsagePct,
      derived.planWindow.estimatedBilledEur,
      derived.fullWindowEur,
      derived.creditPack.credits,
      derived.creditPack.paidEur,
      derived.eurPerCredit,
      derived.fullWindowCredits,
      derived.fullWindowPilotMinutes,
      derived.source,
    ]);
  });
  return csvDocument(headers, rows);
}

export function renderBillingEstimatesCsv(usages, calibrations, pricingSnapshots, purchases = []) {
  const calibration = selectBillingCalibration(calibrations);
  const pricingById = new Map(pricingSnapshots.map((item) => [item.id, item]));
  const headers = [
    'rilevazione_locale',
    'usato_5h_percento',
    'crediti_calibrati_usati',
    'valore_calibrato_eur',
    'minuti_equivalenti_pilota',
    'token_equivalenti_input',
    'token_equivalenti_cache',
    'token_equivalenti_output',
    'calibrazione_id',
    'snapshot_prezzi_id',
    'origine_consumo',
  ];
  const usageRows = calibration ? usages.map((usage) => {
    const pricing = pricingById.get(usage.pricingSnapshotId) ?? pricingSnapshots.at(-1);
    const estimate = estimateCalibratedUsage(usage, calibration, pricing);
    return [
      usage.capturedAtLocal,
      usage.fiveHour.usedPct,
      estimate.usedCredits,
      estimate.equivalentEur,
      estimate.pilotMinutes,
      estimate.tokenEquivalent?.input,
      estimate.tokenEquivalent?.cachedInput,
      estimate.tokenEquivalent?.output,
      calibration.id,
      pricing?.id,
      'piano_calibrato',
    ];
  }) : [];
  const latestPricing = pricingSnapshots.at(-1);
  const purchaseRows = purchases.map((purchase) => [
    purchase.purchasedAt,
    null,
    purchase.credits,
    purchase.paidEur,
    calibration ? purchase.paidEur / calibration.pilotObservation.eurPerMinute : null,
    latestPricing ? purchase.credits / latestPricing.creditsPerMillionTokens.input * 1_000_000 : null,
    latestPricing ? purchase.credits / latestPricing.creditsPerMillionTokens.cachedInput * 1_000_000 : null,
    latestPricing ? purchase.credits / latestPricing.creditsPerMillionTokens.output * 1_000_000 : null,
    calibration?.id,
    latestPricing?.id,
    'crediti_extra_gia_spesi',
  ]);
  return csvDocument(headers, [...usageRows, ...purchaseRows]);
}

export function renderTotalsCsv(
  usages,
  pricingSnapshots,
  exchangeRateSnapshots,
  purchases = [],
  calibrations = [],
) {
  const totals = aggregateTotals(usages, pricingSnapshots, exchangeRateSnapshots);
  const calibrated = aggregateCalibratedTotals(usages, calibrations, pricingSnapshots);
  const primary = aggregatePrimaryConsumption(usages, calibrations, pricingSnapshots, purchases);
  const purchased = aggregateExtraCreditPurchases(purchases);
  const headers = [
    'metodo_primario',
    'calibrazione_id',
    'crediti_totali_spesi',
    'costo_totale_eur',
    'minuti_totali_equivalenti_pilota',
    'token_totali_input',
    'token_totali_cache',
    'token_totali_output',
    'crediti_piano_calibrati',
    'valore_piano_calibrato_eur',
    'acquisti_extra_dichiarati',
    'crediti_extra_acquistati_e_spesi',
    'importo_extra_pagato_eur',
    'finestre_5h_distinte',
    'rilevazioni_sorgente',
    'finestre_incluse',
    'finestre_escluse',
    'crediti_stimati_min',
    'crediti_stimati_max',
    'token_equivalenti_input_min',
    'token_equivalenti_input_max',
    'token_equivalenti_cache_min',
    'token_equivalenti_cache_max',
    'token_equivalenti_output_min',
    'token_equivalenti_output_max',
    'costo_api_usd_min',
    'costo_api_usd_max',
    'costo_api_eur_min',
    'costo_api_eur_max',
    'snapshot_cambio_usati',
    'metodo',
  ];
  const rows = [[
    primary ? 'fatturazione_dichiarata_piu_crediti_extra_spesi' : 'non_disponibile',
    calibrated?.calibration.id,
    primary?.usedCredits,
    primary?.spentEur,
    primary?.pilotMinutes,
    primary?.tokenEquivalent.input,
    primary?.tokenEquivalent.cachedInput,
    primary?.tokenEquivalent.output,
    calibrated?.usedCredits,
    calibrated?.equivalentEur,
    purchased.count,
    purchased.credits,
    purchased.paidEur,
    totals.windows,
    totals.sourceSnapshots,
    totals.includedWindows,
    totals.excludedWindows,
    totals.credits.min,
    totals.credits.max,
    totals.tokenEquivalent.input.min,
    totals.tokenEquivalent.input.max,
    totals.tokenEquivalent.cachedInput.min,
    totals.tokenEquivalent.cachedInput.max,
    totals.tokenEquivalent.output.min,
    totals.tokenEquivalent.output.max,
    totals.apiCostUsd.min,
    totals.apiCostUsd.max,
    totals.apiCostEur.min,
    totals.apiCostEur.max,
    totals.exchangeRatesUsed.join('|'),
    'Piano: una rilevazione massima per finestra 5h. Crediti extra: considerati interamente spesi.',
  ]];
  return csvDocument(headers, rows);
}

function chartMarkup(usages) {
  const values = usages.slice().sort((a, b) => a.capturedAtLocal.localeCompare(b.capturedAtLocal));
  if (values.length === 0) {
    return '<div class="empty">Nessuna rilevazione disponibile.</div>';
  }

  const width = 960;
  const height = 320;
  const left = 58;
  const right = 28;
  const top = 28;
  const bottom = 54;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const x = (index) => values.length === 1
    ? left + chartWidth / 2
    : left + index * chartWidth / (values.length - 1);
  const y = (value) => top + (100 - value) * chartHeight / 100;
  const points = (selector) => values
    .map((item, index) => x(index).toFixed(1) + ',' + y(selector(item)).toFixed(1))
    .join(' ');
  const grid = [0, 25, 50, 75, 100].map((value) => {
    const py = y(value).toFixed(1);
    return '<line x1="' + left + '" y1="' + py + '" x2="' + (width - right) +
      '" y2="' + py + '"/><text x="' + (left - 12) + '" y="' + (Number(py) + 5) +
      '" text-anchor="end">' + value + '%</text>';
  }).join('');
  const circles = (selector, className, label) => values.map((item, index) => {
    const value = selector(item);
    return '<circle class="' + className + '" cx="' + x(index).toFixed(1) +
      '" cy="' + y(value).toFixed(1) + '" r="6"><title>' +
      escapeHtml(displayLocalDate(item.capturedAtLocal) + ' — ' + label + ': ' + value + '%') +
      '</title></circle>';
  }).join('');
  const labelStep = Math.max(1, Math.ceil(values.length / 6));
  const labels = values.map((item, index) => {
    if (index % labelStep !== 0 && index !== values.length - 1) return '';
    return '<text class="x-label" x="' + x(index).toFixed(1) + '" y="' + (height - 20) +
      '" text-anchor="middle">' + escapeHtml(
        item.capturedAtLocal.slice(8, 10) + '/' + item.capturedAtLocal.slice(5, 7),
      ) + '</text>';
  }).join('');

  return [
    '<div class="chart-wrap">',
    '<svg class="chart" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-labelledby="chart-title chart-desc">',
    '<title id="chart-title">Andamento della percentuale utilizzata</title>',
    '<desc id="chart-desc">Confronto tra utilizzo nella finestra di cinque ore e utilizzo settimanale.</desc>',
    '<g class="grid">' + grid + '</g>',
    '<polyline class="line line-five" points="' + points((item) => item.fiveHour.usedPct) + '"/>',
    '<polyline class="line line-week" points="' + points((item) => item.weekly.usedPct) + '"/>',
    circles((item) => item.fiveHour.usedPct, 'point point-five', '5 ore usato'),
    circles((item) => item.weekly.usedPct, 'point point-week', 'Settimanale usato'),
    '<g class="axis-labels">' + labels + '</g>',
    '</svg>',
    '</div>',
  ].join('');
}

function historyRows(usages) {
  return usages
    .slice()
    .sort((a, b) => b.capturedAtLocal.localeCompare(a.capturedAtLocal))
    .map((item) => {
      const isDemo = item.extraction.engine === 'demo';
      const dateFromOcr = item.extraction.captureDateSource === 'ocr';
      const timeFromOcr = (item.extraction.captureTimeSource ?? item.extraction.captureDateSource) === 'ocr';
      const dateSource = isDemo
        ? 'Dato dimostrativo inventato'
        : dateFromOcr && timeFromOcr
        ? 'Data e ora lette dallo screenshot'
        : dateFromOcr
          ? 'Data OCR · ora ricavata dal file'
          : timeFromOcr
            ? 'Data dal file · ora OCR'
            : 'Data e ora ricavate dal file';
      return [
        '<tr>',
        '<td><strong>' + escapeHtml(displayLocalDate(item.capturedAtLocal)) + '</strong><span class="sub">' +
          escapeHtml(dateSource) + '</span></td>',
        '<td><div class="bar"><span class="bar-five" style="width:' + item.fiveHour.usedPct +
          '%"></span></div><span class="metric">' + item.fiveHour.usedPct + '% usato</span></td>',
        '<td><div class="bar"><span class="bar-week" style="width:' + item.weekly.usedPct +
          '%"></span></div><span class="metric">' + item.weekly.usedPct + '% usato</span></td>',
        '<td>' + escapeHtml(displayLocalDate(item.fiveHour.resetsAtLocal)) + '</td>',
        '<td>' + escapeHtml(displayLocalDate(item.weekly.resetsOnLocal)) + '</td>',
        '<td>' + formatDecimal(item.extraction.ocrConfidence) + '%</td>',
        '</tr>',
      ].join('');
    }).join('');
}

function estimateRows(usages, pricingSnapshots, exchangeRateSnapshots) {
  const pricingById = new Map(pricingSnapshots.map((item) => [item.id, item]));
  return usages
    .slice()
    .sort((a, b) => b.capturedAtLocal.localeCompare(a.capturedAtLocal))
    .map((item) => {
      const pricing = pricingById.get(item.pricingSnapshotId) ?? pricingSnapshots.at(-1);
      const exchangeRate = selectExchangeRate(item, exchangeRateSnapshots);
      if (!pricing || !exchangeRate) return '';
      const estimate = estimateUsage(item, pricing);
      const range = (value) => formatInteger(value.min) + '–' + formatInteger(value.max);
      return [
        '<tr>',
        '<td>' + escapeHtml(displayLocalDate(item.capturedAtLocal)) + '</td>',
        '<td>' + formatDecimal(estimate.usedCredits.min) + '–' + formatDecimal(estimate.usedCredits.max) + '</td>',
        '<td>' + range(estimate.tokenEquivalent.input) + '</td>',
        '<td>' + range(estimate.tokenEquivalent.cachedInput) + '</td>',
        '<td>' + range(estimate.tokenEquivalent.output) + '</td>',
        '<td><strong>$' + formatDecimal(estimate.apiCostUsd.min) + '–$' +
          formatDecimal(estimate.apiCostUsd.max) + '</strong></td>',
        '<td><strong>€' + formatDecimal(estimate.apiCostUsd.min * exchangeRate.eurPerUsd) +
          '–€' + formatDecimal(estimate.apiCostUsd.max * exchangeRate.eurPerUsd) + '</strong></td>',
        '<td>' + formatDecimal(exchangeRate.eurPerUsd, 4) +
          '<span class="sub">Tasso ' + escapeHtml(exchangeRate.rateDate) + '</span></td>',
        '<td>' + escapeHtml(displayInstant(pricing.fetchedAt, item.timeZone)) + '</td>',
        '</tr>',
      ].join('');
    }).join('');
}

function displayDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return minutes + ':' + String(remainingSeconds).padStart(2, '0');
}

function billingObservationRows(calibration) {
  if (!calibration) return '';
  return calibration.observations.map((item) => [
    '<tr>',
    '<td><strong>' + escapeHtml(item.reasoning) + '</strong><span class="sub">' +
      escapeHtml(item.executionMode ?? 'standard') + '</span></td>',
    '<td>' + displayDuration(item.durationSeconds) + '</td>',
    '<td>€' + formatDecimal(item.billedEur) + '</td>',
    '<td><strong>€' + formatDecimal(item.eurPerMinute, 4) + '</strong></td>',
    '</tr>',
  ].join('')).join('');
}

function calibratedUsageRows(usages, calibration, pricingSnapshots) {
  if (!calibration) return '';
  const pricingById = new Map(pricingSnapshots.map((item) => [item.id, item]));
  return usages
    .slice()
    .sort((a, b) => b.capturedAtLocal.localeCompare(a.capturedAtLocal))
    .map((usage) => {
      const pricing = pricingById.get(usage.pricingSnapshotId) ?? pricingSnapshots.at(-1);
      const estimate = estimateCalibratedUsage(usage, calibration, pricing);
      return [
        '<tr>',
        '<td>' + escapeHtml(displayLocalDate(usage.capturedAtLocal)) + '</td>',
        '<td>' + usage.fiveHour.usedPct + '%</td>',
        '<td><strong>' + formatDecimal(estimate.usedCredits) + '</strong></td>',
        '<td><strong>€' + formatDecimal(estimate.equivalentEur) + '</strong></td>',
        '<td>' + formatDecimal(estimate.pilotMinutes) + ' min</td>',
        '<td>' + (estimate.tokenEquivalent ? formatInteger(estimate.tokenEquivalent.input) : 'N/D') + '</td>',
        '<td>' + (estimate.tokenEquivalent ? formatInteger(estimate.tokenEquivalent.output) : 'N/D') + '</td>',
        '</tr>',
      ].join('');
    }).join('');
}

function extraCreditRows(purchases, timeZone) {
  return purchases
    .slice()
    .sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt))
    .map((item) => [
      '<tr>',
      '<td><strong>' + escapeHtml(displayInstant(item.purchasedAt, timeZone)) +
        '</strong><span class="sub">' +
        (item.source === 'demo' ? 'Dato dimostrativo inventato' : 'Dichiarato manualmente') +
        '</span></td>',
      '<td><strong>' + formatInteger(item.credits) + '</strong></td>',
      '<td><strong>€' + formatDecimal(item.paidEur) + '</strong></td>',
      '<td>€' + formatDecimal(item.paidEur / item.credits, 4) + '</td>',
      '</tr>',
    ].join(''))
    .join('');
}

function sourceRows(pricingSnapshots, exchangeRateSnapshots, timeZone) {
  const pricingRows = pricingSnapshots
    .slice()
    .sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt))
    .map((item) => item.sources.map((source) => [
      '<tr>',
      '<td>' + escapeHtml(displayInstant(source.fetchedAt, timeZone)) + '<span class="sub">' +
        escapeHtml(source.fetchedAt) + '</span></td>',
      '<td>' + escapeHtml(source.kind === 'api-model-pricing' ? 'Prezzi API' : 'Piano e limiti') + '</td>',
      '<td><a href="' + escapeHtml(source.url) + '" target="_blank" rel="noreferrer noopener">' +
        escapeHtml(source.url.replace(/^https:\/\//, '')) + '</a></td>',
      '<td><code>' + escapeHtml(source.sha256.slice(0, 16)) + '…</code></td>',
      '</tr>',
    ].join('')).join('')).join('');
  const exchangeRows = exchangeRateSnapshots
    .slice()
    .sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt))
    .map((item) => [
      '<tr>',
      '<td>' + escapeHtml(displayInstant(item.fetchedAt, timeZone)) + '<span class="sub">' +
        escapeHtml(item.fetchedAt) + '</span></td>',
      '<td>Cambio BCE<span class="sub">Tasso del ' + escapeHtml(item.rateDate) + '</span></td>',
      '<td><a href="' + escapeHtml(item.source.url) +
        '" target="_blank" rel="noreferrer noopener">' +
        escapeHtml(item.source.url.replace(/^https:\/\//, '')) + '</a></td>',
      '<td><code>' + escapeHtml(item.source.sha256.slice(0, 16)) + '…</code></td>',
      '</tr>',
    ].join('')).join('');
  return pricingRows + exchangeRows;
}

export function renderDashboard(usages, pricingSnapshots, exchangeRateSnapshots, timeZone, options = {}) {
  const projectName = options.projectName ?? 'Progetto';
  const extraCreditPurchases = options.extraCreditPurchases ?? [];
  const billingCalibrations = options.billingCalibrations ?? [];
  const isDemo = projectName.toLowerCase() === 'demo';
  const sorted = usages.slice().sort((a, b) => a.capturedAtLocal.localeCompare(b.capturedAtLocal));
  const latest = sorted.at(-1);
  const latestPricing = pricingSnapshots.at(-1);
  const latestExchangeRate = exchangeRateSnapshots.at(-1);
  const totals = aggregateTotals(usages, pricingSnapshots, exchangeRateSnapshots);
  const calibration = selectBillingCalibration(billingCalibrations);
  const calibrated = aggregateCalibratedTotals(usages, billingCalibrations, pricingSnapshots);
  const primary = aggregatePrimaryConsumption(
    usages,
    billingCalibrations,
    pricingSnapshots,
    extraCreditPurchases,
  );
  const purchased = aggregateExtraCreditPurchases(extraCreditPurchases);
  const purchasedWindowEquivalents = calibration && purchased.credits > 0
    ? purchased.credits / calibration.fullWindowCredits
    : null;
  const generatedAt = new Date().toISOString();
  const priceAgeHours = latestPricing
    ? Math.floor((Date.now() - new Date(latestPricing.fetchedAt).getTime()) / 3_600_000)
    : null;
  const freshnessClass = priceAgeHours !== null && priceAgeHours <= 168 ? 'ok' : 'warn';
  const freshnessText = priceAgeHours === null
    ? 'Nessun dato Internet'
    : priceAgeHours <= 24
      ? 'Aggiornati oggi'
      : 'Aggiornati ' + Math.floor(priceAgeHours / 24) + ' giorni fa';
  const prices = latestPricing?.apiPricesUsdPerMillionTokens;
  const decimalRange = (value, prefix = '') =>
    prefix + formatDecimal(value.min) + '–' + prefix + formatDecimal(value.max);
  const integerRange = (value) => formatInteger(value.min) + '–' + formatInteger(value.max);

  return [
    '<!doctype html>',
    '<html lang="it">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; img-src data:;">',
    '<title>Report locale utilizzo AI · ' + escapeHtml(projectName) + '</title>',
    '<style>',
    ':root{--night:#111816;--panel:#19201d;--soft:#232d29;--white:#edf4ef;--muted:#a9b5ae;--lime:#d9ff43;--blue:#495eff;--line:#34413b;--danger:#ffb35c;color-scheme:dark}',
    '*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--night);color:var(--white);font-family:Arial,Helvetica,sans-serif;line-height:1.5}',
    'a{color:var(--lime);text-underline-offset:3px}a:focus-visible{outline:3px solid var(--blue);outline-offset:4px}',
    '.shell{width:min(1040px,calc(100% - 64px));margin:auto}.hero{padding:54px 0 34px;border-bottom:1px solid var(--line);background:radial-gradient(circle at 90% 10%,rgba(73,94,255,.2),transparent 34%)}',
    '.eyebrow{display:flex;gap:10px;align-items:center;color:var(--lime);font-size:.78rem;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.dot{width:9px;height:9px;border-radius:50%;background:var(--lime);box-shadow:0 0 18px var(--lime)}',
    'h1{max-width:760px;margin:18px 0 10px;font-family:Georgia,serif;font-size:clamp(2.5rem,7vw,5.6rem);font-weight:400;line-height:.93;letter-spacing:-.045em}h1 em{color:var(--lime);font-style:normal}',
    '.lead{max-width:740px;color:var(--muted);font-size:1.06rem}.status-row,.downloads,.legend{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}.pill,.download{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:999px;padding:8px 13px;background:var(--panel);font-size:.82rem}.pill.ok{border-color:rgba(217,255,67,.45);color:var(--lime)}.pill.warn{border-color:rgba(255,179,92,.55);color:var(--danger)}',
    '.download{text-decoration:none;font-weight:700;background:var(--lime);border-color:var(--lime);color:var(--night)}.download.secondary{background:transparent;color:var(--white);border-color:var(--line)}',
    'main{padding:34px 0 70px}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.card{min-height:150px;padding:20px;border:1px solid var(--line);background:var(--panel);border-radius:18px}.card.accent{background:var(--lime);color:var(--night);border-color:var(--lime)}.card.blue{background:var(--blue);border-color:var(--blue)}',
    '.label{display:block;font-size:.74rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;opacity:.72}.value{display:block;margin-top:14px;font-family:Georgia,serif;font-size:clamp(2rem,4vw,3.25rem);line-height:1}.context{display:block;margin-top:12px;font-size:.82rem;opacity:.74}',
    '.section{margin-top:42px}.section-head{display:flex;justify-content:space-between;align-items:end;gap:24px;margin-bottom:16px}.section h2{margin:0;font-family:Georgia,serif;font-size:clamp(1.8rem,4vw,3rem);font-weight:400}.section-copy{max-width:560px;margin:6px 0 0;color:var(--muted)}',
    '.panel{border:1px solid var(--line);background:var(--panel);border-radius:20px;overflow:hidden}.chart-wrap{padding:16px;overflow:auto}.chart{display:block;min-width:620px;width:100%;height:auto}.grid line{stroke:var(--line);stroke-width:1}.grid text,.axis-labels text{fill:var(--muted);font:13px Arial}.line{fill:none;stroke-width:5;stroke-linecap:round;stroke-linejoin:round}.line-five{stroke:var(--lime)}.line-week{stroke:var(--blue)}.point{stroke:var(--night);stroke-width:3}.point-five{fill:var(--lime)}.point-week{fill:var(--blue)}',
    '.legend{margin:0}.key{display:inline-flex;gap:8px;align-items:center;color:var(--muted);font-size:.82rem}.key::before{content:\"\";width:22px;height:4px;border-radius:3px;background:var(--lime)}.key.week::before{background:var(--blue)}',
    '.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;min-width:860px}th,td{padding:15px 17px;text-align:left;border-bottom:1px solid var(--line);vertical-align:middle}th{color:var(--muted);font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;background:#151d1a}tbody tr:hover{background:rgba(217,255,67,.035)}tbody tr:last-child td{border-bottom:0}.sub{display:block;margin-top:3px;color:var(--muted);font-size:.74rem}.metric{display:block;margin-top:6px;font-size:.78rem;color:var(--muted)}',
    '.bar{width:130px;height:8px;background:#303b36;border-radius:10px;overflow:hidden}.bar span{display:block;height:100%;border-radius:inherit}.bar-five{background:var(--lime)}.bar-week{background:var(--blue)}',
    '.totals-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.total{padding:22px;border:1px solid var(--line);border-radius:18px;background:var(--panel)}.total strong{display:block;margin:12px 0 6px;font-family:Georgia,serif;font-size:clamp(1.65rem,3vw,2.65rem);font-weight:400;line-height:1.05}.total.money{background:var(--lime);border-color:var(--lime);color:var(--night)}.total.euro{background:var(--blue);border-color:var(--blue)}',
    '.price-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.price{padding:24px;border:1px solid var(--line);border-radius:18px;background:var(--panel)}.price strong{display:block;margin:12px 0 5px;font-family:Georgia,serif;font-size:2.7rem;font-weight:400}.price.cache strong{color:var(--lime)}.price.output strong{color:#8e9cff}',
    '.note{margin-top:14px;padding:16px 18px;border-left:4px solid var(--lime);background:rgba(217,255,67,.07);color:var(--muted)}.note strong{color:var(--white)}code{color:#c8d0cb;font-size:.8rem}.empty{padding:34px;color:var(--muted)}',
    'footer{padding:28px 0 40px;border-top:1px solid var(--line);color:var(--muted);font-size:.82rem}',
    '@media(max-width:900px){.shell{width:min(100% - 40px,1040px)}.cards{grid-template-columns:repeat(2,1fr)}.totals-grid{grid-template-columns:repeat(2,1fr)}.price-grid{grid-template-columns:1fr}.section-head{display:block}.legend{margin-top:12px}}@media(max-width:560px){.shell{width:min(100% - 20px,1040px)}.hero{padding-top:34px}.cards,.totals-grid{grid-template-columns:1fr}.card{min-height:130px}h1{font-size:2.8rem}.downloads{display:grid}.download{justify-content:center}}',
    '@media print{body{background:white;color:#111}.hero{background:none}.panel,.card,.price{background:white;color:#111;border-color:#bbb}.download{display:none}.section{break-inside:avoid}.muted,.section-copy,.sub,.metric,footer{color:#555}}',
    '</style>',
    '</head>',
    '<body>',
    '<header class="hero"><div class="shell">',
    '<div class="eyebrow"><span class="dot"></span>Report statico · ' + escapeHtml(projectName) + '</div>',
    '<h1>Uso AI, <em>senza supposizioni.</em></h1>',
    '<p class="lead">Percentuali dagli screenshot, osservazioni di fatturazione dichiarate, prezzi online e risultati derivati restano distinti. Questa pagina non invia dati e non richiede un server.</p>',
    '<div class="status-row"><span class="pill ' + freshnessClass + '">' + escapeHtml(freshnessText) +
      '</span><span class="pill">Generato: ' + escapeHtml(displayInstant(generatedAt, timeZone)) +
      '</span><span class="pill">' + usages.length + ' rilevazioni</span>' +
      (calibration ? '<span class="pill ok">Calibrazione fatturazione attiva</span>' : '<span class="pill warn">Calibrazione assente</span>') +
      (purchased.count > 0 ? '<span class="pill ok">' + formatInteger(purchased.credits) + ' crediti extra già spesi</span>' : '') +
      (isDemo ? '<span class="pill warn">Dati inventati</span>' : '') + '</div>',
    '<div class="downloads"><a class="download" href="csv/totals.csv" download>Scarica totali CSV</a><a class="download secondary" href="csv/billing-estimates.csv" download>Scarica consumi calibrati</a><a class="download secondary" href="csv/billing-calibration.csv" download>Scarica calibrazione</a><a class="download secondary" href="csv/usage-history.csv" download>Scarica storico</a><a class="download secondary" href="csv/extra-credit-purchases.csv" download>Scarica acquisti extra</a><a class="download secondary" href="csv/estimates.csv" download>Scarica stime online</a><a class="download secondary" href="csv/internet-data.csv" download>Scarica prezzi</a><a class="download secondary" href="csv/exchange-rates.csv" download>Scarica cambi</a></div>',
    '</div></header>',
    '<main class="shell">',
    '<section class="cards" aria-label="Riepilogo">',
    '<article class="card accent"><span class="label">Crediti totali spesi</span><strong class="value">' +
      (primary ? formatDecimal(primary.usedCredits) : '—') + '</strong><span class="context">Piano calibrato + crediti extra</span></article>',
    '<article class="card blue"><span class="label">Costo totale equivalente</span><strong class="value">' +
      (primary ? '€' + formatDecimal(primary.spentEur) : '—') + '</strong><span class="context">Valore piano + acquisti effettivi</span></article>',
    '<article class="card"><span class="label">Usato · finestra 5 ore</span><strong class="value">' +
      (latest ? latest.fiveHour.usedPct + '%' : '—') + '</strong><span class="context">' +
      (latest ? 'Rilevazione ' + escapeHtml(displayLocalDate(latest.capturedAtLocal)) : 'Nessun dato') + '</span></article>',
    '<article class="card"><span class="label">Usato · settimana</span><strong class="value">' +
      (latest ? latest.weekly.usedPct + '%' : '—') + '</strong><span class="context">' +
      (latest ? 'Reset ' + escapeHtml(displayLocalDate(latest.weekly.resetsOnLocal)) : 'Nessun dato') + '</span></article>',
    '</section>',
    '<section class="section"><div class="section-head"><div><h2>Consumo calibrato sulla fatturazione</h2><p class="section-copy">Stima primaria basata sui costi realmente osservati e sul rapporto dichiarato tra euro e crediti. Per ogni finestra usa la percentuale massima rilevata.</p></div><span class="pill ok">Metodo primario</span></div>' +
      (calibrated && primary ? '<div class="totals-grid"><article class="total euro"><span class="label">Crediti totali spesi</span><strong>' +
        formatDecimal(primary.usedCredits) + '</strong><span class="context">Piano + extra già spesi</span></article>' +
        '<article class="total money"><span class="label">Costo totale equivalente</span><strong>€' +
        formatDecimal(primary.spentEur) + '</strong><span class="context">Valore calibrato + acquisti reali</span></article>' +
        '<article class="total"><span class="label">Quota piano calibrata</span><strong>' +
        formatDecimal(calibrated.usedCredits) + '</strong><span class="context">' + calibrated.windows + ' finestre distinte</span></article>' +
        '<article class="total"><span class="label">Quota extra già spesa</span><strong>' +
        formatDecimal(purchased.credits) + '</strong><span class="context">€' + formatDecimal(purchased.paidEur) + ' pagati</span></article>' +
        '<article class="total"><span class="label">Tempo equivalente · ' + escapeHtml(calibration.pilot.reasoning) + '</span><strong>' +
        formatDecimal(primary.pilotMinutes) + ' min</strong><span class="context">Pilota ' + escapeHtml(calibration.model) + ' ' + escapeHtml(calibration.pilot.reasoning) + '</span></article>' +
        '<article class="total"><span class="label">Token equivalenti · input</span><strong>' +
        formatInteger(primary.tokenEquivalent.input) + '</strong><span class="context">Conversione con rapporto crediti online</span></article>' +
        '<article class="total"><span class="label">Token equivalenti · cache</span><strong>' +
        formatInteger(primary.tokenEquivalent.cachedInput) + '</strong><span class="context">Scenario alternativo</span></article>' +
        '<article class="total"><span class="label">Token equivalenti · output</span><strong>' +
        formatInteger(primary.tokenEquivalent.output) + '</strong><span class="context">Scenario alternativo</span></article></div>' +
        '<div class="note"><strong>Calibrazione 100%:</strong> €' + formatDecimal(calibration.fullWindowEur) +
        ' equivalgono a ' + formatDecimal(calibration.fullWindowCredits) + ' crediti e circa ' +
        formatDecimal(calibration.fullWindowPilotMinutes) + ' minuti con il pilota ' +
        escapeHtml(calibration.pilot.reasoning) + '. Deriva da ' +
        formatDecimal(calibration.planWindow.observedUsagePct) + '% = €' +
        formatDecimal(calibration.planWindow.estimatedBilledEur) + ' e da ' +
        formatInteger(calibration.creditPack.credits) + ' crediti = €' +
        formatDecimal(calibration.creditPack.paidEur) + '.</div>' +
        '<div class="panel table-wrap" style="margin-top:14px"><table><thead><tr><th>Rilevazione</th><th>Uso 5h</th><th>Crediti</th><th>Valore EUR</th><th>Minuti ' +
        escapeHtml(calibration.pilot.reasoning) + '</th><th>Token input</th><th>Token output</th></tr></thead><tbody>' +
        calibratedUsageRows(usages, calibration, pricingSnapshots) + '</tbody></table></div>'
        : '<div class="empty panel">Nessuna calibrazione di fatturazione disponibile.</div>') + '</section>',
    '<section class="section"><div class="section-head"><div><h2>Confronto teorico dai listini online</h2><p class="section-copy">Calcolo secondario basato sugli intervalli pubblicati online. Resta disponibile per confronto e non sostituisce la calibrazione di fatturazione.</p></div><span class="pill warn">' +
      totals.includedWindows + ' finestre incluse</span></div><div class="totals-grid">',
    '<article class="total"><span class="label">Crediti stimati</span><strong>' +
      decimalRange(totals.credits) + '</strong><span class="context">Intervallo complessivo</span></article>',
    '<article class="total"><span class="label">Token equivalenti · input</span><strong>' +
      integerRange(totals.tokenEquivalent.input) + '</strong><span class="context">Scenario solo input</span></article>',
    '<article class="total"><span class="label">Token equivalenti · cache</span><strong>' +
      integerRange(totals.tokenEquivalent.cachedInput) + '</strong><span class="context">Scenario solo input in cache</span></article>',
    '<article class="total"><span class="label">Token equivalenti · output</span><strong>' +
      integerRange(totals.tokenEquivalent.output) + '</strong><span class="context">Scenario solo output</span></article>',
    '<article class="total money"><span class="label">Costo API equivalente · USD</span><strong>' +
      decimalRange(totals.apiCostUsd, '$') + '</strong><span class="context">Non è una fattura reale</span></article>',
    '<article class="total euro"><span class="label">Costo API equivalente · EUR</span><strong>' +
      decimalRange(totals.apiCostEur, '€') + '</strong><span class="context">Cambio BCE applicato per finestra</span></article>',
    '</div><div class="note"><strong>Metodo anti-doppio conteggio:</strong> ' + totals.sourceSnapshots +
      ' screenshot sono stati ricondotti a ' + totals.windows + ' finestre distinte. ' +
      (totals.excludedWindows > 0 ? totals.excludedWindows + ' finestre non hanno dati sufficienti e sono escluse.' : 'Nessuna finestra è stata esclusa.') +
      '</div></section>',
    '<section class="section"><div class="section-head"><div><h2>Crediti extra acquistati e spesi</h2><p class="section-copy">Valori inseriti manualmente dall’utente e conteggiati interamente come consumo già avvenuto.</p></div><span class="pill ok">Dati dichiarati</span></div><div class="totals-grid">',
    '<article class="total"><span class="label">Acquisti registrati</span><strong>' +
      purchased.count + '</strong><span class="context">Eventi append-only</span></article>',
    '<article class="total euro"><span class="label">Crediti acquistati e spesi</span><strong>' +
      formatInteger(purchased.credits) + '</strong><span class="context">' +
      (purchasedWindowEquivalents === null
        ? 'Totale dichiarato'
        : formatDecimal(purchasedWindowEquivalents) + ' finestre calibrate al 100%') + '</span></article>',
    '<article class="total money"><span class="label">Importo pagato</span><strong>€' +
      formatDecimal(purchased.paidEur) + '</strong><span class="context">Costo effettivo dichiarato</span></article>',
    '</div><div class="panel table-wrap" style="margin-top:14px"><table><thead><tr><th>Acquistati il</th><th>Crediti spesi</th><th>Importo pagato</th><th>EUR per credito</th></tr></thead><tbody>' +
      (extraCreditRows(extraCreditPurchases, timeZone) || '<tr><td colspan="4">Nessun acquisto extra dichiarato.</td></tr>') +
      '</tbody></table></div><div class="note"><strong>Regola di calcolo:</strong> ogni credito acquistato viene considerato già speso. Il residuo assunto è quindi zero e la quota extra entra nel totale dei crediti e dei token equivalenti consumati.</div></section>',
    '<section class="section"><div class="section-head"><div><h2>Base della calibrazione</h2><p class="section-copy">Osservazioni di fatturazione dichiarate dall’utente. I valori al minuto sono ricalcolati da durata e importo, non inseriti come risultato.</p></div><span class="pill">Dati osservati</span></div>' +
      (calibration ? '<div class="panel table-wrap"><table><thead><tr><th>Reasoning</th><th>Durata</th><th>Fatturato</th><th>EUR/minuto</th></tr></thead><tbody>' +
        billingObservationRows(calibration) + '</tbody></table></div><div class="note"><strong>Osservazione del piano:</strong> ' +
        formatDecimal(calibration.planWindow.observedUsagePct) + '% utilizzato in ' +
        displayDuration(calibration.planWindow.observedDurationSeconds) + ' con ' +
        escapeHtml(calibration.planWindow.sourceReasoning) + ' ' +
        escapeHtml(calibration.planWindow.executionMode ?? 'standard') + ', valore stimato arrotondato €' +
        formatDecimal(calibration.planWindow.estimatedBilledEur) + '.</div>'
        : '<div class="empty panel">Nessuna osservazione disponibile.</div>') + '</section>',
    '<section class="section"><div class="section-head"><div><h2>Andamento utilizzo</h2><p class="section-copy">Percentuali effettivamente lette dalle immagini. I due limiti hanno finestre diverse e non vanno sommati.</p></div><div class="legend"><span class="key">5 ore</span><span class="key week">Settimana</span></div></div><div class="panel">' +
      chartMarkup(usages) + '</div></section>',
    '<section class="section"><div class="section-head"><div><h2>Storico rilevazioni</h2><p class="section-copy">Dati OCR locali conservati nello storico append-only.</p></div><span class="pill">Dati rilevati</span></div><div class="panel table-wrap"><table><thead><tr><th>Rilevazione</th><th>5 ore</th><th>Settimana</th><th>Reset 5h</th><th>Reset settimana</th><th>OCR</th></tr></thead><tbody>' +
      (historyRows(usages) || '<tr><td colspan="6">Nessuna rilevazione.</td></tr>') + '</tbody></table></div></section>',
    '<section class="section"><div class="section-head"><div><h2>Listino API</h2><p class="section-copy">Ultimo snapshot ufficiale disponibile, espresso in dollari per un milione di token.</p></div><span class="pill ' +
      freshnessClass + '">' + escapeHtml(freshnessText) + '</span></div>',
    '<div class="price-grid"><article class="price"><span class="label">Input</span><strong>' +
      (prices ? '$' + formatDecimal(prices.input) : '—') + '</strong><span class="context">1M token</span></article><article class="price cache"><span class="label">Input in cache</span><strong>' +
      (prices ? '$' + formatDecimal(prices.cachedInput) : '—') + '</strong><span class="context">1M token</span></article><article class="price output"><span class="label">Output</span><strong>' +
      (prices ? '$' + formatDecimal(prices.output) : '—') + '</strong><span class="context">1M token</span></article></div>',
    '<div class="note"><strong>Cambio BCE:</strong> ' +
      (latestExchangeRate
        ? '1 EUR = ' + formatDecimal(latestExchangeRate.usdPerEur, 4) +
          ' USD; 1 USD = ' + formatDecimal(latestExchangeRate.eurPerUsd, 4) +
          ' EUR. Tasso del ' + escapeHtml(latestExchangeRate.rateDate) +
          ', scaricato ' + escapeHtml(displayInstant(latestExchangeRate.fetchedAt, timeZone)) + '.'
        : 'nessun tasso disponibile.') +
      ' Il tasso è informativo e non rappresenta necessariamente un cambio di transazione.</div>',
    '<div class="note"><strong>Limite noto:</strong> la capacità settimanale numerica non è pubblicata. Per questo la percentuale settimanale viene mostrata, ma non convertita in token o costo.</div></section>',
    '<section class="section"><div class="section-head"><div><h2>Stime secondarie dai listini</h2><p class="section-copy">Intervalli teorici del metodo precedente, non token misurati né importi fatturati. Input, cache e output sono scenari separati.</p></div><span class="pill warn">Confronto online</span></div><div class="panel table-wrap"><table><thead><tr><th>Rilevazione</th><th>Crediti</th><th>Token input</th><th>Token cache</th><th>Token output</th><th>Costo USD</th><th>Costo EUR</th><th>EUR/USD</th><th>Listino</th></tr></thead><tbody>' +
      (estimateRows(usages, pricingSnapshots, exchangeRateSnapshots) || '<tr><td colspan="9">Nessuna stima disponibile.</td></tr>') + '</tbody></table></div></section>',
    '<section class="section"><div class="section-head"><div><h2>Provenienza Internet</h2><p class="section-copy">Ogni fonte conserva URL, data e ora di download, hash e copia grezza locale.</p></div><span class="pill">Dati scaricati</span></div><div class="panel table-wrap"><table><thead><tr><th>Scaricato</th><th>Tipo</th><th>Fonte</th><th>SHA-256</th></tr></thead><tbody>' +
      (sourceRows(pricingSnapshots, exchangeRateSnapshots, timeZone) || '<tr><td colspan="4">Nessuna fonte disponibile.</td></tr>') + '</tbody></table></div></section>',
    '</main>',
    '<footer><div class="shell">Dashboard statica locale · nessun dato viene trasmesso · ultimo aggiornamento ' +
      escapeHtml(displayInstant(generatedAt, timeZone)) + '</div></footer>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
