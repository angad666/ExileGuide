"""Scan the PoE1 trade site for Valdo maps whose reward unique is worth more than the map.

Rules (see config.json):
  * map price  < max_price_div
  * return     >= min_roi        (reward value / price - 1)
  * profit     >= min_profit_div (reward value - price)
  * no mod from exclude_mods; mods from risky_mods are flagged in the report

Reward value = median of the 10 cheapest uncorrupted listings of that unique on trade
(foil and non-foil are treated as the same price). poe.ninja is only used to decide which
rewards are worth searching for.

Usage:  python valdo_scan.py            (full scan, ~10-15 min because of trade rate limits)
        python valdo_scan.py --report   (rebuild report.html from the last results.json)
"""
import html, json, os, statistics, sys, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = json.load(open(os.path.join(HERE, "config.json"), encoding="utf-8"))
LEAGUE = CFG["league"]
CAP = CFG.get("max_price_div") or 1e9  # null in config = no price cap
UA = {"User-Agent": "valdo-scan/1.0", "Content-Type": "application/json"}
TRADE = "https://www.pathofexile.com/api/trade"
SITE = f"https://www.pathofexile.com/trade/search/{urllib.parse.quote(LEAGUE)}"
NINJA = "https://poe.ninja/poe1/api/economy/stash/current"
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


# ---------------------------------------------------------------- http + rate limiting
def _throttle(headers):
    """Sleep based on X-Rate-Limit-Ip / -State so we never hit a 429."""
    rules, state = headers.get("X-Rate-Limit-Ip", ""), headers.get("X-Rate-Limit-Ip-State", "")
    wait = 1.0
    for r, s in zip(rules.split(","), state.split(",")):
        try:
            mx, per, _ = map(int, r.split(":")); hits, _, _ = map(int, s.split(":"))
        except ValueError:
            continue
        if hits >= mx - 1:
            wait = max(wait, per + 1)
        elif hits >= mx * 0.7:
            wait = max(wait, per / mx * 1.5)
    time.sleep(wait)


def http(url, body=None, ua=UA):
    for attempt in range(6):
        req = urllib.request.Request(url, data=json.dumps(body).encode() if body else None, headers=ua)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.load(r)
                if "pathofexile.com" in url:
                    _throttle(r.headers)
                return data
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = int(e.headers.get("Retry-After", "60")) + 2
                print(f"  rate limited, waiting {wait}s", flush=True)
                time.sleep(wait)
                continue
            if e.code == 400:
                return {"error": json.loads(e.read() or b"{}")}
            raise
    raise RuntimeError("too many retries: " + url)


def trade_search(query):
    return http(f"{TRADE}/search/{urllib.parse.quote(LEAGUE)}", query)


def trade_fetch(ids, qid):
    out = []
    for i in range(0, len(ids), 10):
        out += http(f"{TRADE}/fetch/{','.join(ids[i:i+10])}?query={qid}")["result"]
    return out


# ---------------------------------------------------------------- prices
def ninja_values():
    ua = {"User-Agent": "Mozilla/5.0 valdo-scan/1.0"}
    cur = http(f"{NINJA}/currency/overview?league={urllib.parse.quote(LEAGUE)}&type=Currency", ua=ua)["lines"]
    div = next(c["chaosEquivalent"] for c in cur if c.get("currencyTypeName") == "Divine Orb")
    best = {}
    for t in ["UniqueWeapon", "UniqueArmour", "UniqueAccessory", "UniqueJewel", "UniqueFlask", "UniqueMap"]:
        for l in http(f"{NINJA}/item/overview?league={urllib.parse.quote(LEAGUE)}&type={t}", ua=ua)["lines"]:
            n = l["name"]
            if n.startswith("Foulborn") or l.get("links") or l.get("listingCount", 0) < 3:
                continue
            best[n] = min(best.get(n, 1e9), l["chaosValue"] / div)
    return div, best


def to_div(price, div_rate):
    if not price or price.get("amount") is None:
        return None
    c = price.get("currency")
    if c == "divine":
        return float(price["amount"])
    if c == "chaos":
        return price["amount"] / div_rate
    return None  # mirrors / exotic currency: ignore


def trade_unique_value(name, div_rate):
    """Median of the 10 cheapest uncorrupted listings (any status).
    Falls back to corrupted listings when nobody sells an uncorrupted copy
    (a Valdo reward is uncorrupted, so that is a conservative floor)."""
    for corrupted in ("false", None):
        filters = {"type_filters": {"filters": {"rarity": {"option": "unique"}}}}
        if corrupted:
            filters["misc_filters"] = {"filters": {"corrupted": {"option": corrupted}}}
        r = trade_search({"query": {"status": {"option": "any"}, "name": name, "filters": filters},
                          "sort": {"price": "asc"}})
        ids = r.get("result", [])[:10]
        if ids:
            vals = [v for v in (to_div(x["listing"].get("price"), div_rate) for x in trade_fetch(ids, r["id"])) if v]
            if vals:
                return statistics.median(vals), len(vals)
    return None, 0


# ---------------------------------------------------------------- valdo search
def valdo_query(reward, max_price):
    return {"query": {"status": {"option": CFG["listing_status"]}, "type": "Valdo Map",
                      "stats": [{"type": "not", "filters": [{"id": k[5:] if k.startswith("stat.") else k}
                                                             for k in CFG["exclude_mods"]]}],
                      "filters": {"map_filters": {"filters": {"map_completion_reward": {"option": reward}}},
                                  "trade_filters": {"filters": {"price": {"max": round(max_price, 2), "option": "divine"}}}}},
            "sort": {"price": "asc"}}


def summarise(x, reward, value, div_rate):
    it, L = x["item"], x["listing"]
    price = to_div(L.get("price"), div_rate)
    props = {p["name"]: p["values"][0][0] for p in it.get("properties", []) if p.get("values")}
    mods = [(m["description"].replace("\n", " "), m.get("hash", "")) if isinstance(m, dict) else (m, "")
            for m in it.get("explicitMods", [])]
    hashes = {h for _, h in mods}
    acct = L.get("account", {})
    if "fee" in L:
        how = "merchant"
    elif acct.get("online"):
        how = "online"
    else:
        how = "offline"
    return {
        "reward": reward, "value": value, "price": price,
        "profit": value - price, "roi": value / price - 1 if price else None,
        "map": it.get("name", ""), "area": props.get("Map Area", ""),
        "atlas": props.get("[AtlasDropScaling|Atlas Drops]", ""), "pack": props.get("Monster Pack Size", ""),
        "iir": props.get("Item Rarity", ""), "iiq": props.get("Item Quantity", ""),
        "conv": {k.replace("[Thread|Threads]", "Threads"): v for k, v in props.items()
                 if k.endswith("Map") or "Thread" in k or k == "Scarabs"},
        "mods": [{"text": t, "risky": h in CFG["risky_mods"]} for t, h in mods],
        "risky": [CFG["risky_mods"][h] for h in hashes if h in CFG["risky_mods"]],
        "how": how, "seller": acct.get("name", ""), "whisper": L.get("whisper", ""),
        "indexed": L.get("indexed", "")[:16].replace("T", " "), "price_raw": L.get("price"),
    }


def scan():
    div_rate, ninja = ninja_values()
    overrides = CFG.get("reward_value_overrides_div", {})
    for k, v in overrides.items():
        ninja[k] = v
    rewards = sorted([(v, n) for n, v in ninja.items() if v >= CFG["min_reward_value_div"]], reverse=True)
    print(f"divine = {div_rate:.1f}c, scanning {len(rewards)} rewards worth >= {CFG['min_reward_value_div']} div", flush=True)

    # one broad link: every Valdo map under the price cap without the excluded mods
    broad = valdo_query("x", CAP)
    del broad["query"]["filters"]["map_filters"]
    broad_id = trade_search(broad).get("id")

    roi = CFG["min_roi"]; minp = CFG["min_profit_div"]; cap = CAP - 0.01
    searches, maps, values = [], [], {}
    for i, (nv, name) in enumerate(rewards, 1):
        max_price = min(cap, nv - minp, nv / (1 + roi))
        if max_price <= 0:
            continue
        r = trade_search(valdo_query(name, max_price))
        if "error" in r:
            print(f"[{i}/{len(rewards)}] {name}: {r['error']}", flush=True); continue
        total = r.get("total", 0)
        rec = {"reward": name, "ninja": nv, "max_price": max_price, "total": total,
               "url": f"{SITE}/{r['id']}"}
        searches.append(rec)
        print(f"[{i}/{len(rewards)}] {name} (ninja {nv:.1f}) max {max_price:.1f} div -> {total}", flush=True)
        if not total:
            continue
        if name in overrides:
            tv, tcount = overrides[name], None
        else:
            tv, tcount = trade_unique_value(name, div_rate)
        rec["trade_value"], rec["trade_listings"] = tv, tcount
        if not tv:
            continue
        values[name] = tv
        for x in trade_fetch(r["result"][:CFG["maps_per_reward"]], r["id"]):
            m = summarise(x, name, tv, div_rate)
            m["low_confidence"] = tcount is not None and tcount < 5
            if m["price"] is None or m["price"] >= CAP:
                continue
            if m["profit"] >= minp and m["roi"] is not None and m["roi"] >= roi:
                maps.append(m)
        print(f"     trade value {tv:.1f} div -> {sum(1 for m in maps if m['reward']==name)} viable", flush=True)

    res = {"generated": datetime.now().strftime("%Y-%m-%d %H:%M"), "league": LEAGUE, "divine_chaos": div_rate,
           "config": {"max_price_div": CFG.get("max_price_div") or "none", "min_roi": CFG["min_roi"], "min_profit_div": CFG["min_profit_div"]},
           "broad_url": f"{SITE}/{broad_id}" if broad_id else None,
           "searches": searches, "maps": sorted(maps, key=lambda m: -m["profit"])}
    json.dump(res, open(os.path.join(HERE, "results.json"), "w", encoding="utf-8"), indent=1)
    return res


# ---------------------------------------------------------------- report
def report(res):
    e = html.escape
    cfg = res["config"]
    rows = []
    for idx, m in enumerate(res["maps"]):
        mods = "".join(f'<li class="{"risk" if md["risky"] else ""}">{e(md["text"])}</li>' for md in m["mods"])
        conv = ", ".join(f"{e(k)} {e(v)}" for k, v in m["conv"].items())
        juice = " · ".join(x for x in [f"Atlas {m['atlas']}" if m['atlas'] else "", f"Pack {m['pack']}" if m['pack'] else "",
                                       f"IIR {m['iir']}" if m['iir'] else "", f"IIQ {m['iiq']}" if m['iiq'] else ""] if x)
        risk = "".join(f'<span class="tag risk">{e(r)}</span>' for r in m["risky"]) or '<span class="tag ok">no flagged mods</span>'
        if m.get("low_confidence"):
            risk += '<span class="tag risk">reward price: under 5 listings, check manually</span>'
        w = e(m["whisper"]) if m["whisper"] else ""
        btn = (f'<button onclick="cp(this)" data-w="{w}">Copy whisper</button>' if w else '<span class="muted">no whisper (merchant: buy via trade site)</span>')
        rows.append(f"""
<tr class="{m['how']}" data-risky="{1 if m['risky'] else 0}" data-how="{m['how']}">
 <td><b>+{m['profit']:.1f}</b><div class="muted">{m['roi']*100:.0f}% ROI</div></td>
 <td>{m['price']:.1f}</td>
 <td><b>{e(m['reward'])}</b><div class="muted">≈ {m['value']:.1f} div</div></td>
 <td><b>{e(m['map'])}</b><div class="muted">{e(m['area'])}</div><span class="tag how-{m['how']}">{m['how']}</span></td>
 <td><div>{e(juice)}</div><div class="muted">{conv}</div>{risk}
   <details><summary>mods</summary><ul>{mods}</ul></details></td>
 <td>{btn}<div class="muted">{e(m['seller'])}<br>{e(m['indexed'])}</div></td>
</tr>""")
    srows = "".join(
        f"<tr><td><a href='{e(s['url'])}' target='_blank'>{e(s['reward'])}</a></td>"
        f"<td>{s['ninja']:.1f}</td><td>{(s.get('trade_value') or 0):.1f}</td><td>{s['max_price']:.1f}</td><td>{s['total']}</td></tr>"
        for s in sorted(res["searches"], key=lambda s: (-(s['total'] > 0), -s['ninja'])))
    page = f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Valdo Map Deals</title><style>
:root{{--bg:#fafaf7;--fg:#1d1d1b;--mut:#6b6b66;--line:#e3e2dc;--card:#fff;--ok:#2f7d4f;--risk:#b4531f;--acc:#5b4bb5}}
@media (prefers-color-scheme:dark){{:root{{--bg:#151513;--fg:#ecebe6;--mut:#9a9a93;--line:#2c2c29;--card:#1d1d1a;--ok:#6cc08d;--risk:#f0975e;--acc:#a99bff}}}}
body{{background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,Segoe UI,sans-serif;margin:0;padding:16px}}
h1{{font-size:20px;margin:0 0 4px}} a{{color:var(--acc)}} .muted{{color:var(--mut);font-size:12px}}
table{{border-collapse:collapse;width:100%;background:var(--card)}} td,th{{border-bottom:1px solid var(--line);padding:8px;vertical-align:top;text-align:left}}
th{{font-size:12px;color:var(--mut);font-weight:600}} .tag{{display:inline-block;font-size:11px;padding:1px 6px;border-radius:8px;margin:2px 4px 0 0;border:1px solid var(--line)}}
.tag.risk{{color:var(--risk);border-color:var(--risk)}} .tag.ok{{color:var(--ok);border-color:var(--ok)}}
.how-merchant{{color:var(--ok);border-color:var(--ok)}} .how-online{{color:var(--acc);border-color:var(--acc)}} .how-offline{{color:var(--mut)}}
li.risk{{color:var(--risk)}} ul{{margin:4px 0;padding-left:18px}} button{{cursor:pointer;padding:4px 8px}}
.bar{{display:flex;gap:16px;flex-wrap:wrap;margin:12px 0}} .wrap{{overflow-x:auto}}
</style></head><body>
<h1>Valdo map deals: {e(res['league'])}</h1>
<div class="muted">Generated {e(res['generated'])} · 1 div = {res['divine_chaos']:.0f}c · rules: price cap {cfg['max_price_div']},
ROI ≥ {cfg['min_roi']*100:.0f}%, profit ≥ {cfg['min_profit_div']} div, build-breaking mods excluded. Reward value = median of 10 cheapest uncorrupted listings.</div>
<div class="bar">
 <label><input type="checkbox" id="hideOff" checked> hide offline sellers</label>
 <label><input type="checkbox" id="hideRisk"> hide flagged mods</label>
 {f'<a href="{e(res["broad_url"])}" target="_blank">All Valdo maps (cap {cfg["max_price_div"]}), bad mods excluded ↗</a>' if res.get('broad_url') else ''}
</div>
<h2 style="font-size:16px">Viable maps ({len(res['maps'])})</h2>
<div class="wrap"><table id="t"><tr><th>Profit</th><th>Price (div)</th><th>Reward</th><th>Map</th><th>Juice / risk</th><th>Buy</th></tr>
{''.join(rows) or '<tr><td colspan=6>Nothing matched.</td></tr>'}</table></div>
<h2 style="font-size:16px">Saved trade searches per reward</h2>
<div class="muted">Each link already has the max price (value − {cfg['min_profit_div']} div, and value / {1+cfg['min_roi']:.2f}) and the excluded mods set.</div>
<div class="wrap"><table><tr><th>Reward (trade link)</th><th>ninja div</th><th>trade div</th><th>max price</th><th>listings</th></tr>{srows}</table></div>
<script>
function cp(b){{navigator.clipboard.writeText(b.dataset.w);b.textContent='Copied';setTimeout(()=>b.textContent='Copy whisper',1200)}}
function f(){{const o=document.getElementById('hideOff').checked,r=document.getElementById('hideRisk').checked;
document.querySelectorAll('#t tr[data-how]').forEach(tr=>{{tr.style.display=(o&&tr.dataset.how==='offline')||(r&&tr.dataset.risky==='1')?'none':''}})}}
document.getElementById('hideOff').onchange=f;document.getElementById('hideRisk').onchange=f;f();
</script></body></html>"""
    out = os.path.join(HERE, "report.html")
    open(out, "w", encoding="utf-8").write(page)
    with open(os.path.join(HERE, "trade_links.md"), "w", encoding="utf-8") as fh:
        fh.write(f"# Valdo trade links ({res['league']}, {res['generated']})\n\n")
        if res.get("broad_url"):
            fh.write(f"- All Valdo maps (cap {cfg['max_price_div']}), bad mods excluded: {res['broad_url']}\n\n")
        for s in res["searches"]:
            if s["total"]:
                fh.write(f"- {s['reward']} (≈{(s.get('trade_value') or s['ninja']):.1f} div, max {s['max_price']:.1f} div, {s['total']} listed): {s['url']}\n")
    return out


if __name__ == "__main__":
    if "--report" in sys.argv:
        res = json.load(open(os.path.join(HERE, "results.json"), encoding="utf-8"))
    else:
        res = scan()
    print("report:", report(res))
    print(f"{len(res['maps'])} viable maps")
