"""Price UNIDENTIFIED unique jewels on trade (Valdo rewards drop unidentified).
Writes unid_values.json {name: {"value": median div of 10 cheapest unid+uncorrupted, "listings": n}}.
Usage: python unid_jewels.py [--refresh] [extra names...]   (skips names already in unid_values.json)"""
import json, os, statistics, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import valdo_scan as vs

JEWELS = [
    "Watcher's Eye", "Forbidden Flame", "Forbidden Flesh", "Megalomaniac", "Voices", "Grand Spectrum",
    "Split Personality", "Impossible Escape", "Thread of Hope", "Lethal Pride", "Glorious Vanity",
    "Brutal Restraint", "Militant Faith", "Elegant Hubris", "Sublime Vision", "Unnatural Instinct",
    "Inspired Learning", "That Which Was Taken", "Bound Fate", "Combat Focus", "Intuitive Leap",
    "Apex Mode", "Nadir Mode", "Superior Mode", "The Light of Meaning", "Sudden Ignition",
    "Calamitous Visions", "Natural Affinity", "Dissolution of the Flesh", "Melding of the Flesh",
    "Transcendent Flesh", "Transcendent Mind", "Transcendent Spirit", "Amanamu's Gaze", "Tecrod's Gaze",
    "Ulaman's Gaze", "Kurgal's Gaze", "One With Nothing", "Cooperation", "Ambition", "Curiosity",
]
TIMELESS = ["Heroic Tragedy", "Lethal Pride", "Glorious Vanity", "Brutal Restraint", "Militant Faith", "Elegant Hubris"]
CLUSTERS = ["Megalomaniac", "Voices", "Kitava's Teachings", "Natural Affinity", "One With Nothing", "The Front Line",
            "The Interrogation", "The Siege", "The Tempest Rising", "Calamitous Visions", "The Red Nightmare",
            "The Green Nightmare", "The Blue Nightmare", "The Red Dream", "The Green Dream", "The Blue Dream"]


def _median(name, div, identified):
    """Median of the 10 cheapest copies (identified: uncorrupted only). Corruption is filtered locally because the
    trade API returns nothing for some jewels (Forbidden Flame, Megalomaniac...) with corrupted=false."""
    misc = {}
    if identified is not None:
        misc["identified"] = {"option": "true" if identified else "false"}
    filters = {"misc_filters": {"filters": misc}}
    if identified:  # rarity=unique together with identified=false returns nothing for some jewels
        filters["type_filters"] = {"filters": {"rarity": {"option": "unique"}}}
    q = {"query": {"status": {"option": "any"}, "name": name, "filters": filters}, "sort": {"price": "asc"}}
    r = vs.trade_search(q)
    ids = r.get("result", [])[:30]
    if not ids:
        return None, 0
    vals = []
    for x in vs.trade_fetch(ids, r["id"]):
        if identified and x["item"].get("corrupted"):
            continue  # unid copies of many jewels all show as corrupted on trade, so keep those
        v = vs.to_div(x["listing"].get("price"), div)
        if v:
            vals.append(v)
        if len(vals) == 10:
            break
    return (statistics.median(vals) if vals else None), len(vals)


def unid_value(name, div):
    """Valdo rewards drop unidentified, so value = median of the 10 cheapest uncorrupted unid copies.
    Only if fewer than 3 unid listings exist, fall back to the identified median."""
    u, un = _median(name, div, identified=False)
    if u and un >= 3:
        return u, un, "unid"
    i, inn = _median(name, div, identified=True)
    return (i, inn, "id") if i else (u, un, "unid")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    out_f = os.path.join(vs.HERE, "unid_values.json")
    div, _ = vs.ninja_values()
    refresh = "--refresh" in sys.argv
    try:
        out = {} if refresh else json.load(open(out_f, encoding="utf-8"))
    except FileNotFoundError:
        out = {}
    names = list(dict.fromkeys(JEWELS + TIMELESS + CLUSTERS + [a for a in sys.argv[1:] if a != "--refresh"]))
    for n in names:
        if n in out:
            continue
        v, c, mode = unid_value(n, div)
        out[n] = {"value": v, "listings": c, "mode": mode}
        print(f"{n}: {('%.2f' % v) if v else '-'} div {mode} ({c} listings)", flush=True)
        json.dump(out, open(out_f, "w", encoding="utf-8"), indent=1)
