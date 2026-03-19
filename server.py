"""
vLLM-HUST 工作站后端
- 读取 config.ini 配置
- 代理到 vllm-hust-gateway (OpenAI 兼容接口)
- 提供流式对话 / 模型列表 / 实时指标接口
- 启动后自动打开浏览器
"""

from __future__ import annotations

import asyncio
import configparser
import json
import os
import random
import re
import socket
import subprocess
import sys
import threading
import time
import webbrowser
import html as html_mod
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus

import httpx
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse

# ── 读取配置 ─────────────────────────────────────────────────────────────────

BASE_DIR = Path(__file__).parent
config = configparser.ConfigParser()
config_path = BASE_DIR / "config.ini"
if config_path.exists():
    config.read(config_path, encoding="utf-8")

def cfg(section: str, key: str, fallback: str = "") -> str:
    # Prefer new vllm_hust section while keeping sagellm backward compatibility.
    aliases = [section]
    if section == "vllm_hust":
        aliases.append("sagellm")
    elif section == "sagellm":
        aliases.insert(0, "vllm_hust")

    for current in aliases:
        if config.has_option(current, key):
            return config.get(current, key, fallback=fallback).strip()
    return fallback.strip()

PORT         = int(cfg("server", "port", "3000"))
BASE_URL     = cfg("vllm_hust", "base_url", "http://localhost:8080").rstrip("/")
API_KEY      = cfg("vllm_hust", "api_key", "not-required")
DEFAULT_MODEL = cfg("vllm_hust", "default_model", "default")
BACKEND_TYPE = cfg("vllm_hust", "backend_type", "Ascend NPU")
BRAND_NAME   = cfg("brand", "name", "vLLM-HUST 私有工作站")
ACCENT_COLOR = cfg("brand", "accent_color", "#6366f1")
LOGO_PATH    = cfg("brand", "logo", "")
MODELS_DIR   = cfg("hub", "models_dir", "~/Downloads/vllm-hust-models")
HF_ENDPOINT  = cfg("hub", "hf_endpoint", "https://hf-mirror.com")

# ── Web search config ────────────────────────────────────────────────────────
SEARCH_ENABLED  = cfg("search", "enabled",  "true").lower() in ("true", "1", "yes")
SEARCH_ENGINE   = cfg("search", "engine",   "duckduckgo")   # duckduckgo | bing
SEARCH_MAX      = int(cfg("search", "max_results", "5"))
SEARCH_TIMEOUT  = float(cfg("search", "timeout_sec", "5"))
SEARCH_REGION   = cfg("search", "region",   "cn-zh")        # e.g. us-en, cn-zh

COMMON_HEADERS = {"Authorization": f"Bearer {API_KEY}"}

# ── FastAPI app ───────────────────────────────────────────────────────────────

app = FastAPI(title="vLLM-HUST Workstation", docs_url=None, redoc_url=None)


@app.get("/")
async def index():
    return FileResponse(BASE_DIR / "index.html", media_type="text/html")


@app.get("/logo")
async def logo():
    if LOGO_PATH and Path(LOGO_PATH).is_file():
        return FileResponse(LOGO_PATH)
    return JSONResponse({"error": "no logo"}, status_code=404)


@app.get("/config.json")
async def app_config():
    """Front-end runtime config (no secrets)."""
    return {
        "brandName":   BRAND_NAME,
        "accentColor": ACCENT_COLOR,
        "hasLogo":     bool(LOGO_PATH and Path(LOGO_PATH).is_file()),
        "defaultModel": DEFAULT_MODEL,
        "backendType": BACKEND_TYPE,
        "modelsDir": MODELS_DIR,
        "hfEndpoint": HF_ENDPOINT,
    }


# ── Web search ───────────────────────────────────────────────────────────────
# Persistent search client — reuses cookies so Bing doesn't flag each request
# as a fresh bot visit.  Initialised in _init_search_client() at startup.
_SEARCH_CLIENT: httpx.AsyncClient | None = None


async def _get_search_client() -> httpx.AsyncClient:
    """Return (and lazily warm-up) the shared search session."""
    global _SEARCH_CLIENT
    if _SEARCH_CLIENT is None or _SEARCH_CLIENT.is_closed:
        _SEARCH_CLIENT = httpx.AsyncClient(
            timeout=SEARCH_TIMEOUT,
            follow_redirects=True,
            headers={
                # Will be overridden per-request; kept here as fallback
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Encoding": "gzip, deflate, br",
                "DNT": "1",
            },
        )
        # Warm-up: visit homepage once to receive session cookies
        try:
            await _SEARCH_CLIENT.get(
                "https://cn.bing.com/",
                headers={"User-Agent": random.choice(_BING_UA_POOL)},
                timeout=3.0,
            )
        except Exception:
            pass
    return _SEARCH_CLIENT


_TAG_RE   = re.compile(r"<[^>]+>")
_MULTI_SP = re.compile(r"\s{2,}")
# Strip leading "2024年1月1日 · " style date preambles from Zhihu/Baidu snippets
_DATE_PRE = re.compile(r"^\d{4}年\d{1,2}月\d{1,2}日\s*[··\-–—]\s*")
# Detect weather / current-conditions queries so we route to a dedicated data source
_WEATHER_RE = re.compile(r'天气|气温|温度|下雨|下雪|晴|阴天|forecast|weather', re.I)
# Simple tokeniser to pull the city name out of a weather query
_CITY_FROM_WEATHER = re.compile(r'^([\u4e00-\u9fa5]{2,4}?)(?=今天|明天|后天|最近|实时|当前|天气|[？ 的]|$)')

def _strip_tags(s: str) -> str:
    """Remove HTML tags and decode entities."""
    return _MULTI_SP.sub(" ", _TAG_RE.sub(" ", html_mod.unescape(s))).strip()


# Mapping of common Chinese city names to weather.com.cn city codes (also used by sojson)
_CITY_CODES: dict[str, str] = {
    "北京": "101010100", "上海": "101020100", "天津": "101030100", "重庆": "101040100",
    "哈尔滨": "101050101", "长春": "101060101", "沈阳": "101070101", "大连": "101070201",
    "呼和浩特": "101080101", "石家庄": "101090101", "太原": "101100101", "西安": "101110101",
    "济南": "101120101", "青岛": "101120201", "郑州": "101180101", "合肥": "101220101",
    "武汉": "101200101", "南京": "101190101", "苏州": "101190401", "杭州": "101210101",
    "宁波": "101210401", "南昌": "101240101", "长沙": "101250101", "成都": "101270101",
    "贵阳": "101260101", "昆明": "101290101", "广州": "101280101", "深圳": "101280601",
    "珠海": "101280701", "南宁": "101300101", "海口": "101310101", "福州": "101230101",
    "厦门": "101230201", "兰州": "101160101", "西宁": "101150101", "银川": "101170101",
    "乌鲁木齐": "101130101",
}


async def _fetch_weather_sojson(city: str, timeout: float = 8.0) -> dict | None:
    """Fetch weather from sojson free API using weather.com.cn city codes."""
    import datetime
    code = _CITY_CODES.get(city)
    if not code:
        return None
    url = f"http://t.weather.sojson.com/api/weather/city/{code}"
    try:
        async with httpx.AsyncClient(timeout=timeout) as cli:
            resp = await cli.get(url)
        d = resp.json()
        if d.get("status") != 200:
            return None
        forecast = d.get("data", {}).get("forecast", [])
        if not forecast:
            return None
        # The API sometimes lags by a day — find today's entry by date
        today_str = datetime.date.today().strftime("%Y-%m-%d")
        start_idx = 0
        for i, day in enumerate(forecast):
            if day.get("ymd") == today_str:
                start_idx = i
                break
        forecast = forecast[start_idx:]  # align to today

        def _fmt_day(day: dict) -> tuple[str, str, str, str]:
            """Return (ymd, type, high, low) with units stripped."""
            high = day.get("high", "").replace("高温", "").replace("℃", "").strip()
            low  = day.get("low",  "").replace("低温", "").replace("℃", "").strip()
            return day.get("ymd", ""), day.get("type", ""), high, low

        today = forecast[0]
        _, wtype, high, low = _fmt_day(today)
        notice = today.get("notice", "")
        wind   = f"{today.get('fx', '')} {today.get('fl', '')}".strip()
        aqi    = today.get("aqi", "")

        parts = [f"{city}天气（来源：中国天气网）"]
        if wtype:
            parts.append(f"今天：{wtype}")
        if high and low:
            parts.append(f"最高{high}℃ / 最低{low}℃")
        if wind:
            parts.append(f"风力：{wind}")
        if aqi:
            parts.append(f"AQI：{aqi}")
        if notice:
            parts.append(f"温馨提示：{notice}")

        # Include next 2 days for context
        day_labels = ["明天", "后天"]
        for j, label in enumerate(day_labels):
            if j + 1 >= len(forecast):
                break
            _, t2, h2, l2 = _fmt_day(forecast[j + 1])
            day_parts = [f"{label}：{t2}"]
            if h2 and l2:
                day_parts.append(f"{h2}℃/{l2}℃")
            wind2 = f"{forecast[j+1].get('fx','')} {forecast[j+1].get('fl','')}".strip()
            if wind2:
                day_parts.append(wind2)
            parts.append("  ".join(day_parts))

        return {
            "title": f"{city}天气预报 - {today_str}",
            "url": f"https://www.weather.com.cn/weather/{code}.shtml",
            "snippet": "  ".join(parts),
        }
    except Exception:
        return None


async def _enrich_weather_cn(url: str, city: str, timeout: float = 8.0) -> dict | None:
    """Fetch and parse weather.com.cn to get actual temperature & forecast data."""
    if "weather.com.cn" not in url:
        return None
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 "
            "Chrome/120 Mobile Safari/537.36"
        ),
        "Accept-Language": "zh-CN,zh;q=0.9",
    }
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as cli:
            resp = await cli.get(url, headers=headers)
        html = resp.text
        # Each day is a <li class="sky ..."> block
        li_blocks = re.findall(r'<li[^>]*class="sky[^"]*"[^>]*>(.*?)</li>', html, re.S)
        if not li_blocks:
            return None

        def _parse_day(li_html: str) -> dict:
            day_m = re.search(r'<h1>(.*?)</h1>', li_html)
            day   = _strip_tags(day_m.group(1)).strip() if day_m else ""
            wea_m = re.search(r'<p[^>]*class="wea"[^>]*>(.*?)</p>', li_html)
            wea   = _strip_tags(wea_m.group(1)).strip() if wea_m else ""
            # <span>HIGH</span>/<i>LOW℃</i>  OR  just <i>TEMP℃</i>
            span_m = re.search(r'<span[^>]*>(-?\d+)℃?</span>', li_html)
            itag_m = re.search(r'<i>(-?\d+)℃?</i>', li_html)
            high = span_m.group(1) if span_m else ""
            low  = itag_m.group(1) if itag_m else ""
            return {"day": day, "wea": wea, "high": high, "low": low}

        today    = _parse_day(li_blocks[0])
        tomorrow = _parse_day(li_blocks[1]) if len(li_blocks) > 1 else {}

        parts: list[str] = []
        # Today line
        if today["wea"]:
            parts.append(f"今天{today['day']}：{today['wea']}")
        if today["high"] and today["low"]:
            parts.append(f"最高{today['high']}℃ / 最低{today['low']}℃")
        elif today["low"]:
            parts.append(f"夜间低温{today['low']}℃")
        elif today["high"]:
            parts.append(f"气温{today['high']}℃")
        # Tomorrow brief
        if tomorrow.get("wea") or tomorrow.get("high"):
            t = tomorrow
            t_str = f"明天{t.get('day', '')}：{t.get('wea', '')}"
            if t.get("high") and t.get("low"):
                t_str += f" {t['high']}℃/{t['low']}℃"
            parts.append(t_str)

        if not parts:
            return None
        snippet = "  ".join(parts)
        return {"title": f"{city}天气预报（中国天气网）", "url": url, "snippet": snippet}
    except Exception:
        return None


# Rotating User-Agent pool to avoid Bing bot-detection after repeated requests
_BING_UA_POOL = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
]


async def _search_bing(query: str, max_results: int, timeout: float) -> list[dict]:
    """Scrape Bing search results using a persistent session.

    Tries cn.bing.com first; if it returns a bot-check page, retries with
    www.bing.com (different rate-limit bucket) before giving up.
    """
    encoded = quote_plus(query)
    ua = random.choice(_BING_UA_POOL)
    # Small jitter so rapid successive requests do not look robotic
    await asyncio.sleep(random.uniform(0.1, 0.5))

    for i_host, host in enumerate(("cn.bing.com", "www.bing.com")):
        client = await _get_search_client()          # re-fetch each iteration (may be reset)
        url = f"https://{host}/search?q={encoded}&setlang=zh-CN&cc=CN"
        try:
            resp = await client.get(
                url,
                headers={
                    "User-Agent": ua,
                    "Referer": f"https://{host}/",
                    "sec-fetch-dest": "document",
                    "sec-fetch-mode": "navigate",
                    "sec-fetch-site": "same-origin",
                },
            )
        except Exception:
            continue  # network error → try next host

        if resp.status_code != 200:
            continue  # non-200 → try next host

        text = resp.text
        # Detect bot-check / CAPTCHA page
        if 'class="b_algo"' not in text and '<h2>' not in text:
            # Reset session so the next search gets a fresh warm-up
            global _SEARCH_CLIENT
            try:
                await _SEARCH_CLIENT.aclose()
            except Exception:
                pass
            _SEARCH_CLIENT = None
            continue  # try the other host

        # Parse results
        title_matches = re.findall(
            r'<h2[^>]*><a[^>]+href="([^"]+)"[^>]*>(.*?)</a></h2>', text
        )
        snippet_matches = re.findall(
            r'class="b_caption"[^>]*>.*?<p[^>]*>(.*?)</p>', text, re.S
        )
        results: list[dict] = []
        for j, (url_r, title_r) in enumerate(title_matches):
            if url_r.startswith("http") and len(results) < max_results:
                snippet = _strip_tags(snippet_matches[j]) if j < len(snippet_matches) else ""
                results.append({
                    "title":   _strip_tags(title_r),
                    "url":     url_r,
                    "snippet": snippet[:300],
                })
        if results:
            return results  # success — don't try the second host

    raise RuntimeError("All Bing endpoints returned bot-check pages")


async def _search_baidu(query: str, max_results: int, timeout: float) -> list[dict]:
    """Scrape www.baidu.com as fallback."""
    url = f"https://www.baidu.com/s?wd={quote_plus(query)}&rn={max_results}"
    ua = random.choice(_BING_UA_POOL)
    headers = {
        "User-Agent": ua,
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Referer": "https://www.baidu.com/",
    }
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        resp = await client.get(url, headers=headers)
    if resp.status_code != 200:
        raise RuntimeError(f"Baidu returned HTTP {resp.status_code}")
    text = resp.text
    # Baidu bot-check pages are very short; real SERPs are >20KB
    if len(text) < 5000:
        raise RuntimeError("Baidu returned a bot-check / consent page")
    # Baidu: <h3 class="t"><a href="...">TITLE</a></h3>
    #        <span class="content-right_8Zs40">SNIPPET</span>  (or various snippet classes)
    title_matches = re.findall(
        r'<h3[^>]*class="[^"]*\bt\b[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>',
        text, re.S
    )
    snippet_matches = re.findall(
        r'class="[^"]*c-abstract[^"]*"[^>]*>(.*?)</(?:span|div)>', text, re.S
    )
    results: list[dict] = []
    for i, (url_r, title_r) in enumerate(title_matches):
        if url_r.startswith("http") and len(results) < max_results:
            snippet = _strip_tags(snippet_matches[i]) if i < len(snippet_matches) else ""
            results.append({
                "title":   _strip_tags(title_r),
                "url":     url_r,
                "snippet": snippet[:300],
            })
    return results


async def _search_sogou(query: str, max_results: int, timeout: float) -> list[dict]:
    """Scrape www.sogou.com as tertiary fallback when Bing and Baidu are rate-limited."""
    url = f"https://www.sogou.com/web?query={quote_plus(query)}&num={max_results}"
    ua = random.choice(_BING_UA_POOL)
    headers = {
        "User-Agent": ua,
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Referer": "https://www.sogou.com/",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        resp = await client.get(url, headers=headers)
    if resp.status_code != 200:
        raise RuntimeError(f"Sogou returned HTTP {resp.status_code}")
    text = resp.text
    # Anti-spider page is ~5KB and contains "antispider" src or "安全验证" title
    if len(text) < 10_000 or "antispider" in text or "安全验证" in text[:800]:
        raise RuntimeError("Sogou returned a bot-check / verification page")
    # Find the results container (class="results")
    results_start = text.find('class="results"')
    if results_start == -1:
        results_start = text.find('id="main"')
    if results_start == -1:
        raise RuntimeError("Sogou: could not locate results container in page")
    search_area = text[results_start: results_start + 300_000]
    # Collect external title links (skip sogou.com and CDN sub-domains)
    title_links = re.findall(
        r'<a\s+href="(https?://(?!(?:www\.)?sogou\.com|[a-z0-9-]+\.sogoucdn\.com|cdnjs\.)[^"]+)"[^>]*>(.*?)</a>',
        search_area, re.S,
    )
    seen_urls: set[str] = set()
    results: list[dict] = []
    for url_r, title_r in title_links:
        clean_title = _strip_tags(title_r).strip()
        if len(clean_title) < 5 or url_r in seen_urls or len(results) >= max_results:
            continue
        seen_urls.add(url_r)
        results.append({"title": clean_title[:200], "url": url_r, "snippet": ""})
    return results


# Minimum seconds between consecutive web searches to avoid IP throttling
_MIN_SEARCH_INTERVAL: float = 1.0
_last_web_search_time: float = 0.0


async def _web_search(query: str, max_results: int = 5) -> list[dict]:
    """Search the web. For weather queries of known cities, uses sojson API for real-time data."""
    global _last_web_search_time
    # Enforce minimum inter-search delay to avoid IP rate-limiting
    import time as _time
    elapsed = _time.monotonic() - _last_web_search_time
    if elapsed < _MIN_SEARCH_INTERVAL:
        await asyncio.sleep(_MIN_SEARCH_INTERVAL - elapsed)
    _last_web_search_time = _time.monotonic()

    results: list[dict] = []
    is_weather = bool(_WEATHER_RE.search(query))

    # ── Weather fast-path: sojson structured API (city code map) ─────────────
    if is_weather:
        m = _CITY_FROM_WEATHER.match(query.strip())
        city = m.group(1) if m else query.split("天气")[0].strip()[:6] or ""
        if city:
            sojson_result = await _fetch_weather_sojson(city)
            if sojson_result:
                results.append(sojson_result)
                # Add Bing context for the query (general info without weather filter)
                extra: list[dict] = []
                try:
                    extra = await _search_bing(query, max(1, max_results - 1), SEARCH_TIMEOUT)
                    # Filter out non-weather results when we already have real data
                    extra = [r for r in extra if "weather.com.cn" in r.get("url", "")
                             or any(kw in r.get("title","") for kw in ["天气","气象","预报"])]
                except Exception:
                    pass
                return results + extra

    # ── General search via Bing ────────────────────────────────────────────────
    try:
        results = await _search_bing(query, max_results, SEARCH_TIMEOUT)
        if results:
            # For weather queries: try to enrich with weather.com.cn data if in results
            if is_weather:
                m2 = _CITY_FROM_WEATHER.match(query.strip())
                city2 = m2.group(1) if m2 else query.split("天气")[0].strip()[:6] or ""
                for r in results:
                    if "weather.com.cn" in r.get("url", "") and city2:
                        enriched = await _enrich_weather_cn(r["url"], city2)
                        if enriched:
                            results.insert(0, enriched)
                        break
            return results
    except Exception:
        pass
    # ── Fallback to Baidu ───────────────────────────────────────────────────
    try:
        return await _search_baidu(query, max_results, SEARCH_TIMEOUT)
    except Exception:
        pass
    # ── Fallback to Sogou ──────────────────────────────────────────────────
    try:
        return await _search_sogou(query, max_results, SEARCH_TIMEOUT)
    except Exception:
        return []



@app.get("/api/search")
async def search_api(q: str = "", n: int = 5):
    """Explicit search endpoint: GET /api/search?q=...&n=5"""
    if not q.strip():
        return {"results": [], "error": "empty query"}
    if not SEARCH_ENABLED:
        return {"results": [], "error": "search disabled in config"}
    results = await _web_search(q.strip(), max_results=min(n, 10))
    return {"query": q, "results": results}


def _build_search_context(results: list[dict]) -> str:
    """Format search results as a context block for the LLM."""
    if not results:
        return ""
    # Keep snippets short and strip anything that looks like a conversation
    lines = [
        "【联网搜索结果】以下是刚刚实时搜索到的内容，你必须直接基于这些信息回答用户问题。",
        "不要说'我无法实时获取信息'——搜索已经完成，请直接利用下列内容作答。",
        "若搜索结果不完整，请先给出已有信息，再说明不足之处：",
        "",
    ]
    for i, r in enumerate(results, 1):
        title = r.get("title", "").strip()
        url   = r.get("url",   "").strip()
        snip  = r.get("snippet", "").strip()
        # Truncate at first newline and strip date preambles
        snip = snip.split("\n")[0]
        snip = _DATE_PRE.sub("", snip)[:200]
        lines.append(f"[{i}] {title}")
        if snip:
            lines.append(f"    {snip}")
        if url:
            lines.append(f"    来源: {url}")
    lines.append("")
    lines.append("请根据以上搜索结果直接作答，引用时用 [编号] 标注来源，不要重复用户问题。")
    return "\n".join(lines)


# ── Chat proxy (streaming SSE) ────────────────────────────────────────────────

@app.post("/api/chat")
async def chat(request: Request):
    body = await request.json()
    body.setdefault("stream", True)

    # ── Optional web search injection ────────────────────────────────────────
    do_search: bool = bool(body.pop("web_search", False)) and SEARCH_ENABLED
    search_results: list[dict] = []
    search_query: str = ""

    if do_search:
        msgs = body.get("messages", [])
        # Use the last user message as the search query
        user_msgs = [m for m in msgs if m.get("role") == "user"]
        if user_msgs:
            search_query = user_msgs[-1].get("content", "")[:200].strip()
        if search_query:
            try:
                # Hard cap: give up after 10 s total so the UI never appears frozen
                search_results = await asyncio.wait_for(
                    _web_search(search_query, max_results=SEARCH_MAX), timeout=10.0
                )
            except asyncio.TimeoutError:
                search_results = []
            if search_results:
                ctx = _build_search_context(search_results)
                # Append context directly to the last user message instead of
                # injecting a separate system message — more compatible with
                # small models that get confused by extra system turns.
                new_msgs = [dict(m) for m in msgs]
                for m in reversed(new_msgs):
                    if m.get("role") == "user":
                        m["content"] = ctx + "\n\n用户问题：" + m["content"]
                        break
                body["messages"] = new_msgs

    async def stream_generator():
        # Emit search results metadata FIRST so the frontend can render citations
        if search_results:
            meta = json.dumps({"type": "search_results",
                               "query": search_query,
                               "results": search_results}, ensure_ascii=False)
            yield f"data: {meta}\n\n".encode()

        buf = b""
        async with httpx.AsyncClient(timeout=120.0) as client:
            try:
                async with client.stream(
                    "POST",
                    f"{BASE_URL}/v1/chat/completions",
                    json=body,
                    headers=COMMON_HEADERS,
                ) as resp:
                    # Non-200: gateway returned an error (e.g. "No healthy engine")
                    # The body is plain JSON, not SSE — wrap it so the frontend can show it
                    if resp.status_code != 200:
                        err_body = await resp.aread()
                        try:
                            detail = json.loads(err_body).get("detail", err_body.decode()[:200])
                        except Exception:
                            detail = err_body.decode()[:200]
                        if "No healthy" in detail or "not initialized" in detail or "Control Plane" in detail:
                            msg = "⚠️ 推理引擎未就绪，正在尝试自动恢复，请稍后重试。"
                        else:
                            msg = f"⚠️ Gateway 错误：{detail[:120]}"
                        safe = msg.replace('"', "'").replace('\n', ' ')
                        yield f'data: {{"choices":[{{"delta":{{"content":"{safe}"}},"finish_reason":"stop"}}]}}\n\n'.encode()
                        yield b"data: [DONE]\n\n"
                        return
                    async for chunk in resp.aiter_bytes():
                        yield chunk
                        # Count tokens for TPS tracking
                        buf += chunk
                        *complete, buf = buf.split(b"\n")
                        for line in complete:
                            line = line.strip()
                            if line.startswith(b"data: ") and line != b"data: [DONE]":
                                try:
                                    payload = json.loads(line[6:])
                                    content = (payload.get("choices", [{}])[0]
                                               .get("delta", {}).get("content", ""))
                                    if content:
                                        _record_tokens(1)
                                except Exception:
                                    pass
            except httpx.ConnectError:
                msg = "推理引擎未启动，请先启动 vllm-hust-gateway ，然后刷新页面。"
                yield f"data: {{\"choices\":[{{\"delta\":{{\"content\":\"{msg}\"}},\"finish_reason\":\"stop\"}}]}}\n\n".encode()
                yield b"data: [DONE]\n\n"
            except Exception as e:
                yield f"data: {{\"choices\":[{{\"delta\":{{\"content\":\"错误：{e}\"}},\"finish_reason\":\"stop\"}}]}}\n\n".encode()
                yield b"data: [DONE]\n\n"

    return StreamingResponse(
        stream_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Models proxy ──────────────────────────────────────────────────────────────

@app.get("/api/models")
async def models():
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{BASE_URL}/v1/models", headers=COMMON_HEADERS)
            return resp.json()
    except Exception:
        return {"object": "list", "data": [{"id": DEFAULT_MODEL, "object": "model"}]}


# ── TPS tracker ──────────────────────────────────────────────────────────────

_start_time = time.time()
_tps_window: list[tuple[float, int]] = []   # (timestamp, token_count)
_tps_lock = threading.Lock()
_total_tokens_served: int = 0


def _record_tokens(count: int) -> None:
    global _total_tokens_served
    now = time.time()
    with _tps_lock:
        _tps_window.append((now, count))
        _total_tokens_served += count
        # keep only last 15 s
        cutoff = now - 15
        while _tps_window and _tps_window[0][0] < cutoff:
            _tps_window.pop(0)


def _compute_tps() -> float:
    with _tps_lock:
        if len(_tps_window) < 2:
            return 0.0
        now = time.time()
        recent = [(t, n) for t, n in _tps_window if t >= now - 10]
        if len(recent) < 2:
            return 0.0
        window = recent[-1][0] - recent[0][0]
        if window < 0.3:
            return 0.0
        return round(sum(n for _, n in recent) / window, 1)


def _detect_backends() -> list[dict]:
    """Auto-detect available hardware backends on this machine."""
    backends: list[dict] = []
    active = BACKEND_TYPE.lower()

    # ── NVIDIA CUDA ──
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "-L"], timeout=3, text=True, stderr=subprocess.DEVNULL
        )
        gpus = [l.strip() for l in out.strip().splitlines() if l.strip()]
        if gpus:
            names = []
            for g in gpus:
                m = re.search(r"GPU \d+:\s*(.+?)(?:\s*\(UUID|$)", g)
                if m:
                    names.append(m.group(1).strip())
            base = names[0] if names else "NVIDIA GPU"
            label = f"{base} ×{len(gpus)}" if len(gpus) > 1 else base
            backends.append({
                "id": "nvidia-cuda",
                "label": label,
                "available": True,
                "active": any(k in active for k in ("nvidia", "cuda", "a100", "h100", "rtx", "v100")),
                "tag": "CUDA",
            })
    except Exception:
        pass

    # ── Ascend NPU ──
    ascend_ok = any(
        Path(p).exists()
        for p in ("/usr/local/Ascend/ascend-toolkit", "/usr/local/Ascend/driver")
    )
    if not ascend_ok:
        try:
            subprocess.check_output(
                ["npu-smi", "info"], timeout=3, text=True,
                stderr=subprocess.DEVNULL,
            )
            ascend_ok = True
        except Exception:
            pass
    if ascend_ok:
        backends.append({
            "id": "ascend-npu",
            "label": "华为昇腾 NPU",
            "available": True,
            "active": any(k in active for k in ("ascend", "npu")),
            "tag": "NPU",
        })

    # ── ROCm (AMD) ──
    try:
        out = subprocess.check_output(
            ["rocm-smi", "--showproductname"], timeout=3, text=True,
            stderr=subprocess.DEVNULL,
        )
        if "GPU" in out or "Radeon" in out or "Instinct" in out:
            backends.append({
                "id": "amd-rocm",
                "label": "AMD ROCm GPU",
                "available": True,
                "active": any(k in active for k in ("rocm", "amd", "radeon")),
                "tag": "ROCm",
            })
    except Exception:
        pass

    # ── CPU (always available) ──
    import platform
    cpu_label = platform.processor() or platform.machine() or "CPU"
    cpu_label = cpu_label.split("\n")[0][:40]
    backends.append({
        "id": "cpu",
        "label": f"CPU ({cpu_label})",
        "available": True,
        "active": active == "cpu",
        "tag": "CPU",
    })

    # Ensure exactly one is marked active (fallback to first)
    if not any(b["active"] for b in backends) and backends:
        backends[0]["active"] = True

    return backends


@app.get("/api/backends")
async def backends():
    """Return detected hardware backends for the frontend dropdown."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _detect_backends)


_BACKEND_ID_TO_TYPE: dict[str, str] = {
    "nvidia-cuda": "NVIDIA CUDA",
    "ascend-npu":  "Ascend NPU",
    "amd-rocm":    "AMD ROCm",
    "cpu":         "CPU",
}


@app.put("/api/backend")
async def switch_backend(request: Request):
    """Persist the selected backend to config.ini so the next engine restart picks it up."""
    global BACKEND_TYPE
    body = await request.json()
    backend_id = body.get("id", "")
    label = _BACKEND_ID_TO_TYPE.get(backend_id)
    if not label:
        return JSONResponse({"ok": False, "error": f"unknown backend id: {backend_id}"}, status_code=400)

    BACKEND_TYPE = label
    # Persist to config.ini
    target_section = "vllm_hust"
    if not config.has_section(target_section):
        config.add_section(target_section)
    config.set(target_section, "backend_type", label)
    try:
        with open(config_path, "w", encoding="utf-8") as fh:
            config.write(fh)
    except Exception as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=500)

    return {"ok": True, "backend_type": label}


def _get_gpu_stats() -> dict[str, float]:
    """Query nvidia-smi and aggregate across all GPUs."""
    try:
        out = subprocess.check_output(
            ["nvidia-smi",
             "--query-gpu=utilization.gpu,memory.used,memory.total",
             "--format=csv,noheader,nounits"],
            timeout=3, text=True,
        )
        rows = [l.strip() for l in out.strip().splitlines() if l.strip()]
        if not rows:
            return {}
        max_util, total_used, total_total = 0.0, 0.0, 0.0
        for row in rows:
            parts = [p.strip() for p in row.split(",")]
            if len(parts) >= 3:
                max_util = max(max_util, float(parts[0]))
                total_used  += float(parts[1])   # MiB
                total_total += float(parts[2])   # MiB
        return {
            "gpuUtilPct":   round(max_util, 1),
            "gpuMemUsedGb": round(total_used  / 1024, 1),
            "gpuMemTotalGb": round(total_total / 1024, 1),
        }
    except Exception:
        return {}


# ── Metrics proxy ─────────────────────────────────────────────────────────────

@app.get("/api/metrics")
async def metrics():
    result: dict = {
        "tokensPerSecond": _compute_tps(),
        "pendingRequests": 0,
        "gpuUtilPct": 0,
        "gpuMemUsedGb": 0,
        "gpuMemTotalGb": 0,
        "uptimeSeconds": int(time.time() - _start_time),
        "totalRequestsServed": 0,
        "avgLatencyMs": 0,
        "modelName": DEFAULT_MODEL,
        "backendType": BACKEND_TYPE,
    }

    # GPU stats (blocking subprocess → run in thread pool)
    loop = asyncio.get_event_loop()
    gpu = await loop.run_in_executor(None, _get_gpu_stats)
    result.update(gpu)

    # Router / engine stats from gateway
    async with httpx.AsyncClient(timeout=2.0) as client:
        try:
            r = await client.get(f"{BASE_URL}/v1/router/summary", headers=COMMON_HEADERS)
            if r.is_success:
                data = r.json()
                total_req, total_lat, eng_cnt = 0, 0.0, 0
                for model_data in data.get("by_model", {}).values():
                    for eng in model_data.get("engines", []):
                        total_req += eng.get("request_count", 0)
                        total_lat += eng.get("avg_latency_ms", 0.0)
                        eng_cnt   += 1
                result["totalRequestsServed"] = total_req
                if eng_cnt > 0 and total_lat > 0:
                    result["avgLatencyMs"] = round(total_lat / eng_cnt, 1)
        except Exception:
            pass

    return result


# ── Model Hub ────────────────────────────────────────────────────────────────

MODEL_CATALOG: list[dict[str, Any]] = [
    {"id": "Qwen2.5-7B-Instruct",     "name": "Qwen 2.5  7B",   "repo_id": "Qwen/Qwen2.5-7B-Instruct",
     "params": "7B",  "size_gb": 15.2, "vram_gb": 10,
     "description": "阿里通义千问 2.5 指令版，中英双语强，速度快，适合日常对话与代码",
     "tags": ["中文", "代码", "推荐"], "color": "#f59e0b"},
    {"id": "Qwen2.5-14B-Instruct",    "name": "Qwen 2.5 14B",   "repo_id": "Qwen/Qwen2.5-14B-Instruct",
     "params": "14B", "size_gb": 28.9, "vram_gb": 20,
     "description": "千问 2.5 14B，输出质量更高，适合需要高质量分析与写作的场景",
     "tags": ["中文", "多语言"], "color": "#f59e0b"},
    {"id": "Qwen2.5-32B-Instruct",    "name": "Qwen 2.5 32B",   "repo_id": "Qwen/Qwen2.5-32B-Instruct",
     "params": "32B", "size_gb": 65.1, "vram_gb": 48,
     "description": "千问 2.5 旗舰级，综合能力业界领先，适合专业级用途",
     "tags": ["中文", "旗舰"], "color": "#f59e0b"},
    {"id": "DeepSeek-R1-Distill-Qwen-7B",  "name": "DeepSeek-R1 7B",  "repo_id": "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
     "params": "7B",  "size_gb": 15.3, "vram_gb": 10,
     "description": "DeepSeek R1 蒸馏版，推理/数学/代码能力突出，轻量高效",
     "tags": ["推理", "数学", "代码"], "color": "#3b82f6"},
    {"id": "DeepSeek-R1-Distill-Qwen-14B", "name": "DeepSeek-R1 14B", "repo_id": "deepseek-ai/DeepSeek-R1-Distill-Qwen-14B",
     "params": "14B", "size_gb": 28.9, "vram_gb": 20,
     "description": "DeepSeek R1 14B 蒸馏，强推理与自然对话兼顾",
     "tags": ["推理", "数学"], "color": "#3b82f6"},
    {"id": "DeepSeek-R1-Distill-Qwen-32B", "name": "DeepSeek-R1 32B", "repo_id": "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B",
     "params": "32B", "size_gb": 65.0, "vram_gb": 48,
     "description": "DeepSeek R1 32B 旗舰蒸馏，接近 o1 级别推理能力",
     "tags": ["推理", "旗舰", "数学"], "color": "#3b82f6"},
    {"id": "Mistral-7B-Instruct-v0.3", "name": "Mistral 7B Instruct", "repo_id": "mistralai/Mistral-7B-Instruct-v0.3",
     "params": "7B",  "size_gb": 14.5, "vram_gb": 10,
     "description": "欧洲代表性模型，英文能力出色，代码与推理均衡",
     "tags": ["英文", "代码"], "color": "#8b5cf6"},
    {"id": "Llama-3.1-8B-Instruct",   "name": "Llama 3.1 8B",  "repo_id": "meta-llama/Meta-Llama-3.1-8B-Instruct",
     "params": "8B",  "size_gb": 16.1, "vram_gb": 12,
     "description": "Meta Llama 3.1，多语言指令跟随强（需 HuggingFace Token）",
     "tags": ["英文", "多语言"], "color": "#10b981", "requires_auth": True},
    {"id": "Llama-3.3-70B-Instruct",   "name": "Llama 3.3 70B",  "repo_id": "meta-llama/Llama-3.3-70B-Instruct",
     "params": "70B", "size_gb": 141.0, "vram_gb": 96,
     "description": "Meta 旗舰开源大模型，能力接近 GPT-4o（需 token + 大内存）",
     "tags": ["英文", "旗舰"], "color": "#10b981", "requires_auth": True},
]

MODELS_DIR = Path(cfg("hub", "models_dir", "~/Downloads/vllm-hust-models")).expanduser()
HF_ENDPOINT = cfg("hub", "hf_endpoint", "").strip()
HF_TOKEN    = cfg("hub", "hf_token", "").strip() or None

# Active downloads — model_id -> progress dict
_downloads: dict[str, dict[str, Any]] = {}
_download_stop: dict[str, bool] = {}


def _dir_size(path: Path) -> int:
    # Include .incomplete files — huggingface_hub writes partial content to
    # <filename>.incomplete during snapshot_download. Excluding them would
    # always report 0 bytes downloaded and make the progress bar appear stuck.
    try:
        return sum(f.stat().st_size for f in path.rglob("*")
                   if f.is_file() and not f.name.endswith(".lock"))
    except Exception:
        return 0


def _get_installed() -> set[str]:
    if not MODELS_DIR.exists():
        return set()
    return {
        d.name for d in MODELS_DIR.iterdir()
        if d.is_dir() and (any(d.rglob("*.safetensors")) or any(d.rglob("*.bin")))
    }


def _download_worker(model_id: str, repo_id: str, save_path: Path, total_bytes: int) -> None:
    _downloads[model_id] = {
        "status": "downloading", "pct": 0,
        "speed_mbps": 0.0, "current_file": "正在连接…",
        "downloaded_bytes": 0, "total_bytes": total_bytes, "error": None,
    }
    save_path.mkdir(parents=True, exist_ok=True)

    def _monitor() -> None:
        last_bytes, last_t = 0, time.time()
        while _downloads.get(model_id, {}).get("status") == "downloading":
            time.sleep(1)
            downloaded = _dir_size(save_path)
            now = time.time()
            speed = max((downloaded - last_bytes) / max(now - last_t, 0.001) / 1e6, 0.0)
            pct = min(int(downloaded / max(total_bytes, 1) * 100), 99) if total_bytes > 0 else 0
            # Show the currently-downloading file name (strip .incomplete suffix)
            try:
                in_progress = [
                    f.name.removesuffix(".incomplete")
                    for f in save_path.rglob("*.incomplete")
                    if f.is_file()
                ]
                current_file = in_progress[0] if in_progress else (
                    "正在下载…" if downloaded > 0 else "正在连接…"
                )
            except Exception:
                current_file = "正在下载…"
            _downloads[model_id].update({
                "downloaded_bytes": downloaded, "speed_mbps": round(speed, 1),
                "pct": pct, "current_file": current_file,
            })
            last_bytes, last_t = downloaded, now

    threading.Thread(target=_monitor, daemon=True).start()

    try:
        try:
            from huggingface_hub import snapshot_download  # type: ignore
        except ImportError:
            raise RuntimeError("请先安装: pip install huggingface_hub")

        env_backup: dict[str, str | None] = {}
        overrides: dict[str, str] = {}
        if HF_ENDPOINT:
            overrides["HF_ENDPOINT"] = HF_ENDPOINT
        if HF_TOKEN:
            overrides["HUGGING_FACE_HUB_TOKEN"] = HF_TOKEN
        for k, v in overrides.items():
            env_backup[k] = os.environ.get(k)
            os.environ[k] = v

        try:
            # local_dir_use_symlinks was removed in huggingface_hub >= 0.23;
            # fall back gracefully if the kwarg is rejected.
            _sd_kwargs: dict[str, Any] = {
                "repo_id": repo_id,
                "local_dir": str(save_path),
                "token": HF_TOKEN or None,
            }
            try:
                snapshot_download(local_dir_use_symlinks=False, **_sd_kwargs)
            except TypeError:
                snapshot_download(**_sd_kwargs)
        finally:
            for k, v in env_backup.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v

        _downloads[model_id]["status"] = "done"
        _downloads[model_id]["pct"] = 100
        _downloads[model_id]["current_file"] = "下载完成 ✓"

    except Exception as exc:
        if _download_stop.get(model_id):
            _downloads[model_id]["status"] = "cancelled"
        else:
            _downloads[model_id]["status"] = "error"
            _downloads[model_id]["error"] = str(exc)


@app.get("/api/hub/catalog")
async def hub_catalog():
    installed = _get_installed()
    default_model = cfg("vllm_hust", "default_model", DEFAULT_MODEL)
    result = []
    for m in MODEL_CATALOG:
        item = dict(m)
        item["installed"] = m["id"] in installed
        item["active"]    = m["id"] == default_model
        item["download"]  = _downloads.get(m["id"])
        if item["download"] is None and item["installed"]:
            item["download"] = {"status": "done", "pct": 100}
        result.append(item)
    return result


@app.post("/api/hub/download/{model_id}")
async def hub_start_download(model_id: str):
    model = next((m for m in MODEL_CATALOG if m["id"] == model_id), None)
    if not model:
        return JSONResponse({"error": "model not found"}, status_code=404)
    if _downloads.get(model_id, {}).get("status") == "downloading":
        return {"status": "already_downloading"}
    _download_stop.pop(model_id, None)
    t = threading.Thread(
        target=_download_worker,
        args=(model_id, model["repo_id"], MODELS_DIR / model_id, int(model["size_gb"] * 1e9)),
        daemon=True,
    )
    t.start()
    return {"status": "started"}


@app.get("/api/hub/progress/{model_id}")
async def hub_progress(model_id: str):
    import json as _json

    async def _stream():
        for _ in range(1800):  # max 30 min
            state = _downloads.get(model_id)
            yield f"data: {_json.dumps(state or {'status': 'not_started'}, ensure_ascii=False)}\n\n"
            if state and state["status"] in ("done", "error", "cancelled"):
                break
            await asyncio.sleep(1)

    return StreamingResponse(
        _stream(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.delete("/api/hub/download/{model_id}")
async def hub_cancel(model_id: str):
    _download_stop[model_id] = True
    if model_id in _downloads:
        _downloads[model_id]["status"] = "cancelled"
    return {"status": "cancelled"}


@app.post("/api/hub/activate/{model_id}")
async def hub_activate(model_id: str):
    global DEFAULT_MODEL
    model_path = MODELS_DIR / model_id
    if not model_path.exists():
        return JSONResponse({"error": "model not installed"}, status_code=404)
    text = config_path.read_text(encoding="utf-8")
    text = re.sub(r"^(\s*default_model\s*=).*$", rf"\1 {model_id}",  text, flags=re.MULTILINE)
    text = re.sub(r"^(\s*model_path\s*=).*$",    rf"\1 {model_path}", text, flags=re.MULTILINE)
    config_path.write_text(text, encoding="utf-8")
    DEFAULT_MODEL = model_id
    return {"status": "activated", "model": model_id}


# ── Startup ───────────────────────────────────────────────────────────────────

def _find_free_port(preferred: int) -> int:
    """Return preferred port if free, else find the next available one."""
    for p in range(preferred, preferred + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("", p))
                return p
            except OSError:
                continue
    return preferred  # give up, let uvicorn report the error

def _open_browser(port: int):
    time.sleep(1.2)
    webbrowser.open(f"http://localhost:{port}")

if __name__ == "__main__":
    import threading

    actual_port = _find_free_port(PORT)

    print("=" * 52)
    print(f"  {BRAND_NAME}")
    if actual_port != PORT:
        print(f"  ⚠ 端口 {PORT} 已被占用 → 自动切换到 {actual_port}")
        print(f"  提示：可编辑 config.ini 将 port = {actual_port} 固定")
    print(f"  手动访问: http://localhost:{actual_port}")
    print("=" * 52)

    threading.Thread(target=_open_browser, args=(actual_port,), daemon=True).start()

    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=actual_port,
        log_level="warning",
        reload=False,
    )
