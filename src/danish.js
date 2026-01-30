/*
 * @author     Martin Høgh
 * @copyright  2013-2026 MapCentia ApS
 * @license    http://www.gnu.org/licenses/#AGPL  GNU AFFERO GENERAL PUBLIC LICENSE 3
 */

'use strict';

import events from 'backbone';
import $ from 'jquery';
// import 'corejs-typeahead/dist/typeahead.jquery.js';
import './typeahead.jquery.js';
import { registerTypeahead } from './typeahead.jquery.js';
registerTypeahead($);

/**
 *
 * @type {*|exports|module.exports}
 */
var cloud;

/**
 * @type {*|exports|module.exports}
 */
var backboneEvents;

var draw;

/**
 *
 * @type {string}
 */
//const AHOST = "http://127.0.0.1:8080";
const AHOST = "https://dk.gc2.io";

/**
 *
 * @type {string}
 */
//const ADB = "mydb";
const ADB = "dk";

/**
 *
 * @type {string}
 */
const MHOST = "https://dk.gc2.io";

/**
 *
 * @type {string}
 */
const MDB = "dk";

let fromVarsIsDone = false;


function markHouseNumber(input) {
    return input.replace(/\b(\d+\w?)\b/, function (match) {
        // If the token is exactly 4 digits, assume it’s a zip code and leave it unaltered.
        if (/^\d{4}$/.test(match)) {
            return match;
        } else {
            return "_" + match + "_";
        }
    });
}

let getPlaceStore = () => {
    return new geocloud.sqlStore({
        jsonp: false,
        method: "POST",
        dataType: "json",
        sql: null,
        clickable: true,
        // Make Awesome Markers
        pointToLayer: function (feature, latlng) {
            return L.marker(latlng, {
                icon: L.AwesomeMarkers.icon(iconOptions
                )
            });
        },
        onEachFeature: function (feature, layer) {
            layer._vidi_type = "query_draw";
            layer._vidi_marker = true;
            layer._vidi_awesomemarkers = iconOptions;
        },
        styleMap: {
            weight: 3,
            color: advanced ? $("#search-colorpicker-input").val() : "#C31919",
            dashArray: '',
            Opacity: 1,
            fillOpacity: 0
        },
        onLoad: onLoad
    });
}


function danish(onLoad, el = ".custom-search", onlyAddress, getProperty, caller) {
    var type1, type2, type3, type4, gids = {}, searchString, dslM, shouldA = [], shouldM = [], dsl1, dsl2,
        komKode = '*', placeStores = {}, maxZoom, searchTxt,
        esrSearchActive = false,
        sfeSearchActive = false,
        advanced = false,
        size = 20;


    // Listen for clearing event
    // =========================

    events.on("clear:search", function () {
        console.info("Clearing search");
        for (const property in placeStores) {
            placeStores[property].reset();
        }
        $(".typeahead").val("");
    });


    if (komKode !== "*") {
        if (typeof komKode === "string") {
            komKode = [komKode];
        }
        $.each(komKode, function (i, v) {
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
            if (query.match(/\d+/g) === null && query.match(/\s+/g) === null) {
                type1 = "vejnavn,bynavn";
            }
            if (query.match(/\d+/g) === null && query.match(/\s+/g) !== null) {
                type1 = "vejnavn_bynavn";
            }
            if (query.match(/\d+/g) !== null) {
                type1 = "adresse";
            }
            let names = [];
            (function ca() {
                let scriptTpl = `
def docval = params['_source']['properties'][params.fieldName].toLowerCase();
def path   = params.userQuery.toLowerCase();
int idx = docval.indexOf(path);
// if (idx == -1) {
//     return 0.0;
// }
float baseScore = 1.0f;
float boundaryBonus = 0.0f;
float letterSuffixBonus = 0.0f;
float prefixBonus = 0.0f;
float houseBonus = 0.0f;


// Assume that we have pre-marked the house number in the query string 
// by surrounding it with underscores. For example: "Peter Bangs Vej _6d_, 2000 Frederiksberg"
// Extract the house token from the query.
String houseToken = "";
int firstUnderscore = path.indexOf("_");
int lastUnderscore = path.lastIndexOf("_");
if (firstUnderscore != -1 && lastUnderscore > firstUnderscore) {
  houseToken = path.substring(firstUnderscore %2B 1, lastUnderscore);
}

// Now, manually split the document text into tokens.
// (Since we can’t use split(), we do it manually.)
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
    start = pos %2B 1;
  }
  
  // If any token equals the houseToken exactly, add the bonus.
  for (int i = 0; i < tokens.size(); i%2B%2B) {
    if (tokens.get(i).replace(",", "").equals(houseToken)) {
      houseBonus = 0.5f;  // Adjust the bonus as needed.
      break;
    }
  }
}

// Reset path to remove the house token.
path = path.replace("_", "");

// Create normalized versions (remove commas and trim extra spaces)
def normalizedDoc = docval.replace(",", "").trim();
def normalizedQuery = path.replace(",", "").trim();

int endPos = idx %2B path.length();
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
    prefixBonus = 3.0f; // give a large bonus if doc text starts with the entire query
} else {
    // Else, maybe do the partial check for N characters
    int N = 3;
    if (docval.length() >= N && path.length() >= N) {
        if (docval.regionMatches(true, 0, path, 0, N)) {
            prefixBonus = 2.0f; // smaller bonus for partial match
        }
    }
}

// If the normalized doc equals the normalized query, award a high bonus
if (normalizedDoc.equals(normalizedQuery)) {
    prefixBonus = 5.0f;
}
// Else if the normalized doc starts with the normalized query, award a moderate bonus
else if (normalizedDoc.startsWith(normalizedQuery)) {
    prefixBonus = 10.0f;
}

return baseScore %2B boundaryBonus %2B letterSuffixBonus %2B prefixBonus %2B houseBonus;
                        `;


                let safeQuery = query;
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
                                                        "userQuery": safeQuery
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
                                                        "userQuery": safeQuery
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
                                                        "userQuery": safeQuery
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
                                                        "userQuery": markHouseNumber(safeQuery)
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

                $.ajax({
                    url: AHOST + '/api/v2/elasticsearch/search/' + ADB + '/dar/adgangsadresser_view',
                    data: JSON.stringify(dsl1),
                    contentType: "application/json; charset=utf-8",
                    scriptCharset: "utf-8",
                    dataType: 'json',
                    type: "POST",
                    success: function (response) {
                        if (response.hits === undefined) return;
                        if (type1 === "vejnavn,bynavn") {
                            if (response.aggregations === undefined) return;
                            if (response.aggregations["properties.postnrnavn"] === undefined) return;
                            $.each(response.aggregations["properties.postnrnavn"].buckets, function (i, hit) {
                                var str = hit.key;
                                names.push({value: str});
                            });
                            $.ajax({
                                url: AHOST + '/api/v2/elasticsearch/search/' + ADB + '/dar/adgangsadresser_view',
                                data: JSON.stringify(dsl2),
                                contentType: "application/json; charset=utf-8",
                                scriptCharset: "utf-8",
                                dataType: 'json',
                                type: "POST",
                                success: function (response) {
                                    if (response.hits === undefined) return;
                                    if (type1 === "vejnavn,bynavn") {
                                        if (response.aggregations === undefined) return;
                                        if (response.aggregations["properties.vejnavn"] === undefined) return;
                                        $.each(response.aggregations["properties.vejnavn"].buckets, function (i, hit) {
                                            var str = hit.key;
                                            names.push({value: str});
                                        });
                                    }
                                    if (names.length === 1 && (type1 === "vejnavn,bynavn" || type1 === "vejnavn_bynavn")) {
                                        type1 = "adresse";
                                        names = [];
                                        gids[type1] = [];
                                        ca();
                                    } else {
                                        console.log(names);
                                        cb(names);
                                    }

                                }
                            })
                        } else if (type1 === "vejnavn_bynavn") {
                            if (response.aggregations === undefined) return;
                            if (response.aggregations["properties.vejnavn"] === undefined) return;
                            $.each(response.aggregations["properties.vejnavn"].buckets, function (i, hit) {
                                var str = hit.key;
                                $.each(hit["properties.postnrnavn"].buckets, function (m, n) {
                                    var tmp = str;
                                    tmp = tmp + ", " + n.key;
                                    names.push({value: tmp});
                                });

                            });
                            if (names.length === 1 && (type1 === "vejnavn,bynavn" || type1 === "vejnavn_bynavn")) {
                                type1 = "adresse";
                                names = [];
                                gids[type1] = [];
                                ca();
                            } else {
                                cb(names);
                            }

                        } else if (type1 === "adresse") {
                            $.each(response.hits.hits, function (i, hit) {
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
                                cb(names);
                            }
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
            var names = [];
            type2 = (query.match(/\d+/g) != null) ? "jordstykke" : "ejerlav";
            if (!onlyAddress) {
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
                                                "query": query.toLowerCase(),
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
                                                "query": query.toLowerCase(),
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

                    $.ajax({
                        url: MHOST + '/api/v2/elasticsearch/search/' + MDB + '/matrikel/jordstykke_view',
                        data: JSON.stringify(dslM),
                        contentType: "application/json; charset=utf-8",
                        scriptCharset: "utf-8",
                        dataType: 'json',
                        type: "POST",
                        success: function (response) {
                            if (response.hits === undefined) return;
                            if (type2 === "ejerlav") {
                                if (response.aggregations === undefined) return;
                                if (response.aggregations["properties.ejerlavsnavn"] === undefined) return;
                                $.each(response.aggregations["properties.ejerlavsnavn"].buckets, function (i, hit) {
                                    var str = hit.key;
                                    names.push({value: str});
                                });
                            } else {
                                $.each(response.hits.hits, function (i, hit) {
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

                        }
                    })
                })();
            }
        }
    }];

    fromVarsIsDone = true;
    $(el).typeahead({
        highlight: false,
        hint: false,
    }, ...standardSearches);

    const extraSearchesNames = [];
    $(el).bind('typeahead:selected', function (obj, datum, name) {
        if ((type1 === "adresse" && name === "adresse") || (type2 === "jordstykke" && name === "matrikel")
            || (type3 === "esr_nr" && name === "esr_ejdnr") || (type4 === "sfe_nr" && name === "sfe_ejdnr")
            || extraSearchesNames.indexOf(name) !== -1
        ) {
            let key;
            if (advanced) {
                key = datum.value;
            } else {
                key = "simple";
                try {
                    placeStores[key].reset();
                } catch (e) {
                }
            }
            searchString = datum.value;
            switch (name) {
                case "esr_ejdnr" :
                    placeStores[key] = getPlaceStore();
                    placeStores[key].db = MDB;
                    placeStores[key].host = MHOST;
                    if (advanced) {
                        placeStores[key].sql = "SELECT esr_ejendomsnummer,matrikelnummer,ejerlavsnavn,the_geom FROM matrikel.jordstykke WHERE esr_ejendomsnummer = (SELECT esr_ejendomsnummer FROM matrikel.jordstykke WHERE gid=" + gids[type3][datum.value] + ")";
                    } else {
                        placeStores[key].sql = "SELECT esr_ejendomsnummer,ST_Multi(ST_Union(the_geom)),ST_asgeojson(ST_transform(ST_Multi(ST_Union(the_geom)),4326)) as geojson FROM matrikel.jordstykke WHERE esr_ejendomsnummer = (SELECT esr_ejendomsnummer FROM matrikel.jordstykke WHERE gid=" + gids[type3][datum.value] + ") group by esr_ejendomsnummer";
                    }
                    placeStores[key].load();
                    break;
                case "sfe_ejdnr" :
                    placeStores[key] = getPlaceStore();
                    placeStores[key].db = MDB;
                    placeStores[key].host = MHOST;
                    if (advanced) {
                        placeStores[key].sql = "SELECT sfe_ejendomsnummer,matrikelnummer,ejerlavsnavn,the_geom FROM matrikel.jordstykke WHERE sfe_ejendomsnummer = (SELECT sfe_ejendomsnummer FROM matrikel.jordstykke WHERE gid=" + gids[type4][datum.value] + ")";
                    } else {
                        placeStores[key].sql = "SELECT sfe_ejendomsnummer,ST_Multi(ST_Union(the_geom)),ST_asgeojson(ST_transform(ST_Multi(ST_Union(the_geom)),4326)) as geojson FROM matrikel.jordstykke WHERE sfe_ejendomsnummer = (SELECT sfe_ejendomsnummer FROM matrikel.jordstykke WHERE gid=" + gids[type4][datum.value] + ") group by sfe_ejendomsnummer";
                    }
                    placeStores[key].load();
                    break;
                case "matrikel" :
                    placeStores[key] = getPlaceStore();
                    placeStores[key].db = MDB;
                    placeStores[key].host = MHOST;
                    if (getProperty) {
                        placeStores[key].sql = "SELECT sfe_ejendomsnummer,ST_Multi(ST_Union(the_geom)),ST_asgeojson(ST_transform(ST_Multi(ST_Union(the_geom)),4326)) as geojson FROM matrikel.jordstykke WHERE sfe_ejendomsnummer = (SELECT sfe_ejendomsnummer FROM matrikel.jordstykke WHERE gid=" + gids[type2][datum.value] + ") group by sfe_ejendomsnummer";
                    } else {
                        placeStores[key].sql = "SELECT gid,the_geom,matrikelnummer,ejerlavsnavn, ST_asgeojson(ST_transform(the_geom,4326)) as geojson FROM matrikel.jordstykke WHERE gid='" + gids[type2][datum.value] + "'";
                    }
                    placeStores[key].load();
                    break;
                case "adresse" :
                    // placeStores[key] = getPlaceStore();
                    // placeStores[key].db = ADB;
                    // placeStores[key].host = AHOST;
                    let sql;
                    if (getProperty) {
                        sql = "SELECT sfe_ejendomsnummer,ST_Multi(ST_Union(the_geom)),ST_asgeojson(ST_transform(ST_Multi(ST_Union(the_geom)),4326)) as geojson FROM matrikel.jordstykke WHERE sfe_ejendomsnummer = (SELECT sfe_ejendomsnummer FROM matrikel.jordstykke WHERE (the_geom && (SELECT ST_transform(the_geom, 25832) FROM dar.adgangsadresser WHERE id='" + gids[type1][datum.value] + "')) AND ST_Intersects(the_geom, (SELECT ST_transform(the_geom, 25832) FROM dar.adgangsadresser WHERE id='" + gids[type1][datum.value] + "'))) group by sfe_ejendomsnummer";
                    } else {
                        sql = "SELECT id,husnr,postnr,kommunekode,the_geom,ST_asgeojson(ST_transform(the_geom,4326)) as geojson FROM dar.adgangsadresser WHERE id='" + gids[type1][datum.value] + "'";
                    }
                    // placeStores[key].load();
                    console.log(sql);
                    break;
                default: // Extra searches
                    placeStores[key] = getPlaceStore();
                    placeStores[key].db = extraSearchesObj[name].db;
                    placeStores[key].host = extraSearchesObj[name]?.host || '';
                    placeStores[key].zoom = extraSearchesObj[name]?.zoom || maxZoom;
                    placeStores[key].sql = "SELECT *,ST_asgeojson(ST_transform(" + extraSearchesObj[name].relation.geom + ",4326)) as geojson FROM " + extraSearchesObj[name].relation.name + " WHERE " + extraSearchesObj[name].relation.key + "='" + gids[name][datum.value] + "'";
                    if (!extraSearchesObj[name]?.host) {
                        placeStores[key].uri = '/api/sql'
                    }
                    placeStores[key].load();
                    break;
            }
        } else {
            setTimeout(function () {
                $(el).val(datum.value + " ").trigger("paste").trigger("input");
            }, 100)
        }
    });
}

export default danish;
