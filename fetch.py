"""Fetch free market data (Yahoo Finance chart API, FRED CSV) and write site/data.json.
Standard library only. If one source fails, the previous value from the live site is kept."""
import csv, io, json, os, sys, time, urllib.parse, urllib.request

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"}
ASSETS = {"gold": "GC=F", "silver": "SI=F", "dxy": "DX-Y.NYB", "oil": "BZ=F", "btc": "BTC-USD",
          "eth": "ETH-USD", "spx": "^GSPC", "ndx": "^IXIC", "tnx": "^TNX"}
# key: (series id, start date, monthly average?)
FRED = {"hpi": ("CSUSHPINSA", "2004-01-01", False), "mort": ("MORTGAGE30US", "2004-01-01", True),
        "starts": ("HOUST", "2015-01-01", False), "ff": ("DFF", "2005-01-01", True),
        "y2": ("DGS2", "2005-01-01", True), "cpi": ("CPIAUCSL", "2005-01-01", False),
        "ezcpi": ("CP0000EZ19M086NEST", "2005-01-01", False), "wcpi": ("FPCPITOTLZGWLD", "2000-01-01", False),
        "be": ("T5YIFR", "2005-01-01", True)}
START = 1162339200  # 2006-11-01


def get(url, tries=3):
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                return r.read().decode("utf-8")
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 + 3 * i)
    raise last


def yahoo(sym):
    q = urllib.parse.quote(sym)
    err = None
    for host in ("query1", "query2"):
        try:
            j = json.loads(get(f"https://{host}.finance.yahoo.com/v8/finance/chart/{q}?period1={START}&period2={int(time.time())}&interval=1d"))
            res = j["chart"]["result"][0]
            off = res["meta"].get("gmtoffset", 0)
            ts, qt = res["timestamp"], res["indicators"]["quote"][0]
            rows = {}
            for t, h, l, c in zip(ts, qt["high"], qt["low"], qt["close"]):
                if c is None:
                    continue
                day = (t + off) // 86400
                rows[day] = (day, h if h is not None else c, l if l is not None else c, c)
            rows = [rows[k] for k in sorted(rows)]
            if len(rows) < 200:
                raise ValueError("too few bars")
            r5 = lambda x: float(f"{x:.6g}")
            hist = []
            for d, _, _, c in rows:
                hist += [d, r5(c)]
            daily = [[time.strftime("%Y-%m-%d", time.gmtime(d * 86400)), r5(h), r5(l), r5(c)] for d, h, l, c in rows[-270:]]
            return {"hist": hist, "daily": daily}
        except Exception as e:  # noqa: BLE001
            err = e
    raise err


def fred(sid, start, monthly):
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd={start}" + ("&fq=Monthly&fam=avg" if monthly else "")
    out = []
    for row in list(csv.reader(io.StringIO(get(url))))[1:]:
        try:
            out.append([row[0], float(row[1])])
        except (ValueError, IndexError):
            pass
    if not out:
        raise ValueError("empty series")
    return out


def main():
    prev = {}
    if os.environ.get("PREV_URL"):
        try:
            prev = json.loads(get(os.environ["PREV_URL"], tries=1))
        except Exception:  # noqa: BLE001
            prev = {}
    data = {"stamp": int(time.time()), "assets": {}, "fred": {}, "errors": []}
    for key, sym in ASSETS.items():
        try:
            data["assets"][key] = yahoo(sym)
        except Exception as e:  # noqa: BLE001
            data["errors"].append(f"{key}: {e}")
            if key in prev.get("assets", {}):
                data["assets"][key] = prev["assets"][key]
        time.sleep(1)
    for key, (sid, start, monthly) in FRED.items():
        try:
            data["fred"][key] = fred(sid, start, monthly)
        except Exception as e:  # noqa: BLE001
            data["errors"].append(f"{key}: {e}")
            if key in prev.get("fred", {}):
                data["fred"][key] = prev["fred"][key]
    os.makedirs("site", exist_ok=True)
    with open("site/data.json", "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print("assets:", sorted(data["assets"]), "fred:", sorted(data["fred"]), "errors:", data["errors"])
    if not data["assets"]:
        sys.exit("no market data at all")


if __name__ == "__main__":
    main()
