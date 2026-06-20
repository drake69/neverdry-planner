# NeverDry – Planner

> *"But how many drippers do I need, and at what flow rate — when my garden has mixed plants?"*

NeverDry Planner answers exactly that question. You describe one irrigation line — the plants on it, how many, their canopy size — and the tool finds the optimal emitter combination for each node, sized to each plant's actual water need.

Part of the [NeverDry](https://drake69.github.io/NeverDry/) smart irrigation ecosystem.

---

## What it does

Most gardens mix plants with very different water needs on the same drip line: a rosebush next to lavender next to a camellia. A single emitter size fits none of them well.

NeverDry Planner:

1. Takes your plant list (species, count, canopy diameter per node)
2. Looks up each species' water coefficient (Kc) from the WUCOLS IV database
3. Computes the target flow for each node: `Kc × canopy area × (Peak ETo / runtime)`
4. Searches exhaustively over all combinations of your available emitter sizes
5. Returns the mix of emitters — e.g. `2×2.0 + 1×4.0 l/h` — that minimises the error per node

The output is what you actually install: **number and size of each dripper, per node**.

---

## How the sizing works

```
targetLph = Kc × nodeArea [m²] × C

where:
  Kc       = plant water coefficient (from WUCOLS IV, dimensionless)
  nodeArea = π × (canopy∅/2)² × plant count
  C        = Peak ETo [mm/day] ÷ design runtime [h/day]   [L/m²/h]
```

`C` is a line-level constant — the same for every node. Changing it scales all targets proportionally but doesn't change the relative sizing between nodes. Design for your local **peak summer ETo**; the NeverDry controller adjusts daily runtime automatically as ETo changes through the seasons.

**Line Kc** (shown in results): the effective crop coefficient of the installed configuration, used by the NeverDry controller to schedule runtimes:

```
runtime = kcLine × ETo_actual × totalArea / totalInstalledFlow
```

---

## Plant database

3 379 species from **WUCOLS IV** — Water Use Classification of Landscape Species  
(Costello, Matheny & Clark; UC Cooperative Extension, 2014)  
Dataset: [github.com/ucdavis/WUCOLS-plant-search-database](https://github.com/ucdavis/WUCOLS-plant-search-database) — MIT License © 2022 UC Davis

Kc values mapped from WUCOLS plant factors: VL → 0.10, LO → 0.20, M → 0.50, H → 0.80.  
966 species include photo thumbnails.

*Note on Kc vs Kp:* WUCOLS uses the term "plant factor" (Kp). For landscape species it is a fixed species characteristic, unlike the FAO-56 crop Kc which varies with growth stage. This app uses Kc throughout for consistency with irrigation engineering convention.

---

## Usage

Static web app — no server, no install.

Open `index.html` in any modern browser (Chrome, Firefox, Safari, Edge).  
Or serve locally:

```bash
python3 -m http.server 8787
# then open http://localhost:8787
```

### Quick start

1. Enter a **line name** and select **Drip** as irrigation type
2. Add nodes — one row per plant group (species, count, optional canopy diameter)
3. Open **Advanced settings** → set **Peak ETo** and **Design runtime** for your climate
4. Results update live: emitter breakdown per node, total installed flow, line Kc

### Import / Export

Use **Export JSON** to save your configuration. **Import JSON** restores it. The file includes both the input parameters and the computed plan.

---

## Integration with NeverDry

NeverDry Planner is the design-time tool. At runtime, the NeverDry controller reads `kcLine` and computes:

```
daily_runtime = kcLine × ETo_forecast × totalArea / totalInstalledFlow
```

This closes the loop: Planner sizes the hardware once; the controller optimises water delivery every day.

---

## License

MIT — see [LICENSE](../LICENSE)  
Plant data: WUCOLS IV — MIT License © 2022 UC Davis
