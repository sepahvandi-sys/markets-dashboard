"""Fetch free market data (Yahoo Finance chart API, FRED CSV) and write site/data.json.
Standard library only. If one source fails, the previous value from the live site is kept."""
import calendar, csv, io, json, os, sys, time, urllib.parse, urllib.request

UA = {"User-Agent": "markets-dashboard/1.0 (personal GitHub Pages dashboard; hourly refresh)", "Accept": "*/*"}
ASSETS = {"gold": "GC=F", "silver": "SI=F", "dxy": "DX-Y.NYB", "oil": "BZ=F", "btc": "BTC-USD",
          "eth": "ETH-USD", "spx": "^GSPC", "ndx": "^IXIC", "tnx": "^TNX"}
# public fallbacks when Yahoo refuses the runner: Stooq daily CSV, then a FRED daily series (close only)
STOOQ = {"gold": "xauusd", "silver": "xagusd", "dxy": "dx.f", "oil": "cb.f", "btc": "btcusd", "eth": "ethusd",
         "spx": "^spx", "ndx": "^ndq", "tnx": "10usy.b"}
FRED_ALT = {"dxy": "DTWEXBGS", "oil": "DCOILBRENTEU", "btc": "CBBTCUSD", "eth": "CBETHUSD", "spx": "SP500",
            "ndx": "NASDAQCOM", "tnx": "DGS10"}
# key: (series id, start date, monthly average?)
FRED = {"hpi": ("CSUSHPINSA", "2004-01-01", False), "mort": ("MORTGAGE30US", "2004-01-01", True),
        "starts": ("HOUST", "2015-01-01", False), "ff": ("DFF", "2005-01-01", True),
        "y2": ("DGS2", "2005-01-01", True), "cpi": ("CPIAUCSL", "2005-01-01", False),
        "ezcpi": ("CP0000EZ19M086NEST", "2005-01-01", False), "wcpi": ("FPCPITOTLZGWLD", "2000-01-01", False),
        "be": ("T5YIFR", "2005-01-01", True)}
START = 1162339200  # 2006-11-01


def get(url, tries=2):
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25) as r:
                return r.read().decode("utf-8")
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 + 3 * i)
    raise last


def pack(rows):
    """rows: sorted (day number, high, low, close) -> the compact shape the page reads."""
    if len(rows) < 200:
        raise ValueError("too few bars")
    r5 = lambda x: float(f"{x:.6g}")
    hist = []
    for d, _, _, c in rows:
        hist += [d, r5(c)]
    daily = [[time.strftime("%Y-%m-%d", time.gmtime(d * 86400)), r5(h), r5(l), r5(c)] for d, h, l, c in rows[-270:]]
    return {"hist": hist, "daily": daily}


def daynum(s):
    return calendar.timegm(time.strptime(s, "%Y-%m-%d")) // 86400


def yahoo(sym):
    q = urllib.parse.quote(sym)
    j = json.loads(get(f"https://query1.finance.yahoo.com/v8/finance/chart/{q}?period1={START}&period2={int(time.time())}&interval=1d", tries=1))
    res = j["chart"]["result"][0]
    off = res["meta"].get("gmtoffset", 0)
    ts, qt = res["timestamp"], res["indicators"]["quote"][0]
    rows = {}
    for t, h, l, c in zip(ts, qt["high"], qt["low"], qt["close"]):
        if c is None:
            continue
        day = (t + off) // 86400
        rows[day] = (day, h if h is not None else c, l if l is not None else c, c)
    return pack([rows[k] for k in sorted(rows)])


def stooq(sym):
    txt = get(f"https://stooq.com/q/d/l/?s={urllib.parse.quote(sym)}&d1=20061101&d2={time.strftime('%Y%m%d')}&i=d", tries=1)
    rows = []
    for r in list(csv.reader(io.StringIO(txt)))[1:]:
        try:
            rows.append((daynum(r[0]), float(r[2]), float(r[3]), float(r[4])))
        except (ValueError, IndexError):
            pass
    if not rows:
        raise ValueError("stooq: " + txt[:60].strip())
    return pack(sorted(rows))


def fred_price(sid):
    return pack([(daynum(d), v, v, v) for d, v in fred(sid, "2006-11-01", False)])


def asset(key, sym):
    errs = []
    for name, fn in (("yahoo", lambda: yahoo(sym)), ("stooq", lambda: stooq(STOOQ[key])),
                     ("fred", lambda: fred_price(FRED_ALT[key]))):
        if name in DEAD:
            continue
        try:
            out = fn()
            OK.add(name)
            print("ok", key, "via", name, flush=True)
            return out
        except KeyError:
            continue
        except Exception as e:  # noqa: BLE001
            errs.append(f"{name}: {e!r}"[:140])
            FAILS[name] = FAILS.get(name, 0) + 1
            if FAILS[name] >= 2 and name not in OK:
                DEAD.add(name)  # stop asking a source that refuses this runner
    raise RuntimeError(" | ".join(errs) or "no source")


FAILS, DEAD, OK = {}, set(), set()


def fred(sid, start, monthly):
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd={start}" + ("&fq=Monthly&fam=avg" if monthly else "")
    out = []
    if "fredgraph" in DEAD:
        raise RuntimeError("FRED skipped after repeated timeouts")
    try:
        txt = get(url, tries=1)
        OK.add("fredgraph")
    except Exception:
        FAILS["fredgraph"] = FAILS.get("fredgraph", 0) + 1
        if FAILS["fredgraph"] >= 2 and "fredgraph" not in OK:
            DEAD.add("fredgraph")
        raise
    for row in list(csv.reader(io.StringIO(txt)))[1:]:
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
            data["assets"][key] = asset(key, sym)
        except Exception as e:  # noqa: BLE001
            data["errors"].append(f"{key}: {e}")
            print("FAIL", key, repr(e), flush=True)
            if key in prev.get("assets", {}):
                data["assets"][key] = prev["assets"][key]
        time.sleep(1)
    for key, (sid, start, monthly) in FRED.items():
        try:
            data["fred"][key] = fred(sid, start, monthly)
            print("ok", key, flush=True)
        except Exception as e:  # noqa: BLE001
            data["errors"].append(f"{key}: {e}")
            print("FAIL", key, repr(e), flush=True)
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
