/*
 * @author     Martin Høgh
 * @copyright  2013-2026 MapCentia ApS
 * @license    http://www.gnu.org/licenses/#AGPL  GNU AFFERO GENERAL PUBLIC LICENSE 3
 */

'use strict';

import Autocomplete from './autocomplete.js';
import {createCentiaClient, SqlNoToken} from '@centia-io/sdk';

const DEFAULT_HOST = "https://dk.gc2.io";
// const DEFAULT_HOST = "http://localhost:8080";
const DEFAULT_DB = "dk";

// Build OR-variants so both "Alle" and "Allé" match regardless of what's indexed.
// "Frederiksberg Alle" → "(Frederiksberg Alle) OR (Frederiksberg Allé)"
function accentVariants(query) {
    const folded = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const expanded = query.replace(/e(?=[\s,]|$)/gi, 'é');
    const variants = [...new Set([query, folded, expanded])];
    if (variants.length === 1) return query;
    return variants.map(v => `(${v})`).join(' OR ');
}

// Sort aggregation results so entries starting with the query come first.
function sortByPrefix(names, query) {
    names.sort((a, b) => {
        const aStarts = a.value.toLowerCase().startsWith(query) ? 0 : 1;
        const bStarts = b.value.toLowerCase().startsWith(query) ? 0 : 1;
        return aStarts - bStarts || a.value.localeCompare(b.value, 'da');
    });
}

function markHouseNumber(input) {
    return input.replace(/\b(\d+\w?)\b/, function (match) {
        if (/^\d{4}$/.test(match)) {
            return match;
        } else {
            return "_" + match + "_";
        }
    });
}

/**
 * When a query contains a comma (street, city) and the house number appears
 * after the comma, move it to the street part so it matches the string4
 * format: "Street Nr, Postnr City".
 *
 * Examples:
 *   "Frederiksberg Alle, Frederiksberg 35"       → "Frederiksberg Alle 35, Frederiksberg"
 *   "Frederiksberg Alle, 2000 Frederiksberg 35"  → "Frederiksberg Alle 35, 2000 Frederiksberg"
 *   "Frederiksberg Alle 35, 2000 Frederiksberg"  → unchanged (already correct)
 */
function normalizeAddressQuery(query) {
    const commaIdx = query.indexOf(',');
    if (commaIdx === -1) return query;

    const beforeComma = query.substring(0, commaIdx).trim();
    const afterComma = query.substring(commaIdx + 1).trim();

    // If street part already has a house number, leave it alone
    const streetNumbers = beforeComma.match(/\b(\d+\w?)\b/g);
    if (streetNumbers && streetNumbers.some(n => !/^\d{4}$/.test(n))) return query;

    // Find house number token after comma (skip 4-digit postcodes)
    const tokens = afterComma.split(/\s+/);
    const houseIdx = tokens.findIndex(t => /^\d+\w?$/.test(t) && !/^\d{4}$/.test(t));
    if (houseIdx === -1) return query;

    const houseNumber = tokens[houseIdx];
    tokens.splice(houseIdx, 1);

    return beforeComma + ' ' + houseNumber + (tokens.length ? ', ' + tokens.join(' ') : '');
}

/**
 * Check if a query contains non-postcode digits.
 */
function hasHouseNumber(query) {
    const matches = query.match(/\b(\d+\w?)\b/g);
    if (!matches) return false;
    return matches.some(m => !/^\d{4}$/.test(m));
}

/**
 * Danish address and cadastral search component.
 *
 * Dispatches a 'search:select' CustomEvent on the input element when a final
 * result is selected. The event detail contains:
 *   { type: 'adresse'|'matrikel', gid: string, value: string, searchType: string }
 *
 * Intermediate selections (street name, city, ejerlav) automatically narrow
 * the search — no event is fired until a concrete address or jordstykke is picked.
 *
 * @param {Object} [options]
 * @param {string} [options.el=".custom-search"] - CSS selector for the input element
 * @param {string} [options.host] - GC2 host URL
 * @param {string} [options.db] - GC2 database name
 * @param {boolean} [options.onlyAddress=false] - Only show address results (no matrikel)
 * @param {string|string[]} [options.komKode="*"] - Municipality code filter ("*" = all)
 * @param {number} [options.size=20] - Max number of results per query
 * @param {function} [options.onSelect] - Callback: ({type, gid, value, searchType}) => void
 * @returns {HTMLElement} The input element (for chaining event listeners)
 */
function danish(options = {}) {
    const {
        el = ".custom-search",
        host = DEFAULT_HOST,
        db = DEFAULT_DB,
        onlyAddress = false,
        onSelect,
        size = 20,
    } = options;

    let komKode = options.komKode || '*';
    let type1, type2, gids = {}, dslM, shouldA = [], shouldM = [], dsl1, dsl2;

    const esUrl = host + '/api/v2/elasticsearch/search/' + db;
    const client = createCentiaClient({baseUrl: host});
    const sql = new SqlNoToken(client);

    if (komKode !== "*") {
        if (typeof komKode === "string") {
            komKode = [komKode];
        }
        komKode.forEach(function (v) {
            shouldA.push({
                "term": {
                    "properties.kommunekode": "0" + v
                }
            });
            shouldM.push({
                "term": {
                    "properties.kommunekode": "" + v
                }
            });
        });
    }

    let standardSearches = [{
        name: 'adresse',
        displayKey: 'value',
        minLength: 0,
        templates: {
            header: '<h2 class="typeahead-heading">Adresser</h2>'
        },
        source: function (query, cb) {
            query = query.trim().replace(/\s+/g, ' ').replace(/,\s*$/, '');
            const rawQuery = query.toLowerCase();
            const hasComma = query.indexOf(',') !== -1;
            const hasSpaces = query.indexOf(' ') !== -1;

            if (hasHouseNumber(query)) {
                type1 = "adresse";
            } else if (hasComma || hasSpaces) {
                type1 = "vejnavn_bynavn";
            } else {
                type1 = "vejnavn,bynavn";
            }

            let names = [];
            (function ca() {
                let scriptTpl = `
def docval = params['_source']['properties'][params.fieldName].toLowerCase().replace('é', 'e').replace('ë', 'e').replace('è', 'e').replace('ê', 'e');
def path   = params.userQuery.toLowerCase().replace('é', 'e').replace('ë', 'e').replace('è', 'e').replace('ê', 'e');
int idx = docval.indexOf(path);
float baseScore = 1.0f;
float boundaryBonus = 0.0f;
float letterSuffixBonus = 0.0f;
float prefixBonus = 0.0f;
float houseBonus = 0.0f;

String houseToken = "";
int firstUnderscore = path.indexOf("_");
int lastUnderscore = path.lastIndexOf("_");
if (firstUnderscore != -1 && lastUnderscore > firstUnderscore) {
  houseToken = path.substring(firstUnderscore + 1, lastUnderscore);
}

if (houseToken != "") {
  List tokens = new ArrayList();
  int start = 0;
  while (true) {
    int pos = docval.indexOf(" ", start);
    if (pos == -1) {
      tokens.add(docval.substring(start));
      break;
    }
    tokens.add(docval.substring(start, pos));
    start = pos + 1;
  }
  for (int i = 0; i < tokens.size(); i++) {
    if (tokens.get(i).replace(",", "").equals(houseToken)) {
      houseBonus = 0.5f;
      break;
    }
  }
}

path = path.replace("_", "");

def normalizedDoc = docval.replace(",", "").trim();
def normalizedQuery = path.replace(",", "").trim();

int endPos = idx + path.length();
if (endPos >= docval.length()) {
    boundaryBonus = 10.0f;
} else {
    char nextChar = docval.charAt(endPos);
    if (!Character.isLetterOrDigit(nextChar)) {
        boundaryBonus = 1.0f;
    }
    else {
        if (path.length() > 0 && Character.isDigit(path.charAt(path.length() - 1))) {
            if (Character.isLetter(nextChar)) {
                letterSuffixBonus = 0.5f;
            }
        }
    }
}
if (docval.startsWith(path)) {
    prefixBonus = 3.0f;
} else {
    int N = 3;
    if (docval.length() >= N && path.length() >= N) {
        if (docval.regionMatches(true, 0, path, 0, N)) {
            prefixBonus = 2.0f;
        }
    }
}

if (normalizedDoc.equals(normalizedQuery)) {
    prefixBonus = 5.0f;
}
else if (normalizedDoc.startsWith(normalizedQuery)) {
    prefixBonus = 10.0f;
}

return baseScore + boundaryBonus + letterSuffixBonus + prefixBonus + houseBonus;
                        `;

                let safeQuery = accentVariants(hasComma ? normalizeAddressQuery(query) : query);
                let scoreQuery = hasComma ? normalizeAddressQuery(rawQuery) : rawQuery;
                switch (type1) {
                    case "vejnavn,bynavn":
                        gids[type1] = [];
                        dsl1 = {
                            "from": 0,
                            "size": size,
                            "query": {
                                "function_score": {
                                    "query": {
                                        "bool": {
                                            "must": {
                                                "query_string": {
                                                    "default_field": "properties.string2",
                                                    "query": safeQuery,
                                                    "default_operator": "AND"
                                                }
                                            },
                                            "filter": {
                                                "bool": {
                                                    "should": shouldA
                                                }
                                            }
                                        }
                                    },
                                    "boost_mode": "replace",
                                    "functions": [
                                        {
                                            "script_score": {
                                                "script": {
                                                    "source": scriptTpl,
                                                    "params": {
                                                        "fieldName": "string2",
                                                        "userQuery": scoreQuery
                                                    }
                                                }
                                            }
                                        }
                                    ]
                                }
                            },
                            "aggregations": {
                                "properties.postnrnavn": {
                                    "terms": {
                                        "field": "properties.postnrnavn",
                                        "size": size,
                                    },
                                    "aggregations": {
                                        "properties.postnr": {
                                            "terms": {
                                                "field": "properties.postnr",
                                                "size": size
                                            },
                                            "aggregations": {
                                                "properties.kommunekode": {
                                                    "terms": {
                                                        "field": "properties.kommunekode",
                                                        "size": size
                                                    },
                                                    "aggregations": {
                                                        "properties.regionskode": {
                                                            "terms": {
                                                                "field": "properties.regionskode",
                                                                "size": size
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        };
                        dsl2 = {
                            "from": 0,
                            "size": size,
                            "query": {
                                "function_score": {
                                    "query": {
                                        "bool": {
                                            "must": {
                                                "query_string": {
                                                    "default_field": "properties.string3",
                                                    "query": safeQuery,
                                                    "default_operator": "AND"
                                                }
                                            },
                                            "filter": {
                                                "bool": {
                                                    "should": shouldA
                                                }
                                            }
                                        }
                                    },
                                    "boost_mode": "replace",
                                    "functions": [
                                        {
                                            "script_score": {
                                                "script": {
                                                    "source": scriptTpl,
                                                    "params": {
                                                        "fieldName": "string3",
                                                        "userQuery": scoreQuery
                                                    }
                                                }
                                            }
                                        }
                                    ]
                                }
                            },
                            "aggregations": {
                                "properties.vejnavn": {
                                    "terms": {
                                        "field": "properties.vejnavn",
                                        "size": size,
                                    },
                                    "aggregations": {
                                        "properties.kommunekode": {
                                            "terms": {
                                                "field": "properties.kommunekode",
                                                "size": size
                                            },
                                            "aggregations": {
                                                "properties.regionskode": {
                                                    "terms": {
                                                        "field": "properties.regionskode",
                                                        "size": size
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        };
                        break;
                    case "vejnavn_bynavn":
                        gids[type1] = [];
                        dsl1 = {
                            "from": 0,
                            "size": size,
                            "query": {
                                "function_score": {
                                    "query": {
                                        "bool": {
                                            "must": {
                                                "query_string": {
                                                    "default_field": "properties.string1",
                                                    "query": safeQuery,
                                                    "default_operator": "AND"
                                                }
                                            },
                                            "filter": {
                                                "bool": {
                                                    "should": shouldA
                                                }
                                            }
                                        }
                                    },
                                    "boost_mode": "replace",
                                    "functions": [
                                        {
                                            "script_score": {
                                                "script": {
                                                    "source": scriptTpl,
                                                    "params": {
                                                        "fieldName": "string1",
                                                        "userQuery": scoreQuery
                                                    }
                                                }
                                            }
                                        }
                                    ]
                                }
                            },
                            "aggregations": {
                                "properties.vejnavn": {
                                    "terms": {
                                        "field": "properties.vejnavn",
                                        "size": size
                                    },
                                    "aggregations": {
                                        "properties.postnrnavn": {
                                            "terms": {
                                                "field": "properties.postnrnavn",
                                                "size": size
                                            },
                                            "aggregations": {
                                                "properties.kommunekode": {
                                                    "terms": {
                                                        "field": "properties.kommunekode",
                                                        "size": size
                                                    },
                                                    "aggregations": {
                                                        "properties.regionskode": {
                                                            "terms": {
                                                                "field": "properties.regionskode",
                                                                "size": size
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        };
                        break;
                    case "adresse":
                        gids[type1] = [];
                        dsl1 = {
                            "from": 0,
                            "size": size,
                            "query": {
                                "function_score": {
                                    "query": {
                                        "bool": {
                                            "must": {
                                                "query_string": {
                                                    "default_field": "properties.string4",
                                                    "query": safeQuery,
                                                    "default_operator": "AND"
                                                }
                                            },
                                            "filter": {
                                                "bool": {
                                                    "should": shouldA
                                                }
                                            }
                                        }
                                    },
                                    "functions": [
                                        {
                                            "script_score": {
                                                "script": {
                                                    "source": scriptTpl,
                                                    "params": {
                                                        "fieldName": "string4",
                                                        "userQuery": markHouseNumber(scoreQuery)
                                                    }
                                                }
                                            }
                                        }
                                    ],
                                    "boost_mode": "replace"
                                }
                            },
                            "sort": [
                                {"_score": "desc"}
                            ]
                        };
                        break;
                }

                fetch(esUrl + '/dar/adgangsadresser_view', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json; charset=utf-8'
                    },
                    body: JSON.stringify(dsl1)
                })
                    .then(response => response.json())
                    .then(response => {
                        if (response.hits === undefined) { cb([]); return; }
                        if (type1 === "vejnavn,bynavn") {
                            if (response.aggregations === undefined) { cb([]); return; }
                            if (response.aggregations["properties.postnrnavn"] === undefined) { cb([]); return; }
                            response.aggregations["properties.postnrnavn"].buckets.forEach(function (hit) {
                                names.push({value: hit.key});
                            });
                            fetch(esUrl + '/dar/adgangsadresser_view', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json; charset=utf-8'
                                },
                                body: JSON.stringify(dsl2)
                            })
                                .then(response => response.json())
                                .then(response => {
                                    if (response.hits === undefined) { cb([]); return; }
                                    if (type1 === "vejnavn,bynavn") {
                                        if (response.aggregations === undefined) { cb([]); return; }
                                        if (response.aggregations["properties.vejnavn"] === undefined) { cb([]); return; }
                                        response.aggregations["properties.vejnavn"].buckets.forEach(function (hit) {
                                            names.push({value: hit.key});
                                        });
                                    }
                                    if (names.length === 1 && (type1 === "vejnavn,bynavn" || type1 === "vejnavn_bynavn")) {
                                        type1 = "adresse";
                                        names = [];
                                        gids[type1] = [];
                                        ca();
                                    } else {
                                        sortByPrefix(names, rawQuery);
                                        cb(names);
                                    }

                                })
                        } else if (type1 === "vejnavn_bynavn") {
                            if (response.aggregations === undefined) { cb([]); return; }
                            if (response.aggregations["properties.vejnavn"] === undefined) { cb([]); return; }
                            response.aggregations["properties.vejnavn"].buckets.forEach(function (hit) {
                                var str = hit.key;
                                hit["properties.postnrnavn"].buckets.forEach(function (n) {
                                    names.push({value: str + ", " + n.key});
                                });
                            });
                            if (names.length === 1 && (type1 === "vejnavn,bynavn" || type1 === "vejnavn_bynavn")) {
                                type1 = "adresse";
                                names = [];
                                gids[type1] = [];
                                ca();
                            } else {
                                sortByPrefix(names, rawQuery);
                                cb(names);
                            }

                        } else if (type1 === "adresse") {
                            response.hits.hits.forEach(function (hit) {
                                var str = hit._source.properties.string4;
                                gids[type1][str] = hit._source.properties.gid;
                                names.push({value: str});
                            });
                            if (names.length === 1 && (type1 === "vejnavn,bynavn" || type1 === "vejnavn_bynavn")) {
                                type1 = "adresse";
                                names = [];
                                gids[type1] = [];
                                ca();
                            } else {
                                // Sort by street name prefix from the original query
                                const streetPrefix = scoreQuery.split(',')[0].replace(/\s*\d+\w?\s*/g, ' ').trim();
                                sortByPrefix(names, streetPrefix);
                                cb(names);
                            }
                        }

                    })
            })();
        }
    }, {
        name: 'matrikel',
        displayKey: 'value',
        templates: {
            header: '<h2 class="typeahead-heading">Matrikel</h2>'
        },
        source: function (query, cb) {
            query = query.trim().replace(/\s+/g, ' ');
            var names = [];
            type2 = (query.match(/\d+/g) != null) ? "jordstykke" : "ejerlav";
            if (onlyAddress) {
                cb([]);
                return;
            }
                (function ca() {

                    switch (type2) {
                        case "jordstykke":
                            gids[type2] = [];
                            dslM = {
                                "from": 0,
                                "size": size,
                                "query": {
                                    "bool": {
                                        "must": {
                                            "query_string": {
                                                "default_field": "properties.string1",
                                                "query": accentVariants(query.toLowerCase()),
                                                "default_operator": "AND"
                                            }
                                        },
                                        "filter": {
                                            "bool": {
                                                "should": shouldM
                                            }
                                        }
                                    }
                                },
                                "sort": [
                                    {
                                        "properties.nummer": {
                                            "order": "asc"
                                        }
                                    },
                                    {
                                        "properties.litra": {
                                            "order": "asc"
                                        }
                                    },
                                    {
                                        "properties.ejerlavsnavn": {
                                            "order": "asc"
                                        }
                                    }
                                ]
                            };
                            break;
                        case "ejerlav":
                            gids[type2] = [];
                            dslM = {
                                "from": 0,
                                "size": size,
                                "query": {
                                    "bool": {
                                        "must": {
                                            "query_string": {
                                                "default_field": "properties.string1",
                                                "query": accentVariants(query.toLowerCase()),
                                                "default_operator": "AND"
                                            }
                                        },
                                        "filter": {
                                            "bool": {
                                                "should": shouldM
                                            }
                                        }
                                    }
                                },
                                "aggregations": {
                                    "properties.ejerlavsnavn": {
                                        "terms": {
                                            "field": "properties.ejerlavsnavn",
                                            "order": {
                                                "_term": "asc"
                                            },
                                            "size": size
                                        },
                                        "aggregations": {
                                            "properties.kommunekode": {
                                                "terms": {
                                                    "field": "properties.kommunekode",
                                                    "size": size
                                                }
                                            }
                                        }
                                    }
                                }
                            };
                            break;
                    }

                    fetch(esUrl + '/matrikel/jordstykke_view', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json; charset=utf-8'
                        },
                        body: JSON.stringify(dslM)
                    })
                        .then(response => response.json())
                        .then(response => {
                            if (response.hits === undefined) { cb([]); return; }
                            if (type2 === "ejerlav") {
                                if (response.aggregations === undefined) { cb([]); return; }
                                if (response.aggregations["properties.ejerlavsnavn"] === undefined) { cb([]); return; }
                                response.aggregations["properties.ejerlavsnavn"].buckets.forEach(function (hit) {
                                    names.push({value: hit.key});
                                });
                            } else {
                                response.hits.hits.forEach(function (hit) {
                                    var str = hit._source.properties.string1;
                                    gids[type2][str] = hit._source.properties.gid;
                                    names.push({value: str});
                                });
                            }
                            if (names.length === 1 && (type2 === "ejerlav")) {
                                type2 = "jordstykke";
                                names = [];
                                gids[type2] = [];
                                ca();
                            } else {
                                cb(names);
                            }

                        })
                })();
        }
    }];

    const ac = new Autocomplete(el, {
        highlight: false,
        hint: false,
    }, ...standardSearches);

    const inputEl = typeof el === 'string' ? document.querySelector(el) : el;

    /**
     * Fetch the full GeoJSON feature from the database via Centia SDK.
     */
    async function fetchFeature(resultType, gid) {
        const table = resultType === "adresse"
            ? "dar.adgangsadresser_m_vejnavn"
            : "matrikel.jordstykke";
        return await sql.postSqlNoToken(db, {
            q: `SELECT *
                FROM ${table}
                WHERE ${resultType === "adresse" ? "id" : "gid"} = '${gid}'`, srs: 4326, output_format: "geojson"
        });
    }

    inputEl.addEventListener('typeahead:selected', function (event) {
        const {datum, name} = event.detail;

        // Final selection: an actual address or jordstykke with a GID
        if ((type1 === "adresse" && name === "adresse") || (type2 === "jordstykke" && name === "matrikel")) {
            const resultType = name === "adresse" ? "adresse" : "matrikel";
            const gid = name === "adresse" ? gids[type1][datum.value] : gids[type2][datum.value];

            fetchFeature(resultType, gid).then(data => {
                const detail = {
                    type: resultType,
                    gid: gid,
                    value: datum.value,
                    searchType: name === "adresse" ? type1 : type2,
                    feature: data.features[0],
                };

                // Dispatch event for external listeners
                inputEl.dispatchEvent(new CustomEvent('search:select', {detail}));

                // Call onSelect callback if provided
                if (onSelect) {
                    onSelect(detail);
                }
            });
        } else {
            // Intermediate selection — narrow the search by injecting the value back
            setTimeout(function () {
                inputEl.value = datum.value + " ";
                inputEl.dispatchEvent(new Event("paste"));
                inputEl.dispatchEvent(new Event("input"));
            }, 100);
        }
    });

    return inputEl;
}

export default danish;
