---
name: danish-search
description: Danish address and cadastral (matrikel) search component for Centia apps. Covers installation, initialization, option configuration, result handling, and integration with Centia SDK for spatial queries.
---

/# Danish Search Component — `@centia-io/danish-search`

Use this skill when building Centia apps that need Danish address or cadastral search.

## What it does

The component searches DAR (adgangsadresser) and Matriklen (jordstykke) via
GC2 Elasticsearch. It provides typeahead autocomplete with intelligent
cascading: street → address, ejerlav → jordstykke.

## Package

| | |
|---|---|
| **npm** | `@centia-io/danish-search` |
| **Entry (ESM)** | `dist/danish-search.mjs` |
| **Entry (CJS)** | `dist/danish-search.cjs` |
| **Stylesheet** | `dist/style.css` |

## Installation

```bash
pnpm add @centia-io/danish-search
```

## Source files (development)

| File | Purpose |
|---|---|
| `src/danish.js` | Search logic, Elasticsearch DSL, result handling |
| `src/autocomplete.js` | Generic typeahead/autocomplete UI class |
| `src/style.css` | Standalone styling (no framework dependencies) |
| `src/main.js` | Demo entry point (not published) |

## Hard rules

- Do not add jQuery, Bootstrap, or other framework dependencies.
- Do not perform spatial/SQL queries inside the component — emit data and let the consuming app query Centia.io.
- Do not hardcode host or database — always pass via options.

## Initialization

```js
import danish from "@centia-io/danish-search";
import "@centia-io/danish-search/style.css";

const inputEl = danish({
    el: ".custom-search",          // CSS selector for input element (default: ".custom-search")
    host: "https://dk.gc2.io",     // GC2 host (default)
    db: "dk",                      // GC2 database (default)
    onlyAddress: false,            // true = hide matrikel results
    komKode: "*",                  // municipality filter: "*", "0101", or ["0101","0147"]
    size: 20,                      // max results per query
    onSelect({ type, gid, value, searchType }) {
        // Called when a final result is selected
    }
});
```

Returns the input `HTMLElement`.

## Options reference

| Option | Type | Default | Description |
|---|---|---|---|
| `el` | `string` | `".custom-search"` | CSS selector for the search input |
| `host` | `string` | `"https://dk.gc2.io"` | GC2 Elasticsearch host |
| `db` | `string` | `"dk"` | GC2 database name |
| `onlyAddress` | `boolean` | `false` | Suppress matrikel results |
| `komKode` | `string \| string[]` | `"*"` | Municipality code(s), `"*"` = all |
| `size` | `number` | `20` | Max suggestions per category |
| `onSelect` | `function` | — | Callback on final selection |

## Result object (`onSelect` / `search:select` event detail)

```ts
{
    type: "adresse" | "matrikel",    // Which dataset the result came from
    gid: string,                     // Unique ID (DAR id or matrikel gid)
    value: string,                   // Display string shown to user
    searchType: string,              // Internal search phase (adresse, jordstykke, etc.)
    feature: GeoJSON.Feature         // The full GeoJSON feature of a adresse or matrikel
}
```

## Listening via event instead of callback

```js
import danish from "@centia-io/danish-search";

const inputEl = danish({ el: "#my-input" });

inputEl.addEventListener("search:select", (e) => {
    const { type, gid, value } = e.detail;
    // handle result
});
```

## Integrating with Centia SDK

The `feature` in the callback is a full GeoJSON Feature (EPSG:4326) with the
geometry of the selected address or matrikel parcel. Use it directly for spatial
queries against your own data via `ST_Intersects`.

### Find rows in your own table that intersect the selected feature

```js
import danish from "@centia-io/danish-search";
import { Sql } from "./baas/client.js";

danish({
    onSelect: async ({ feature }) => {
        const geojson = JSON.stringify(feature.geometry);
        const res = await Sql.exec(`
            SELECT *
            FROM my_schema.my_table
            WHERE ST_Intersects(
                the_geom,
                ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON('${geojson}'), 4326), 25832)
            )
        `);
        console.log(res.data);
    }
});
```

### Zoom a map to the selected feature

```js
danish({
    onSelect: ({ feature }) => {
        // Works with any map library that accepts GeoJSON (Leaflet, MapLibre, OpenLayers, etc.)
        map.fitBounds(L.geoJSON(feature).getBounds());
    }
});
```

### Aggregate your data within a selected matrikel parcel

```js
danish({
    onSelect: async ({ type, feature }) => {
        if (type === "matrikel") {
            const geojson = JSON.stringify(feature.geometry);
            const res = await Sql.exec(`
                SELECT count(*) AS cnt, sum(areal) AS total_areal
                FROM my_schema.bygninger
                WHERE ST_Intersects(
                    the_geom,
                    ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON('${geojson}'), 4326), 25832)
                )
            `);
            console.log(res.data);
        }
    }
});
```

### Use the feature properties directly

The `feature.properties` object contains all attributes from the source dataset
(DAR or matrikel). No extra query is needed for basic attribute display:

```js
danish({
    onSelect: ({ type, feature }) => {
        if (type === "adresse") {
            const { postnr, postnrnavn, kommunekode } = feature.properties;
            console.log(`${postnr} ${postnrnavn}, kommune ${kommunekode}`);
        }
        if (type === "matrikel") {
            const { matrikelnummer, ejerlavsnavn } = feature.properties;
            console.log(`${ejerlavsnavn} ${matrikelnummer}`);
        }
    }
});
```

## Search cascade behavior

The component auto-narrows results:

1. **No digits, no comma, no spaces** → searches street names and city names separately
2. **No digits, no comma, with spaces** → searches combined street + city
3. **Contains comma or digits** → searches full addresses directly
4. **Comma with house number after city** → auto-normalizes query (e.g. `"Vej, By 35"` → `"Vej 35, By"`)
5. **Single result at street/city level** → auto-cascades to full address search

Matrikel follows the same pattern:
1. **No digits** → ejerlav (estate name) aggregation
2. **Contains digits** → jordstykke (parcel) hits
3. **Single ejerlav** → auto-cascades to jordstykke

Intermediate selections (street name, city, ejerlav) are injected back into the
input to narrow the search — `onSelect` only fires for final results with a GID.

## Required HTML

The component needs an `<input>` element matching the `el` selector:

```html
<input class="custom-search" type="text" placeholder="Søg adresse eller matrikel...">
```

Import `@centia-io/danish-search/style.css` for dropdown styling, or provide your own styles for these classes:

- `.tt-dropdown-menu` — dropdown container
- `.tt-suggestions` — suggestions wrapper
- `.tt-suggestion` — individual suggestion
- `.tt-suggestion.tt-cursor` — highlighted suggestion
- `.typeahead-heading` — category header (Adresser / Matrikel)

## Security notes

- GID values come from Elasticsearch and are used in SQL queries — always use parameterized queries or validate GIDs when building SQL for Centia.
- DAR `id` values are UUIDs. Matrikel `gid` values are integers.
- Do not expose the GC2 Elasticsearch endpoint to user-controlled input beyond the search query itself.
