#!/usr/bin/env python3
"""data_bus.py — finance-skill 数据原语层（模拟 WorkBuddy neodata 数据源角色）

数据通道（按可达性实测选择）：
  · 行情/K线/指数/ETF → 腾讯公开行情接口（qt.gtimg.cn / web.ifzq.gtimg.cn），A/港/美全覆盖
  · 财务三表/财务指标 → akshare 的新浪通道
  · 资金流/新闻/板块/龙虎榜 → akshare 的东财通道（部分网络环境 push2.eastmoney.com 被重置，
    失败时按 hint 降级 web_search，不要重试超过一次）
  · call 逃生舱 → 任意 akshare 函数
  · 名称 → 代码 → 腾讯 smartbox（search），只认数据源返回的代码，不猜、不扫号段

输出紧凑 JSON：{"ok": true, "data": ..., "meta": {"source": ..., "fetched_at": ...}}
时间参数统一 YYYY-MM-DD；金额单位以来源口径为准（腾讯成交额为"万元"）。
"""

import argparse
import json
import math
import re
import ssl
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, date
from zoneinfo import ZoneInfo

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "Referer": "https://gu.qq.com/"}
CTX = ssl.create_default_context()

_ak = None


def _akshare():
    global _ak
    if _ak is None:
        try:
            import akshare
            _ak = akshare
        except ImportError:
            _ak = False
    return _ak or None


def _http(url, gbk=False, retries=2):
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            raw = urllib.request.urlopen(req, timeout=10, context=CTX).read()
            return raw.decode("gbk", "replace") if gbk else raw.decode("utf-8", "replace")
        except Exception as e:
            last = e
            if i + 1 < retries:
                time.sleep(0.6 * (i + 1))
    raise RuntimeError(f"HTTP {last}")


def _emit(ok, data=None, error=None, hint=None, source=None):
    if ok and (data is None or data == [] or isinstance(data, dict) and
               any(key in data and data[key] == [] for key in ("rows", "candles"))):
        ok, error, hint = False, "数据源返回空结果", "不要当作取数成功；核对标的和时间范围，再切换有来源的数据通道"
    payload = {"ok": ok}
    if ok:
        payload["data"] = data
    else:
        payload["error"] = error
        if hint:
            payload["hint"] = hint
    payload["meta"] = {"source": source, "fetched_at": datetime.now(ZoneInfo("Asia/Shanghai")).isoformat(timespec="seconds")}
    print(json.dumps(payload, ensure_ascii=False, default=str, allow_nan=False))
    if not ok:
        raise SystemExit(1)


def _num(v):
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return v


def _numf(v):
    """仅当可解析为 float 时返回数值，否则 None（防港美股字段偏移差异混入文本）。"""
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def normalize(code: str) -> dict:
    """Honor explicit exchanges and preserve US share classes (BRK.B)."""
    c = (code or "").strip().upper()
    explicit = None
    suffix = re.search(r"\.(SH|SS|SI|SZ|BJ|HK|US|OQ|N|O)$", c)
    if suffix:
        explicit = {"SS": "sh", "SI": "sh", "OQ": "us", "N": "us", "O": "us"}.get(suffix[1], suffix[1].lower())
        c = c[:suffix.start()]
    prefix = re.fullmatch(r"(SH|SZ|BJ)(\d{6})", c)
    if prefix:
        if explicit and explicit != prefix[1].lower():
            raise ValueError("交易所前缀和后缀冲突")
        explicit, c = prefix[1].lower(), prefix[2]
    if re.fullmatch(r"\d{6}", c) and explicit not in ("hk", "us"):
        ex = explicit or ("bj" if c.startswith("920") or c[0] in "48" else "sh" if c[0] in "569" else "sz")
        return {"market": "a", "exchange": ex, "code": c, "tx": f"{ex}{c}"}
    if re.fullmatch(r"\d{4,5}", c) and explicit in (None, "hk"):
        return {"market": "hk", "exchange": "hk", "code": c.zfill(5), "tx": f"hk{c.zfill(5)}"}
    if re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,14}", c) and explicit in (None, "us"):
        return {"market": "us", "exchange": "us", "code": c, "tx": f"us{c}"}
    raise ValueError(f"无法识别代码或交易所: {code}（A股6位 / 港股5位 / 美股ticker）")


QUOTE_FIELDS = [(1, "name"), (2, "code"), (3, "price"), (4, "prev_close"), (5, "open"),
                (6, "volume_hand"), (30, "timestamp"), (31, "change"), (32, "change_pct"),
                (33, "high"), (34, "low"), (36, "volume_hand2"), (37, "amount_wan"),
                (38, "turnover_pct"), (39, "pe_ttm"), (43, "amplitude_pct"),
                (44, "float_mktcap_yi"), (45, "mktcap_yi"), (46, "pb"), (47, "limit_up"), (48, "limit_down")]


def _tx_quote(tx_symbol):
    txt = _http(f"https://qt.gtimg.cn/q={tx_symbol}", gbk=True)
    match = re.search(r'=\s*"([^";]*)"', txt)
    if not match:
        raise ValueError(f"无行情数据: {tx_symbol}")
    return _tx_quote_from_fields(match[1].split("~"), tx_symbol)


def _tx_kline(code, period="day", start=None, end=None, adjust="qfq", count=120):
    """腾讯 fqkline。返回 (rows, qt_symbol)。rows=[date,open,close,high,low,volume,...]"""
    n = normalize(code)
    if n["market"] == "us":
        candidates = [f"us{n['code']}.OQ", f"us{n['code']}.N", f"us{n['code']}"]
    else:
        candidates = [n["tx"]]
    last_err = None
    for sym in candidates:
        url = (f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?"
               f"param={sym},{period},{start or ''},{end or ''},{min(count, 640)},{adjust or ''}")
        try:
            js = json.loads(_http(url))
            if js.get("code") != 0:
                last_err = js.get("msg")
                continue
            node = js["data"].get(sym) or {}
            key = f"{adjust}{period}" if adjust in ("qfq", "hfq") else period
            rows = node.get(key)
            if rows and isinstance(rows, list) and all(isinstance(r, list) and len(r) >= 6 for r in rows):
                return {"symbol": sym, "rows": rows, "qt": node.get("qt", {}).get(sym)}
            last_err = f"{sym} 无K线数据"
        except Exception as e:
            last_err = e
    raise RuntimeError(f"K线获取失败: {last_err}")


def _clean_rows(rows, limit):
    out = []
    for r in rows[-limit:]:
        row = {"date": r[0], "open": _num(r[1]), "close": _num(r[2]), "high": _num(r[3]),
               "low": _num(r[4]), "volume": _num(r[5])}
        if len(r) > 6 and isinstance(r[6], dict):
            row["corp_action"] = (r[6].get("FHcontent") or r[6].get("HGcontent") or "")[:60] or None
        out.append(row)
    return out


def cmd_normalize(code):
    _emit(True, normalize(code), source="builtin")


def cmd_quote(code):
    n = normalize(code)
    if n["market"] == "us":
        k = _tx_kline(code, adjust="", count=1)
        f = k.get("qt") if isinstance(k.get("qt"), list) else None
        if not f or len(f) < 40:
            return _emit(False, error="美股实时报价不可用", hint="用 kline --limit 5 的最近收盘价并标注非实时")
        q, _raw = _tx_quote_from_fields(f, k["symbol"])
        return _emit(True, q, source="tencent:fqkline.qt")
    try:
        q, _raw = _tx_quote(n["tx"])
    except ValueError as e:
        return _emit(False, error=str(e), source="tencent:qt.gtimg.cn",
                     hint="代码不确定时先 search --name <公司名> 取得数据源给出的代码；某个代码无行情≠公司未上市，不要扫号段猜代码")
    return _emit(True, q, source="tencent:qt.gtimg.cn")


def _tx_quote_from_fields(f, sym):
    if not f or len(f) < 40 or not f[1] or _numf(f[3]) is None:
        raise ValueError(f"报价字段异常或无数据: {sym}")
    market = "hk" if sym.startswith("hk") else "us" if sym.startswith("us") else "a"
    currency = {"a": "CNY", "hk": "HKD", "us": "USD"}[market]
    q = {"name": f[1], "code": f[2], "timestamp": f[30], "symbol": sym, "market": market, "currency": currency}
    for i, key in [(3, "price"), (4, "prev_close"), (5, "open"), (31, "change"), (32, "change_pct"),
                   (33, "high"), (34, "low"), (39, "pe_ttm")]:
        q[key] = _numf(f[i]) if i < len(f) else None
    q["volume"] = _numf(f[6])
    q["volume_unit"] = "hands" if market == "a" else "shares"
    q["quote_type"] = "delayed" if market in ("hk", "us") else "provider_quote"
    if market == "a":
        for i, key in QUOTE_FIELDS:
            if key not in ("name", "code", "timestamp") and i < len(f):
                q[key] = _numf(f[i])
        q["amount"] = q.get("amount_wan") * 10000 if q.get("amount_wan") is not None else None
        q["amount_unit"] = "CNY"
    elif market == "hk":
        # HK field 37 is the full HKD turnover, field 46 is an English name,
        # 47/48 are not daily price limits. Do not expose A-share aliases.
        q["amount"] = _numf(f[37])
        q["amount_unit"] = "HKD"
    else:
        # Unverified US extended fields are deliberately absent.
        q["amount"] = None
        q["amount_unit"] = "USD"
    _attach_market_cap(q, f, market)
    return q, f


# Total shares / total market cap (亿) field pairs, by market. HK: 69 total
# shares, 45 total cap; 70 / 44 the HK-listed (H) share class. A: 73 total
# shares, 45 total cap. Verified against live quotes (2026-10-10):
# 00700 424.8 × 9,092,605,595 = 38,625 亿; 02513 641.5 × 487,588,090 = 3,128 亿.
MKTCAP_FIELDS = {"hk": {"total": (69, 45), "h": (70, 44)}, "a": {"total": (73, 45)}}


def _verified_market_cap(price, shares, cap_yi, tolerance=0.01):
    """Market cap in currency units — only when price × shares agrees with the
    provider's own 亿-unit figure; a number that can't be cross-checked is
    not reported (None), never estimated from another field."""
    if price is None or shares is None or cap_yi is None or shares <= 0 or cap_yi <= 0:
        return None
    computed = price * shares
    provided = cap_yi * 1e8
    if abs(computed - provided) > tolerance * provided:
        return None
    return round(computed, 2)


def _attach_market_cap(q, f, market):
    pairs = MKTCAP_FIELDS.get(market)
    notes = []
    if market in ("a", "hk"):
        notes.append("amount 是当日成交额（turnover），不是市值")
    if pairs is None:
        q["market_cap"] = None
        notes.append("数据源未提供可校验的总市值：不得用成交额或其他字段推算市值")
        q["notes"] = notes
        return
    price = q.get("price")
    def field(i):
        return _numf(f[i]) if i < len(f) else None
    shares_i, cap_i = pairs["total"]
    q["total_shares"] = field(shares_i)
    q["market_cap"] = _verified_market_cap(price, q["total_shares"], field(cap_i))
    q["market_cap_unit"] = q["currency"]
    if "h" in pairs:
        h_shares_i, h_cap_i = pairs["h"]
        q["h_shares"] = field(h_shares_i)
        q["h_share_market_cap"] = _verified_market_cap(price, q["h_shares"], field(h_cap_i))
    notes.append("market_cap = 现价 × 总股本，已与数据源总市值交叉校验" if q["market_cap"] is not None
                 else "总市值无法与股本交叉校验，不予报告：不得用成交额或其他字段推算市值")
    q["notes"] = notes


SEARCH_TYPES = {"GP": "股票", "GP-A": "A股", "GP-B": "B股", "ZS": "指数", "QZ": "权证/牛熊证",
                "ETF": "ETF", "LOF": "LOF", "JJ": "基金", "ZQ": "债券"}
SEARCH_DERIVATIVES = {"QZ"}
SEARCH_EXCHANGE_SUFFIX = {"sh": "SH", "sz": "SZ", "bj": "BJ", "hk": "HK"}


def _search_quote_code(market, code):
    if market in SEARCH_EXCHANGE_SUFFIX:
        return f"{code.upper()}.{SEARCH_EXCHANGE_SUFFIX[market]}"
    if market == "us":
        return code.split(".")[0].upper()
    return code


def _parse_smartbox(raw):
    """smartbox v_hint: entries joined by "^", fields by "~":
    market~code~name~pinyin~type, names as literal backslash-u escapes."""
    raw = re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m[1], 16)), raw or "")
    out = []
    for item in raw.split("^"):
        parts = item.split("~")
        if len(parts) < 5 or not parts[0] or not parts[1]:
            continue
        market, code, name, _pinyin, kind = parts[:5]
        out.append({"market": market, "code": code, "name": name, "type": kind,
                    "type_label": SEARCH_TYPES.get(kind, kind), "quote_code": _search_quote_code(market, code)})
    return out


def cmd_search(query, market=None, limit=10, include_derivatives=False):
    """Name / English name / ticker / pinyin → codes, straight from the data
    source. Nothing found is reported as "not found" — never as "not listed"."""
    q = (query or "").strip()
    if not q:
        return _emit(False, error="search 需要 --name", hint="传公司中文名、英文名、简称、拼音或代码")
    txt = _http(f"https://smartbox.gtimg.cn/s3/?v=2&q={urllib.parse.quote(q)}&t=all&c=1")
    hit = re.search(r'v_hint="([^"]*)"', txt)
    matches = _parse_smartbox(hit[1] if hit else "")
    if market:
        want = {"a": ("sh", "sz", "bj")}.get(market, (market,))
        matches = [m for m in matches if m["market"] in want]
    derivatives = [m for m in matches if m["type"] in SEARCH_DERIVATIVES]
    if not include_derivatives:
        matches = [m for m in matches if m["type"] not in SEARCH_DERIVATIVES]
    if not matches:
        return _emit(False, error=f"数据源未找到与“{q}”匹配的证券" + (f"（另有 {len(derivatives)} 条权证/牛熊证，加 --all 查看）" if derivatives and not include_derivatives else ""),
                     hint="查不到≠不存在/未上市：换中文全称、英文名、简称或拼音再搜一次；仍无结果就如实报告“未查到（已尝试：…）”，"
                          "不得据此断言“未上市/概念阶段”，也不要扫号段猜代码", source="tencent:smartbox")
    return _emit(True, {"query": q, "matches": matches[:limit],
                        "derivatives_hidden": len(derivatives) if not include_derivatives else 0},
                 source="tencent:smartbox")


def cmd_kline(code, period="day", start=None, end=None, adjust="qfq", limit=30):
    k = _tx_kline(code, period, start, end, adjust, limit)
    out = {"symbol": k["symbol"], "adjust": adjust or "none", "period": period,
           "count": min(len(k["rows"]), limit), "candles": _clean_rows(k["rows"], limit)}
    if k.get("qt") and isinstance(k["qt"], list):
        try:
            quote, _ = _tx_quote_from_fields(k["qt"], k["symbol"])
            out["latest_quote"] = quote
        except ValueError:
            pass
    _emit(True, out, source="tencent:web.ifzq.gtimg.cn")


def _sorted_tail(df, limit, date_cols=("报告日", "日期")):
    """新浪报表行序新→旧，统一按日期列升序排后取尾部 limit 行。"""
    if df is None or df.empty:
        raise ValueError("数据源返回空表，不能标记取数成功")
    for col in date_cols:
        if col in df.columns:
            df = df.sort_values(col)
            break
    return df.tail(limit)


def cmd_financial(code, statement="indicator", limit=8):
    n = normalize(code)
    if n["market"] != "a":
        return _emit(False, error="财务接口暂仅支持 A 股", hint="港美股财务用 call 或检索交易所/公司年报")
    ak = _akshare()
    if not ak:
        return _emit(False, error="akshare 未安装（财务通道依赖其新浪接口）", hint="python3 -m pip install -r <skill目录>/requirements.txt")
    try:
        if statement == "indicator":
            year = datetime.now().year - 1
            df = _sorted_tail(ak.stock_financial_analysis_indicator(symbol=n["code"], start_year=str(year - 2)), limit, date_cols=("日期",))
            return _emit(True, {"code": n["code"], "rows": json.loads(
                df.to_json(orient="records", force_ascii=False, date_format="iso"))},
                source="akshare:stock_financial_analysis_indicator(sina)")
        smap = {"income": "利润表", "balance": "资产负债表", "cashflow": "现金流量表"}
        if statement not in smap:
            return _emit(False, error=f"未知 statement: {statement}", hint="income|balance|cashflow|indicator")
        if n["exchange"] == "bj":
            return _emit(False, error="新浪三表接口不支持北交所", hint="用 call 逃生舱或 web_search")
        df = _sorted_tail(ak.stock_financial_report_sina(stock=n["tx"], symbol=smap[statement]), limit)
        return _emit(True, {"code": n["code"], "statement": smap[statement],
                            "rows": json.loads(df.to_json(orient="records", force_ascii=False, date_format="iso"))},
                     source="akshare:stock_financial_report_sina")
    except Exception as e:
        return _emit(False, error=f"{type(e).__name__}: {e}", hint="新浪通道偶发限流，稍候重试一次；或 web_search")


def _em_with_fallback(label, fn, fallback_hint):
    """东财通道：部分网络环境 push2.eastmoney.com 被重置。失败一次即给降级提示。"""
    ak = _akshare()
    if not ak:
        return _emit(False, error=f"{label} 需要 akshare（东财通道）", hint=fallback_hint)
    try:
        return fn(ak)
    except Exception as e:
        return _emit(False, error=f"{label} 失败（东财通道，本机网络对 push2.eastmoney.com 可能受限）: {e}",
                     hint=fallback_hint)


def cmd_fundflow(code, limit=10):
    n = normalize(code)
    if n["market"] != "a":
        return _emit(False, error="个股资金流仅 A 股；北向个股级数据 2024-08 起停止披露")
    _em_with_fallback(
        "个股资金流",
        lambda ak: _emit(True, {"code": n["code"], "rows": json.loads(
            ak.stock_individual_fund_flow(stock=n["code"], market=n["exchange"]).tail(limit).to_json(
                orient="records", force_ascii=False))}, source="akshare:stock_individual_fund_flow"),
        "web_search '600519 主力资金流向' 兜底；或稍后网络恢复重试一次")


def cmd_news(code, limit=10):
    n = normalize(code)
    if n["market"] != "a":
        return _emit(False, error="个股新闻接口仅 A 股", hint="港美股直接 web_search")
    _em_with_fallback(
        "个股新闻",
        lambda ak: _emit(True, {"code": n["code"], "rows": json.loads(
            ak.stock_news_em(symbol=n["code"]).head(limit).to_json(orient="records", force_ascii=False))},
            source="akshare:stock_news_em"),
        "web_search '<公司名> 最新公告 新闻' 兜底并标注媒体名+日期")


def cmd_etf(code=None, limit=20):
    if code:
        n = normalize(code)
        q, _raw = _tx_quote(n["tx"])
        return _emit(True, q, source="tencent:qt.gtimg.cn")
    _em_with_fallback(
        "ETF 快照",
        lambda ak: _emit(True, {"rows": json.loads(ak.fund_etf_spot_em().head(limit).to_json(
            orient="records", force_ascii=False))}, source="akshare:fund_etf_spot_em"),
        "改用 quote --code <ETF代码> 单查；或 web_search")


def cmd_index(code="000001", period="day", limit=10):
    ex = "sh" if code.startswith(("0", "5")) else "sz"
    sym = f"{ex}{code}"
    url = (f"https://web.ifzq.gtimg.cn/appstock/app/kline/kline?"
           f"param={sym},{period},,,{min(limit, 640)},")
    js = json.loads(_http(url))
    node = (js.get("data") or {}).get(sym) or {}
    rows = node.get("day")
    if not rows:
        return _emit(False, error=f"指数 {sym} K线为空", hint="核对指数代码（000001 上证/399001 深成/399006 创业板/000300 沪深300）")
    _emit(True, {"symbol": sym, "candles": _clean_rows(rows, limit)}, source="tencent:app/kline")


def cmd_board(limit=20):
    _em_with_fallback(
        "行业板块行情",
        lambda ak: _emit(True, {"rows": json.loads(ak.stock_board_industry_name_em().head(limit).to_json(
            orient="records", force_ascii=False))}, source="akshare:stock_board_industry_name_em"),
        "web_search '今日 A 股行业板块涨跌幅' 兜底并标注来源+日期")


def cmd_lhb(start=None, end=None, limit=20):
    d = lambda s: s.replace("-", "") if s else datetime.now().strftime("%Y%m%d")
    _em_with_fallback(
        "龙虎榜",
        lambda ak: _emit(True, {"rows": json.loads(ak.stock_lhb_detail_em(
            start_date=d(start), end_date=d(end)).head(limit).to_json(orient="records", force_ascii=False))},
            source="akshare:stock_lhb_detail_em"),
        "web_search '龙虎榜 <日期>' 兜底并标注来源+日期")


def cmd_call(func, kwargs):
    ak = _akshare()
    if not ak:
        return _emit(False, error="akshare 未安装", hint="pip3 install akshare")
    if not hasattr(ak, func):
        return _emit(False, error=f"akshare 无函数 {func}",
                     hint="python3 -c \"import akshare as ak; print([f for f in dir(ak) if 'kw' in f])\" 检索函数名")
    try:
        df = getattr(ak, func)(**(kwargs or {}))
    except Exception as e:
        return _emit(False, error=f"{func} 调用失败: {e}", hint="参数名以 akshare 文档为准；东财类接口在本机可能被网络重置")
    if hasattr(df, "to_json"):
        return _emit(True, json.loads(df.head(50).to_json(orient="records", force_ascii=False)), source=f"akshare:{func}")
    return _emit(True, df, source=f"akshare:{func}")


def main():
    p = argparse.ArgumentParser(description="finance-skill 数据原语层")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("normalize"); s.add_argument("--code", required=True)
    s = sub.add_parser("quote"); s.add_argument("--code", required=True)
    s = sub.add_parser("search"); s.add_argument("--name", required=True)
    s.add_argument("--market", choices=["a", "hk", "us", "sh", "sz", "bj"]); s.add_argument("--limit", type=int, default=10)
    s.add_argument("--all", action="store_true", help="包含权证/牛熊证")
    s = sub.add_parser("kline")
    s.add_argument("--code", required=True); s.add_argument("--period", default="day", choices=["day", "week", "month", "daily", "weekly", "monthly"])
    s.add_argument("--start"); s.add_argument("--end"); s.add_argument("--adjust", default="qfq", choices=["qfq", "hfq", "none"])
    s.add_argument("--limit", type=int, default=30)
    s = sub.add_parser("financial")
    s.add_argument("--code", required=True); s.add_argument("--statement", default="indicator")
    s.add_argument("--limit", type=int, default=8)
    s = sub.add_parser("fundflow"); s.add_argument("--code", required=True); s.add_argument("--limit", type=int, default=10)
    s = sub.add_parser("news"); s.add_argument("--code", required=True); s.add_argument("--limit", type=int, default=10)
    s = sub.add_parser("etf"); s.add_argument("--code"); s.add_argument("--limit", type=int, default=20)
    s = sub.add_parser("index"); s.add_argument("--code", default="000001"); s.add_argument("--limit", type=int, default=10)
    s = sub.add_parser("board"); s.add_argument("--limit", type=int, default=20)
    s = sub.add_parser("lhb"); s.add_argument("--start"); s.add_argument("--end"); s.add_argument("--limit", type=int, default=20)
    s = sub.add_parser("call"); s.add_argument("func"); s.add_argument("--kwargs", default="{}")
    a = p.parse_args()
    try:
        if hasattr(a, "limit") and not 1 <= a.limit <= 640:
            raise ValueError("limit 必须在 1–640 之间")
        if hasattr(a, "start"):
            for value in (a.start, a.end):
                if value:
                    datetime.strptime(value, "%Y-%m-%d")
            if a.start and a.end and a.start > a.end:
                raise ValueError("start 不可晚于 end")
        if a.cmd == "normalize":
            cmd_normalize(a.code)
        elif a.cmd == "quote":
            cmd_quote(a.code)
        elif a.cmd == "search":
            cmd_search(a.name, a.market, a.limit, a.all)
        elif a.cmd == "kline":
            cmd_kline(a.code, {"daily": "day", "weekly": "week", "monthly": "month"}.get(a.period, a.period), a.start, a.end, "" if a.adjust == "none" else a.adjust, a.limit)
        elif a.cmd == "financial":
            cmd_financial(a.code, a.statement, a.limit)
        elif a.cmd == "fundflow":
            cmd_fundflow(a.code, a.limit)
        elif a.cmd == "news":
            cmd_news(a.code, a.limit)
        elif a.cmd == "etf":
            cmd_etf(a.code, a.limit)
        elif a.cmd == "index":
            cmd_index(a.code, "day", a.limit)
        elif a.cmd == "board":
            cmd_board(a.limit)
        elif a.cmd == "lhb":
            cmd_lhb(a.start, a.end, a.limit)
        elif a.cmd == "call":
            cmd_call(a.func, json.loads(a.kwargs))
    except Exception as e:
        _emit(False, error=f"{type(e).__name__}: {e}", hint="检查代码/参数；失败勿重试超过一次，降级 web_search")
        sys.exit(1)


if __name__ == "__main__":
    main()
