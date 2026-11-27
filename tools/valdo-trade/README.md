# Valdo trade

Better Trading (Chrome extension) folder of Valdo map searches, one bookmark per valuable reward.

- **Use it:** copy the whole line in `better_trading_valdo.txt`, then Better Trading > Import. Delete the old "Valdo deals" folder first.
- **Rules:** `config.json` (ROI >= 20%, profit >= 5 div, excluded map mods, league).
- **Rebuild** (calls the trade API, mind the rate limit):
  - `python unid_jewels.py` - unidentified jewel values -> `unid_values.json`
  - `python bt_export.py` - builds the folder (`--refresh` re-checks reward values older than 24h)
- `valdo_scan.py` - original scanner and `report.html`.
