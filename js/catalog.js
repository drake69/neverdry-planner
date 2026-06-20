const UNKNOWN_PROFILE = {
  name:                    'Pianta sconosciuta',
  scientific_name:         'Unknown',
  botanical_family:        'Unknown',
  botanical_genus:         'Unknown',
  functional_group:        'non classificata',
  water_class:             'medium',
  water_coefficient:       1.0,
  typical_canopy_diameter_m: 1.2,
  data_source:             'estimated',
  kc_confidence:           'estimated',
};

export async function loadCatalog(url = './data/catalog.json') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Catalogo non disponibile (HTTP ${res.status})`);
  const raw = await res.json();
  const entries = raw.entries || {};

  return {
    // Risoluzione per nome: esatta poi substring, fallback profilo medio.
    resolvePlant(name) {
      const key = name.trim().toLowerCase();
      if (entries[key]) return entries[key];
      for (const [k, profile] of Object.entries(entries)) {
        if (key.includes(k) || k.includes(key)) return profile;
      }
      return { ...UNKNOWN_PROFILE, name };
    },

    // Top-N botanical names matching query, ranked by match quality.
    // Searches both scientific name and common name; always returns scientific name.
    searchPlants(query, limit = 10) {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const results = [];
      for (const e of Object.values(entries)) {
        const scientific = (e.scientific_name || e.name).toLowerCase();
        const common     = (e.name || '').toLowerCase();
        let score = 0;
        for (const haystack of [scientific, common]) {
          let s = 0;
          if (haystack.startsWith(q))                                       s = 3;
          else if (haystack.split(/[\s,&()+]+/).some(w => w.startsWith(q))) s = 2;
          else if (haystack.includes(q))                                     s = 1;
          if (s > score) score = s;
        }
        // Bonus: scientific name match ranks above common-name-only match.
        let sciScore = 0;
        if (scientific.startsWith(q))                                         sciScore = 3;
        else if (scientific.split(/[\s,&()+]+/).some(w => w.startsWith(q)))   sciScore = 2;
        else if (scientific.includes(q))                                       sciScore = 1;
        if (score) results.push({ name: e.scientific_name || e.name, common: e.name || '', score, sciScore });
      }
      results.sort((a, b) =>
        b.score - a.score ||
        b.sciScore - a.sciScore ||
        a.name.localeCompare(b.name, 'it')
      );
      return results.slice(0, limit).map(r => ({ name: r.name, common: r.common }));
    },

    // True if displayName exactly matches a catalog entry.
    isValidDisplayName(displayName) {
      return Object.values(entries)
        .some(e => (e.scientific_name || e.name) === displayName);
    },

    // Chiave di lookup dal nome botanico visualizzato nel dropdown.
    keyFromDisplayName(displayName) {
      const entry = Object.entries(entries)
        .find(([, v]) => (v.scientific_name || v.name) === displayName);
      return entry ? entry[0] : displayName.toLowerCase();
    },
  };
}
