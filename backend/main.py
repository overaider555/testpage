"""
Local FastAPI server: test APIs (CORS-enabled) + serves the static API Console UI.

From repo root:
  uvicorn backend.main:app --reload

From this folder:
  uvicorn main:app --reload

Then open http://127.0.0.1:8000/ and try GET http://127.0.0.1:8000/api/health
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup
from fastapi import Body, FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

_REPO_ROOT = Path(__file__).resolve().parent.parent
UI_DIR = _REPO_ROOT / "ui"

NYAA_ORIGIN = "https://nyaa.si"
NYAA_USER_AGENT = "APIConsoleLocal/1.0 (Nyaa search proxy; +https://github.com/)"

app = FastAPI(
    title="API Console test server",
    description="Sample HTTP endpoints and static UI for exercising the API Console.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health", tags=["test"])
def api_health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/echo", tags=["test"])
def api_echo_get(message: str | None = None) -> dict[str, Any]:
    return {"method": "GET", "message": message}


@app.post("/api/echo", tags=["test"])
async def api_echo_post(request: Request) -> dict[str, Any]:
    raw = await request.body()
    text = raw.decode("utf-8", errors="replace") if raw else ""
    parsed: Any = None
    ct = request.headers.get("content-type", "")
    if "json" in ct.lower() and text.strip():
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            parsed = None
    return {"method": "POST", "content_type": ct or None, "text": text, "json": parsed}


@app.put("/api/echo", tags=["test"])
@app.patch("/api/echo", tags=["test"])
async def api_echo_write(request: Request) -> dict[str, Any]:
    raw = await request.body()
    text = raw.decode("utf-8", errors="replace") if raw else ""
    parsed: Any = None
    ct = request.headers.get("content-type", "")
    if "json" in ct.lower() and text.strip():
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            parsed = None
    return {
        "method": request.method,
        "content_type": ct or None,
        "text": text,
        "json": parsed,
    }


@app.delete("/api/echo/{item_id}", tags=["test"])
def api_echo_delete(item_id: str) -> dict[str, str]:
    return {"method": "DELETE", "item_id": item_id}


@app.get("/api/headers", tags=["test"])
def api_headers(request: Request) -> dict[str, str]:
    return {k: v for k, v in request.headers.items()}


@app.get("/api/status/{code:int}", tags=["test"])
def api_status(code: int) -> Response:
    """Returns an empty body with the given HTTP status (for testing status display)."""
    if code < 100 or code > 599:
        return JSONResponse({"error": "status code must be 100–599"}, status_code=400)
    return Response(status_code=code)


def _is_anime_or_live_action(category: str) -> bool:
    c = (category or "").strip().lower()
    return c.startswith("anime") or "live action" in c


_QUALITY_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"(?i)\b4320p\b"), "4320p"),
    (re.compile(r"(?i)\b2160p\b"), "2160p"),
    (re.compile(r"(?i)\b1440p\b"), "1440p"),
    (re.compile(r"(?i)\b1080p\b"), "1080p"),
    (re.compile(r"(?i)\b720p\b"), "720p"),
    (re.compile(r"(?i)\b480p\b"), "480p"),
    (re.compile(r"(?i)\b360p\b"), "360p"),
    (re.compile(r"(?i)\b288p\b"), "288p"),
    (re.compile(r"(?i)\b4k\b"), "4K"),
    (re.compile(r"(?i)\b8k\b"), "8K"),
]


def _extract_video_quality(title: str) -> str | None:
    for pat, label in _QUALITY_PATTERNS:
        if pat.search(title):
            return label
    return None


def _strip_url_fragment(url: str) -> str:
    if "#" in url:
        return url.split("#", 1)[0]
    return url


def _pick_torrent_view_anchor(name_td: Any) -> Any | None:
    """First /view/… link that is not the comments anchor."""
    for la in name_td.find_all("a", href=True):
        href = str(la.get("href", "")).strip()
        if not href or "#comments" in href:
            continue
        if "/view/" in href:
            return la
    return None


def _parse_pagination_total_results(html: str) -> int | None:
    soup = BeautifulSoup(html, "html.parser")
    el = soup.select_one(".pagination-page-info")
    if not el:
        return None
    text = el.get_text(" ", strip=True)
    m = re.search(r"out of\s+(\d+)\s+results", text, re.I)
    if m:
        return int(m.group(1))
    return None


def _max_page_index_from_pagination(html: str) -> int:
    soup = BeautifulSoup(html, "html.parser")
    n = 1
    for a in soup.select("ul.pagination a[href]"):
        href = a.get("href", "")
        m = re.search(r"[?&]p=(\d+)", str(href))
        if m:
            n = max(n, int(m.group(1)))
    return n


def _page_count_to_fetch(html: str, rows_on_first_page: int) -> int:
    """How many listing pages to request (including page 1, already fetched)."""
    max_pages = 200
    if rows_on_first_page <= 0:
        return 1
    total = _parse_pagination_total_results(html)
    if total is not None:
        return min(max_pages, max(1, math.ceil(total / rows_on_first_page)))
    return min(max_pages, max(1, _max_page_index_from_pagination(html)))


def _dedupe_rows_by_view_id(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for r in rows:
        url = str(r.get("view_url", ""))
        m = re.search(r"/view/(\d+)", url)
        key = m.group(1) if m else url
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


def _leading_bracket_prefix(title: str) -> str | None:
    """First [TAG] at the start of the title, e.g. '[ASW] Show …' -> 'ASW'."""
    t = title.strip()
    if not t.startswith("["):
        return None
    end = t.find("]")
    if end <= 1:
        return None
    inner = t[1:end].strip()
    return inner or None


def _parse_nyaa_rows(html: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    table = soup.select_one("table.torrent-list")
    if not table:
        return []
    body = table.find("tbody") or table
    out: list[dict[str, Any]] = []
    for tr in body.find_all("tr", recursive=False):
        tds = tr.find_all("td", recursive=False)
        if len(tds) < 8:
            continue
        cat_a = tds[0].find("a")
        category = ""
        if cat_a:
            category = (cat_a.get("title") or cat_a.get_text(strip=True) or "").strip()

        name_a = _pick_torrent_view_anchor(tds[1])
        if not name_a or not name_a.get("href"):
            continue
        title = name_a.get_text(strip=True)
        view_path = _strip_url_fragment(str(name_a["href"]).strip())
        view_url = urljoin(NYAA_ORIGIN + "/", view_path)

        link_td = tds[2]
        magnet = None
        torrent_url = None
        for la in link_td.find_all("a", href=True):
            href = str(la["href"])
            if "#comments" in href:
                continue
            if href.startswith("magnet:"):
                magnet = href
            elif "/download/" in href:
                torrent_url = urljoin(NYAA_ORIGIN + "/", _strip_url_fragment(href))

        size = tds[3].get_text(strip=True)
        date_s = tds[4].get_text(strip=True)
        seeders = tds[5].get_text(strip=True)
        leechers = tds[6].get_text(strip=True)
        downloads = tds[7].get_text(strip=True)
        prefix = _leading_bracket_prefix(title)
        quality = None
        if _is_anime_or_live_action(category):
            quality = _extract_video_quality(title)

        out.append(
            {
                "title": title,
                "prefix": prefix,
                "category": category,
                "quality": quality,
                "size": size,
                "date": date_s,
                "seeders": seeders,
                "leechers": leechers,
                "downloads": downloads,
                "view_url": view_url,
                "magnet": magnet,
                "torrent_url": torrent_url,
            }
        )
    return out


def _quality_sort_key(label: str) -> tuple[int, str]:
    """Rough resolution order for filter dropdown."""
    order = {
        "8K": 0,
        "4K": 1,
        "4320p": 2,
        "2160p": 3,
        "1440p": 4,
        "1080p": 5,
        "720p": 6,
        "480p": 7,
        "360p": 8,
        "288p": 9,
    }
    return (order.get(label, 100), str(label).lower())


@app.get("/api/nyaa/search", tags=["nyaa"])
async def nyaa_search(q: str = "") -> Any:
    """
    Proxy search for https://nyaa.si/ (HTML parsed to JSON). Used by the Scanner tab
    because browsers cannot call Nyaa directly (no CORS).

    Fetches every listing page for the query (up to 200 pages) and merges results.
    """
    base_params: dict[str, str | int] = {"f": 0, "c": "0_0", "q": q.strip()}
    headers = {
        "User-Agent": NYAA_USER_AGENT,
        "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
    }
    all_rows: list[dict[str, Any]] = []
    pages_fetched = 0
    total_reported: int | None = None
    n_first = 0
    num_pages = 1
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=60.0) as client:
            r = await client.get(NYAA_ORIGIN + "/", params=base_params, headers=headers)
            if r.status_code != 200:
                return JSONResponse(
                    {"error": f"Nyaa returned HTTP {r.status_code}"},
                    status_code=502,
                )
            first_html = r.text
            total_reported = _parse_pagination_total_results(first_html)
            page1 = _parse_nyaa_rows(first_html)
            pages_fetched = 1
            n_first = len(page1)
            num_pages = _page_count_to_fetch(first_html, n_first)
            all_rows.extend(page1)

            for p in range(2, num_pages + 1):
                params = {**base_params, "p": p}
                rp = await client.get(NYAA_ORIGIN + "/", params=params, headers=headers)
                if rp.status_code != 200:
                    break
                chunk = _parse_nyaa_rows(rp.text)
                if not chunk:
                    break
                all_rows.extend(chunk)
                pages_fetched += 1
    except httpx.RequestError as e:
        return JSONResponse(
            {"error": "Could not reach Nyaa.", "detail": str(e)},
            status_code=502,
        )

    results = _dedupe_rows_by_view_id(all_rows)
    prefixes = sorted(
        {row["prefix"] for row in results if row.get("prefix")},
        key=lambda s: str(s).lower(),
    )
    categories = sorted(
        {row["category"] for row in results if row.get("category")},
        key=lambda s: str(s).lower(),
    )
    qualities = sorted(
        {row["quality"] for row in results if row.get("quality")},
        key=_quality_sort_key,
    )
    return {
        "query": q.strip(),
        "count": len(results),
        "total_reported": total_reported,
        "pages_fetched": pages_fetched,
        "pages_estimated": num_pages,
        "prefixes": prefixes,
        "categories": categories,
        "qualities": qualities,
        "results": results,
    }


@app.post("/api/reverse", tags=["test"])
def api_reverse(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    text = payload.get("text")
    if not isinstance(text, str):
        return JSONResponse(
            {"error": 'JSON body must include string field "text"'},
            status_code=422,
        )
    return {"reversed": text[::-1]}


# --- static UI (explicit routes so /docs and /openapi.json stay available) ---


@app.get("/")
def serve_index() -> FileResponse:
    return FileResponse(UI_DIR / "index.html")


@app.get("/styles.css")
def serve_styles() -> FileResponse:
    return FileResponse(UI_DIR / "styles.css", media_type="text/css")


@app.get("/app.js")
def serve_app_js() -> FileResponse:
    return FileResponse(UI_DIR / "app.js", media_type="application/javascript")
