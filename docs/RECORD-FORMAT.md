# Record format

Each area keeps one JSON array of records in `source/countries/<cc>.json`, sorted by date. Thailand layers keep one array per layer in `source/thailand/<layer>.json` with the same fields, without `layer`.

## Fields

Every record has: "layer" (one of the layer ids below; Thailand files omit it), "date":"YYYY-MM-DD" (event date; if only publication date known set "date_is_pub": true), "kind" (from that layer's list), "title" (short, your own words), "detail" (1–2 sentences, your own words, attribute claims; put money amounts here with currency), "place", "district" (or null), "prov" (province/region/prefecture or "Nationwide"), "lat", "lon", "prec", "killed" (int or null), "injured" (int or null), "arrested" (int or null), "agency" (lead/issuing agency or null), "src", "srcname", "attribution". Optional where relevant: "value","value_unit" (rain mm, temperature, AQI…), "storm_name", "magnitude", "cases", "deaths_reported", "mode" (road/rail/air/sea), "route", "people" (people rescued/affected, int).

## Layers and kinds

- flood: flood_event, flash_flood, river_warning, dam_release, landslide, other
- border: border_incident, closure_or_restriction, military_activity, missile_or_weapons_test, maritime_incident, airspace_incursion, diplomatic_statement, other   (border/territorial security incl. sea and air)
- insurgency: ied, attack_on_facility, ambush, shooting, arson, raid_or_arrest, propaganda, peace_talks, statistics, other   (insurgent/armed-group/terror violence; many countries have none)
- crime: drugs, human_trafficking, smuggling_migration, gambling, cybercrime, extortion_kidnap, counterfeit, environmental, wildlife, other
- scam: compound, raid, rescue_repatriation, border_measure, sanction, arrest, other   (scam centres / online fraud rings and victims trafficked to them)
- aml: asset_seizure, mule_accounts, crypto, underground_banking, gambling_laundering, shell_nominee, advisory_policy, sanction, arrest_charge, other
- weather: storm, severe_thunderstorm, heavy_rain_warning, monsoon, heat, cold, drought, forecast_announcement, other
- infra: outage, dam_reservoir, port_airport_disruption, bridge_damage, telecom_outage, water_supply, other
- transport: road_closure, bridge_closure, construction, rail_disruption, air_disruption, port_disruption, ferry_incident, mass_casualty_crash, statistics, other
- safety: fire, wildfire, industrial_explosion, chemical_hazmat, collapse, mass_casualty, earthquake, landslide, civil_disturbance, other
- health: outbreak, ddc_warning (health-agency warning or measure), hospital_strain, animal_disease, food_contamination, vector_surveillance, air_quality, heat_health, other

Warnings and forecasts are claims by the issuing agency; say who issued them in "agency"/"attribution". Statistics (year-to-date totals) use kind "statistics" where listed, otherwise "other".

## Rules

- Include a record only if its source page was opened and read; `src` must be that page.
- Never invent dates, places, figures or URLs; leave unknown fields `null`.
- No names of private individuals. Only officials, or people formally charged or sanctioned in major cases.
- Coordinates may be approximate centres (`prec: "approx"`); `"exact"` only for a precisely known site; `null` with `prec: "none"` for nationwide items.
- Warnings, forecasts and official statistics are claims by the issuing agency; name it in `agency` and `attribution`.
