# @centia-io/danish-search

Danish address and cadastral (matrikel) search component for [Centia](https://centia.io) apps.

Provides a typeahead/autocomplete input that searches DAR (adgangsadresser) and Matriklen (jordstykke) via GC2 Elasticsearch, with intelligent cascading: street → address, ejerlav → jordstykke. Returns a full GeoJSON feature ready for spatial queries against your own data.

## Features

- Typeahead search across Danish addresses and cadastral parcels
- Smart cascade: street/city → full address, ejerlav → parcel
- Municipality (`kommunekode`) filtering
- Returns full GeoJSON feature (EPSG:4326) for spatial queries
- Accent-insensitive matching
- No framework dependencies (no jQuery, Bootstrap, etc.)
- Standalone stylesheet

## Installation

```bash
pnpm add @centia-io/danish-search
# or
npm install @centia-io/danish-search
```

## Quick start

```html
<input class="custom-search" type="text" placeholder="Søg adresse eller matrikel...">
```

```js
import danish from "@centia-io/danish-search";
import "@centia-io/danish-search/style.css";

const inputEl = danish({
    onSelect({ type, gid, value, feature }) {
        console.log(type, gid, value);
        console.log(feature); // GeoJSON Feature in EPSG:4326
    }
});
```

The function returns the input `HTMLElement`.

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `el` | `string` | `".custom-search"` | CSS selector for the search input |
| `host` | `string` | `"https://dk.gc2.io"` | GC2 Elasticsearch host |
| `db` | `string` | `"dk"` | GC2 database name |
| `onlyAddress` | `boolean` | `false` | Suppress matrikel results |
| `komKode` | `string \| string[]` | `"*"` | Municipality code(s); `"*"` = all |
| `size` | `number` | `20` | Max suggestions per category |
| `onSelect` | `function` | — | Callback fired on final selection |

## Result object

`onSelect` receives, and `search:select` events expose the same payload as `event.detail`:

```ts
{
    type: "adresse" | "matrikel",  // dataset the result came from
    gid: string,                    // unique id (DAR uuid or matrikel gid)
    value: string,                  // display string shown to the user
    searchType: string,             // internal search phase
    feature: GeoJSON.Feature        // full GeoJSON feature of address or parcel
}
```

DAR `id` values are UUIDs. Matrikel `gid` values are integers.

## Listening via event instead of callback

```js
const inputEl = danish({ el: "#my-input" });

inputEl.addEventListener("search:select", (e) => {
    const { type, gid, value, feature } = e.detail;
    // handle result
});
```

## Integrating with Centia SDK

The `feature` returned by `onSelect` is a full GeoJSON Feature in EPSG:4326. Use it directly for spatial queries against your own data.

### Intersect rows in your table with the selected feature

```js
import danish from "@centia-io/danish-search";
import { Sql } from "@centia-io/sdk";

const sql = new Sql();

danish({
    onSelect: async ({ feature }) => {
        const res = await sql.exec({
            q: `SELECT *
                FROM my_schema.my_table
                WHERE ST_Intersects(
                    the_geom,
                    ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(:geojson), 4326), 25832)
                )`,
            params: [{"geojson": feature.geometry}]
        });
        console.log(res.data);
    }
});
```

### Zoom a map to the selected feature

```js
danish({
    onSelect: ({ feature }) => {
        // Works with Leaflet, MapLibre, OpenLayers, etc.
        map.fitBounds(L.geoJSON(feature).getBounds());
    }
});
```

### Use feature properties directly

`feature.properties` contains all attributes from the source dataset:

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

The component auto-narrows results based on what the user types.

**Addresses:**
1. No digits, no comma, no spaces → searches street names and city names separately
2. No digits, no comma, with spaces → searches combined street + city
3. Contains comma or digits → searches full addresses directly
4. Comma with house number after city → auto-normalises (e.g. `"Vej, By 35"` → `"Vej 35, By"`)
5. Single result at street/city level → auto-cascades to full address search

**Matrikel:**
1. No digits → ejerlav (estate name) aggregation
2. Contains digits → jordstykke (parcel) hits
3. Single ejerlav → auto-cascades to jordstykke

Intermediate selections (street, city, ejerlav) are injected back into the input to narrow the search. `onSelect` only fires for final results with a GID.

## Styling

Import the bundled stylesheet:

```js
import "@centia-io/danish-search/style.css";
```

Or provide your own styles for these class hooks:

- `.tt-dropdown-menu` — dropdown container
- `.tt-suggestions` — suggestions wrapper
- `.tt-suggestion` — individual suggestion
- `.tt-suggestion.tt-cursor` — highlighted suggestion
- `.typeahead-heading` — category header (Adresser / Matrikel)

## Development

```bash
pnpm install
pnpm dev      # start Vite dev server (demo at index.html)
pnpm build    # build library to dist/
pnpm preview  # preview built bundle
```

The library is built with Vite in library mode and emits both ESM (`dist/danish.mjs`) and CJS (`dist/danish.cjs`) bundles plus `dist/style.css`.

## Security notes

- GID values come from Elasticsearch and may end up in SQL queries against your Centia backend. Use parameterised queries or validate GIDs before string-interpolating them.
- Do not expose the GC2 Elasticsearch endpoint to user-controlled input beyond the search query itself.

## License

[MIT](./LICENSE) © Martin Høgh
