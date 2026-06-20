// Tutte funzioni pure, nessun side effect, nessun accesso al DOM.

export const DEFAULT_CONFIG = {
  etoMmDay:         5.0,   // peak ETo [mm/day] — worst-case climate (design value)
  runtimeHDay:      1.0,   // design runtime at peak ETo [h/day]; controller adjusts daily
  maxLineFlowLph:   null,  // display-only cap [l/h]; null = no limit
  emitterLphOptions: [1.0, 2.0, 4.0, 8.0],
  maxEmittersPerNode: 8,
  acceptableErrorRatio: 0.10,
};

// --- optimizer ---

// Mixed-emitter exhaustive search.
// Finds the combination of emitters (possibly different sizes) that minimises
// |installedLph - targetLph|, subject to:
//   minTotal ≤ Σnᵢ ≤ maxTotal
// Returns { installedLph, breakdown: [{count, lph}], totalEmitters }
//
// Search space: Σ C(T+K-1,K-1) for T=0..maxTotal.
// For K=4, maxTotal=8 → 495 combinations. Negligible cost.
function chooseEmittersForTarget(targetLph, config, minimumEmitters) {
  const sizes    = config.emitterLphOptions;
  const minTotal = minimumEmitters;
  const maxTotal = Math.max(config.maxEmittersPerNode, minimumEmitters);
  const K        = sizes.length;

  let best    = null;
  let bestErr = Infinity;
  const counts = new Array(K).fill(0);

  function search(idx, used, lph) {
    if (idx === K) {
      if (used < minTotal) return;
      const err = Math.abs(lph - targetLph);
      if (err < bestErr || (err === bestErr && used < best.totalEmitters)) {
        bestErr = err;
        best = {
          installedLph:  lph,
          totalEmitters: used,
          breakdown:     sizes
            .map((s, i) => ({ count: counts[i], lph: s }))
            .filter(b => b.count > 0),
        };
      }
      return;
    }
    for (let n = 0; n <= maxTotal - used; n++) {
      counts[idx] = n;
      search(idx + 1, used + n, lph + n * sizes[idx]);
    }
    counts[idx] = 0;
  }

  search(0, 0, 0);
  if (!best) throw new Error('No emitter configuration available');
  return best;
}

function classifyError(errorRatio, acceptableErrorRatio) {
  if (errorRatio <= acceptableErrorRatio)     return 'coerente';
  if (errorRatio <= acceptableErrorRatio * 2) return 'da verificare';
  return 'critico';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function weightedCounts(nodes, profiles, attr) {
  const counts = {};
  for (let i = 0; i < nodes.length; i++) {
    const val = profiles[i][attr];
    counts[val] = (counts[val] || 0) + nodes[i].plantCount;
  }
  return counts;
}

function deriveVirtualFamily(nodes, profiles) {
  const totalPlants = nodes.reduce((s, n) => s + n.plantCount, 0);
  const groups   = weightedCounts(nodes, profiles, 'functional_group');
  const families = weightedCounts(nodes, profiles, 'botanical_family');
  const genera   = weightedCounts(nodes, profiles, 'botanical_genus');

  const [dominantGroup, groupCount]    = Object.entries(groups).sort((a, b) => b[1] - a[1])[0];
  const [prevalentFamily, familyCount] = Object.entries(families).sort((a, b) => b[1] - a[1])[0];
  const [prevalentGenus,  genusCount]  = Object.entries(genera).sort((a, b) => b[1] - a[1])[0];
  const familyShare = familyCount / totalPlants;
  const genusShare  = genusCount  / totalPlants;

  let label;
  if (Object.keys(families).length === 1) {
    label = `${dominantGroup} (${prevalentFamily})`;
  } else if (familyShare >= 0.5) {
    label = `${dominantGroup} con prevalenza ${prevalentFamily}`;
  } else if (groupCount / totalPlants >= 0.5) {
    label = `${dominantGroup} misti, prossimi a ${prevalentFamily}`;
  } else {
    label = `mista multi-famiglia, prossima a ${prevalentFamily}`;
  }

  return { label, prevalentFamily, familyShare, prevalentGenus, genusShare };
}

function deriveWaterClass(kc) {
  if (kc < 0.15) return 'very low water demand';
  if (kc < 0.35) return 'low water demand';
  if (kc < 0.65) return 'medium water demand';
  return 'high water demand';
}

function deriveLineClassification(errorRatio, acceptableErrorRatio) {
  if (errorRatio <= acceptableErrorRatio)     return 'bilanciata';
  if (errorRatio <= acceptableErrorRatio * 2) return 'da verificare';
  return 'non bilanciata';
}

// Notes are returned as code objects so the UI can translate them.
function buildNotes(nodePlans, profiles) {
  const notes = [];
  const families = new Set(profiles.map(p => p.botanical_family));
  if (families.size > 1) {
    notes.push({ code: 'NOTE_MULTIFAMILY' });
  }
  const critical = nodePlans.filter(n => n.compatibility === 'critico').map(n => n.nodeId);
  if (critical.length) {
    notes.push({ code: 'NOTE_CRITICAL', data: critical.join(', ') });
  }
  const unknown = profiles
    .map(p => p.botanical_family === 'Unknown' ? p.name : null)
    .filter(Boolean);
  if (unknown.length) {
    notes.push({ code: 'NOTE_UNKNOWN', data: unknown.join(', ') });
  }
  return notes;
}

// ---------------------------------------------------------------------------
// Public API
// catalog must expose resolvePlant(name) → profile
// ---------------------------------------------------------------------------
export function planIrrigationLine(catalog, lineInput) {
  const nodes = lineInput.nodes;
  if (!nodes || nodes.length === 0) throw new Error('At least one node is required');

  const config  = { ...DEFAULT_CONFIG, ...lineInput.config };
  const profiles = nodes.map(n => catalog.resolvePlant(n.plantName));

  // C = ETo / runtime [L/m²/h]  — uniform scalar for all nodes
  const specificFlow = config.etoMmDay / config.runtimeHDay;

  const totalPlants = nodes.reduce((s, n) => s + n.plantCount, 0);
  const avgKc = nodes.reduce((s, n, i) => s + profiles[i].water_coefficient * n.plantCount, 0) / totalPlants;

  const vf = deriveVirtualFamily(nodes, profiles);
  const virtualWaterClass = deriveWaterClass(avgKc);

  const nodePlans = nodes.map((node, i) => {
    const profile  = profiles[i];
    const diameter = (node.canopyDiameterM != null)
      ? node.canopyDiameterM
      : profile.typical_canopy_diameter_m;
    const nodeAreaM2 = round3(Math.PI * Math.pow(diameter / 2, 2) * node.plantCount);

    // targetLph = Kc × area [m²] × ETo/runtime [L/m²/h]
    const targetLph = round3(profile.water_coefficient * nodeAreaM2 * specificFlow);

    const { installedLph, totalEmitters, breakdown } =
      chooseEmittersForTarget(targetLph, config, node.plantCount);
    const errorLph   = round3(installedLph - targetLph);
    const errorRatio = targetLph ? round3(Math.abs(errorLph) / targetLph) : 0;

    return {
      nodeId:          node.id,
      plantName:       profile.name,
      botanicalFamily: profile.botanical_family,
      botanicalGenus:  profile.botanical_genus,
      functionalGroup: profile.functional_group,
      waterClass:      profile.water_class,
      kc:              profile.water_coefficient,
      nodeAreaM2,
      targetLph,
      totalEmitters,
      breakdown,       // [{count, lph}] — may mix sizes
      installedLph:    round3(installedLph),
      errorLph,
      errorRatio,
      compatibility:   classifyError(errorRatio, config.acceptableErrorRatio),
    };
  });

  const totalTargetLph    = round3(nodePlans.reduce((s, n) => s + n.targetLph, 0));
  const totalInstalledLph = round3(nodePlans.reduce((s, n) => s + n.installedLph, 0));
  const totalAreaM2       = round3(nodePlans.reduce((s, n) => s + n.nodeAreaM2, 0));
  const lineErrorRatio    = totalTargetLph
    ? round3(Math.abs(totalInstalledLph - totalTargetLph) / totalTargetLph) : 0;

  // kcLine: effective Kc of installed configuration for NeverDry controller
  // ETc_installed = totalInstalledLph × runtime = kcLine × ETo × totalArea
  const kcLine = (totalAreaM2 && specificFlow)
    ? round3(totalInstalledLph / (totalAreaM2 * specificFlow))
    : 0;

  return {
    lineName:                      lineInput.name,
    irrigationType:                lineInput.irrigationType,
    virtualBotanicalFamily:        vf.label,
    prevalentBotanicalFamily:      vf.prevalentFamily,
    prevalentBotanicalFamilyShare: round3(vf.familyShare),
    prevalentBotanicalGenus:       vf.prevalentGenus,
    prevalentBotanicalGenusShare:  round3(vf.genusShare),
    virtualWaterClass,
    kcLine,
    areaEquivalentM2: totalAreaM2,
    botanicalDiversity: new Set(profiles.map(p => p.botanical_family)).size,
    totalInstalledLph,
    totalTargetLph,
    lineErrorRatio,
    lineFlowLph: lineInput.irrigationType === 'drip' ? totalInstalledLph : null,
    classification: deriveLineClassification(lineErrorRatio, config.acceptableErrorRatio),
    nodePlans,
    notes: buildNotes(nodePlans, profiles),
  };
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}
