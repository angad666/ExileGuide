"""Build a Better Trading (Chrome extension) folder of Valdo map searches.

One bookmark per valuable reward unique. Each search already has:
  * the reward filter (Map Completion Reward)
  * max price = min(value - min_profit_div, value / (1 + min_roi))  [and max_price_div if set]
  * the excluded mods from config.json as a NOT group
  * status from config (default "securable" = instant buyout only)

Reward value = median of the 10 cheapest uncorrupted trade listings (corrupted as fallback).
Uses results.json from valdo_scan.py for values it already knows, and checks the rest on trade.

Usage:  python bt_export.py
Output: better_trading_valdo.txt -> Better Trading > Import, paste the whole line.
"""
import base64, gzip, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import valdo_scan as vs

HERE = vs.HERE
CFG = vs.CFG
BT = CFG["better_trading"]


def query_id(q):
    """Trade search ids are gzip(JSON) in url-safe base64; same header bytes as the site makes."""
    raw = bytearray(gzip.compress(json.dumps(q, separators=(",", ":")).encode(), mtime=0))
    raw[8], raw[9] = 0x00, 0x0A
    return base64.urlsafe_b64encode(bytes(raw)).decode().rstrip("=")


def build_query(reward, max_price):
    q = {"status": {"option": BT["status"]},
         "stats": [{"type": "not", "filters": [{"id": k[5:], "disabled": False} for k in CFG["exclude_mods"]]}],
         "filters": {"trade_filters": {"filters": {"price": {"option": "divine", **({"max": max_price} if max_price else {})}},
                                       "disabled": False}}}
    if reward:
        q["filters"]["map_filters"] = {"filters": {"map_completion_reward": {"option": reward}}}
    else:
        q["type"] = "Valdo Map"
    return q


def bt_string(title, entries):
    folder = {"icn": "map", "tit": title, "ver": "1",
              "trs": [{"tit": t, "loc": "1:search:" + query_id(q)} for t, q in entries]}
    return "3:" + base64.b64encode(json.dumps(folder, separators=(",", ":")).encode()).decode()


def main():
    try:
        res = json.load(open(os.path.join(HERE, "results.json"), encoding="utf-8"))
        known = {s["reward"]: s for s in res["searches"]}
        div_rate = res["divine_chaos"]
    except FileNotFoundError:
        known, div_rate = {}, None
    div_rate_live, ninja = vs.ninja_values()
    div_rate = div_rate or div_rate_live
    overrides = CFG.get("reward_value_overrides_div", {})

    # cache of trade-verified values from earlier runs (delete reward_values.json to re-check all)
    cache_f = os.path.join(HERE, "reward_values.json")
    import time
    try:
        fresh = time.time() - os.path.getmtime(cache_f) < 24 * 3600 and "--refresh" not in sys.argv
        cache = json.load(open(cache_f, encoding="utf-8")) if fresh else {}
    except FileNotFoundError:
        cache = {}
    if not cache:
        known = {}  # also ignore the older scan results when refreshing
    for name, (v, c) in cache.items():
        known.setdefault(name, {"trade_value": v, "trade_listings": c})

    values = {}
    cands = sorted([(v, n) for n, v in ninja.items() if v >= BT["verify_rewards_min_ninja_div"]], reverse=True)
    print(f"{len(cands)} rewards with ninja value >= {BT['verify_rewards_min_ninja_div']} div", flush=True)
    for nv, name in cands:
        if name in overrides:
            values[name] = (overrides[name], 99); continue
        s = known.get(name, {})
        if s.get("trade_value"):
            values[name] = (s["trade_value"], s.get("trade_listings") or 10); continue
        tv, cnt = vs.trade_unique_value(name, div_rate)
        print(f"  {name}: ninja {nv:.1f} -> trade {tv if tv is None else round(tv, 1)} ({cnt} listings)", flush=True)
        if tv:
            values[name] = (tv, cnt)
    for name, v in overrides.items():
        values.setdefault(name, (v, 99))
    json.dump({n: v for n, v in values.items() if n not in overrides}, open(cache_f, "w", encoding="utf-8"), indent=1)

    # Valdo rewards drop unidentified: for jewels with random mods / seeds, the unid price is
    # what you can actually sell for (unid_jewels.py writes unid_values.json).
    unid = set()
    try:
        for name, u in json.load(open(os.path.join(HERE, "unid_values.json"), encoding="utf-8")).items():
            if u.get("value") and u.get("listings", 0) >= 3 and name not in overrides:
                values[name] = (u["value"], u["listings"])
                if u.get("mode", "unid").startswith("unid"):
                    unid.add(name)
    except FileNotFoundError:
        print("no unid_values.json - run unid_jewels.py to include unidentified jewels")

    roi, minp = CFG["min_roi"], CFG["min_profit_div"]
    cap = (CFG["max_price_div"] - 0.01) if CFG.get("max_price_div") else float("inf")
    entries = [("All Valdo (safe mods)" + (f" <{CFG['max_price_div']}d" if CFG.get("max_price_div") else ""),
                build_query(None, cap if cap != float("inf") else None))]
    rows = []
    for name, (v, cnt) in sorted(values.items(), key=lambda kv: -kv[1][0]):
        mx = round(min(cap, v - minp, v / (1 + roi)), 1)
        if mx < BT["min_max_price_div"]:
            continue
        flag = "?" if cnt < 5 else ""
        tag = " unid" if name in unid else ""
        title = f"{name}{tag} <={mx:g}d (~{v:.0f}{flag})"
        entries.append((title, build_query(name, mx)))
        rows.append((title, mx, v, cnt))

    # drop rewards where no Valdo map without the excluded mods is listed at all (any price, any status)
    cnt_f = os.path.join(HERE, "map_counts.json")
    try:
        fresh = time.time() - os.path.getmtime(cnt_f) < 24 * 3600 and "--refresh" not in sys.argv
        counts = json.load(open(cnt_f, encoding="utf-8")) if fresh else {}
    except FileNotFoundError:
        counts = {}
    kept, kept_rows = entries[:1], []
    for (title, q), row in zip(entries[1:], rows):
        name = q["filters"]["map_filters"]["filters"]["map_completion_reward"]["option"]
        if name not in counts:
            eq = {k: v for k, v in q.items() if k != "filters"}
            eq["status"] = {"option": "any"}
            eq["filters"] = {"map_filters": q["filters"]["map_filters"]}
            counts[name] = vs.trade_search({"query": eq, "sort": {"price": "asc"}}).get("total", 0)
            json.dump(counts, open(cnt_f, "w", encoding="utf-8"), indent=1)
        if counts[name]:
            kept.append((title, q)); kept_rows.append(row + (counts[name],))
        else:
            print(f"  dropped {name}: no safe-mod Valdo map listed")
    entries, rows = kept, kept_rows

    s = bt_string(BT["folder_title"], entries)
    out = os.path.join(HERE, "better_trading_valdo.txt")
    open(out, "w", encoding="utf-8").write(s)
    with open(os.path.join(HERE, "better_trading_valdo.md"), "w", encoding="utf-8") as fh:
        fh.write(f"# Better Trading folder: {BT['folder_title']} ({CFG['league']})\n\n")
        fh.write(f"Rules: price cap {CFG.get('max_price_div') or 'none'}, ROI >= {roi*100:.0f}%, profit >= {minp} div, status {BT['status']}.\n")
        fh.write("Excluded mods: " + "; ".join(CFG["exclude_mods"].values()) + "\n\n")
        fh.write("| Bookmark | Max price | Reward value | Value listings | Safe maps listed |\n|---|---|---|---|---|\n")
        for t, mx, v, cnt, maps in rows:
            fh.write(f"| {t} | {mx:g} | {v:.1f} | {cnt} | {maps} |\n")
    print(f"{len(entries)} bookmarks -> {out}")


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    main()
