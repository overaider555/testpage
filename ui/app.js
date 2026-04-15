(function () {
  "use strict";

  const STORAGE_KEY = "api-console-state-v1";
  const BACKEND_KEY = "api-console-backend-base-v1";
  const DEFAULT_BACKEND = "http://localhost:8000";

  const methodEl = document.getElementById("method");
  const urlEl = document.getElementById("url");
  const sendBtn = document.getElementById("send-btn");
  const cancelBtn = document.getElementById("cancel-btn");
  const bodyEl = document.getElementById("body");
  const prettyJsonEl = document.getElementById("pretty-json");
  const copyBtn = document.getElementById("copy-response");
  const responseMetaEl = document.getElementById("response-meta");
  const responseHeadersEl = document.getElementById("response-headers");
  const responseBodyEl = document.getElementById("response-body");
  const queryRowsEl = document.getElementById("query-rows");
  const headerRowsEl = document.getElementById("header-rows");
  const viewRestEl = document.getElementById("view-rest");
  const viewScannerEl = document.getElementById("view-scanner");
  const scannerQueryEl = document.getElementById("scanner-query");
  const scannerSearchBtn = document.getElementById("scanner-search-btn");
  const scannerPrefixEl = document.getElementById("scanner-prefix");
  const scannerCategoryEl = document.getElementById("scanner-category");
  const scannerQualityEl = document.getElementById("scanner-quality");
  const scannerStatusEl = document.getElementById("scanner-status");
  const scannerTbodyEl = document.getElementById("scanner-tbody");
  const scannerTableEl = document.querySelector(".scanner-table");
  const backendSelectEl = document.getElementById("backend-select");
  const backendCustomRowEl = document.getElementById("backend-custom-row");
  const backendCustomEl = document.getElementById("backend-custom");

  const BACKEND_CUSTOM_VALUE = "custom";

  /** @type {AbortController | null} */
  let activeController = null;
  /** @type {string} */
  let lastResponseBodyText = "";
  /** @type {Array<Record<string, unknown>>} */
  let scannerLastResults = [];
  /** @type {{ key: string, dir: 'asc' | 'desc' }} */
  let scannerSort = { key: "date", dir: "desc" };

  const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH", "DELETE"]);

  function normalizeBackendBase(raw) {
    let s = String(raw ?? "").trim();
    if (!s) return DEFAULT_BACKEND;
    s = s.replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(s)) s = "http://" + s;
    return s;
  }

  function getBackendBase() {
    try {
      const stored = localStorage.getItem(BACKEND_KEY);
      if (stored == null || stored === "") return DEFAULT_BACKEND;
      return normalizeBackendBase(stored);
    } catch {
      return DEFAULT_BACKEND;
    }
  }

  /** @param {string} path must start with / e.g. /api/nyaa/search */
  function apiUrl(path) {
    const base = getBackendBase();
    const p = path.startsWith("/") ? path : "/" + path;
    return base + p;
  }

  function ensureSameOriginBackendOption() {
    if (!backendSelectEl) return;
    const origin = typeof location !== "undefined" ? location.origin : "";
    if (!origin || !/^https?:\/\//i.test(origin)) return;
    const norm = normalizeBackendBase(origin);
    const dup = Array.from(backendSelectEl.options).some(
      (o) => o.value !== BACKEND_CUSTOM_VALUE && normalizeBackendBase(o.value) === norm
    );
    if (dup) return;
    const opt = document.createElement("option");
    opt.value = norm;
    opt.textContent = "This page (" + norm + ")";
    const customOpt = backendSelectEl.querySelector('option[value="' + BACKEND_CUSTOM_VALUE + '"]');
    if (customOpt) backendSelectEl.insertBefore(opt, customOpt);
  }

  function setBackendCustomRowVisible(show) {
    if (backendCustomRowEl) backendCustomRowEl.toggleAttribute("hidden", !show);
  }

  function persistBackendFromUI() {
    if (!backendSelectEl) return;
    let url;
    if (backendSelectEl.value === BACKEND_CUSTOM_VALUE) {
      if (!backendCustomEl) return;
      url = normalizeBackendBase(backendCustomEl.value);
    } else {
      url = normalizeBackendBase(backendSelectEl.value);
    }
    try {
      localStorage.setItem(BACKEND_KEY, url);
    } catch {
      /* ignore */
    }
  }

  function syncBackendUIFromStorage() {
    if (!backendSelectEl) return;
    ensureSameOriginBackendOption();
    const stored = getBackendBase();
    const presets = Array.from(backendSelectEl.options).filter((o) => o.value !== BACKEND_CUSTOM_VALUE);
    let matched = false;
    for (const o of presets) {
      if (normalizeBackendBase(o.value) === stored) {
        backendSelectEl.value = o.value;
        matched = true;
        break;
      }
    }
    if (!matched) {
      backendSelectEl.value = BACKEND_CUSTOM_VALUE;
      if (backendCustomEl) backendCustomEl.value = stored;
      setBackendCustomRowVisible(true);
    } else {
      setBackendCustomRowVisible(false);
    }
  }

  function onBackendSelectChange() {
    if (!backendSelectEl) return;
    if (backendSelectEl.value === BACKEND_CUSTOM_VALUE) {
      setBackendCustomRowVisible(true);
      if (backendCustomEl) {
        if (!backendCustomEl.value.trim()) backendCustomEl.value = getBackendBase();
        backendCustomEl.focus();
      }
    } else {
      setBackendCustomRowVisible(false);
      persistBackendFromUI();
    }
  }

  function onBackendCustomCommit() {
    if (!backendSelectEl || backendSelectEl.value !== BACKEND_CUSTOM_VALUE) return;
    persistBackendFromUI();
    syncBackendUIFromStorage();
  }

  function normalizeUrl(raw) {
    let u = raw.trim();
    if (!u) return "";
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    return u;
  }

  function parseKvRows(container) {
    const rows = container.querySelectorAll(".kv-row");
    /** @type {Array<{key: string, value: string}>} */
    const out = [];
    rows.forEach((row) => {
      const inputs = row.querySelectorAll("input");
      const key = (inputs[0]?.value || "").trim();
      const value = inputs[1]?.value ?? "";
      if (key) out.push({ key, value });
    });
    return out;
  }

  function buildUrlWithQuery(baseInput, queryPairs) {
    const normalized = normalizeUrl(baseInput);
    if (!normalized) throw new Error("Enter a URL.");
    const u = new URL(normalized);
    queryPairs.forEach(({ key, value }) => {
      u.searchParams.append(key, value);
    });
    return u.toString();
  }

  function buildHeaders() {
    const h = new Headers();
    parseKvRows(headerRowsEl).forEach(({ key, value }) => {
      h.append(key, value);
    });
    return h;
  }

  function addKvRow(container, key = "", value = "") {
    const row = document.createElement("div");
    row.className = "kv-row";
    row.innerHTML =
      '<input type="text" placeholder="Key" spellcheck="false" autocomplete="off" />' +
      '<input type="text" placeholder="Value" spellcheck="false" autocomplete="off" />' +
      '<button type="button" class="btn-icon" title="Remove row" aria-label="Remove row">×</button>';
    const inputs = row.querySelectorAll("input");
    inputs[0].value = key;
    inputs[1].value = value;
    row.querySelector(".btn-icon").addEventListener("click", () => {
      row.remove();
      if (!container.querySelector(".kv-row")) addKvRow(container);
    });
    container.appendChild(row);
  }

  function setTab(name) {
    viewRestEl.querySelectorAll(".tab").forEach((t) => {
      const active = t.dataset.tab === name;
      t.classList.toggle("active", active);
      t.setAttribute("aria-selected", active ? "true" : "false");
    });
    viewRestEl.querySelectorAll(".tab-panel").forEach((p) => {
      const id = p.id.replace("panel-", "");
      const show = id === name;
      p.toggleAttribute("hidden", !show);
      p.classList.toggle("active", show);
    });
  }

  function setAppView(view) {
    const isRest = view === "rest";
    viewRestEl.toggleAttribute("hidden", !isRest);
    if (viewScannerEl) viewScannerEl.toggleAttribute("hidden", isRest);
    document.querySelectorAll("[data-app-tab]").forEach((btn) => {
      const active = btn.dataset.appTab === view;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  function statusClass(code) {
    if (code >= 200 && code < 300) return "ok";
    if (code >= 400 && code < 500) return "warn";
    if (code >= 500) return "err";
    return "muted";
  }

  function formatBody(text, contentType) {
    const pretty = prettyJsonEl.checked;
    const ct = (contentType || "").toLowerCase();
    const looksJson =
      ct.includes("json") || /^[\s\n]*[{[]/.test(text);
    if (pretty && looksJson) {
      try {
        const parsed = JSON.parse(text);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return text;
      }
    }
    return text;
  }

  function setResponseEmpty() {
    responseMetaEl.innerHTML = '<span class="pill muted">No response yet</span>';
    responseHeadersEl.textContent = "—";
    responseHeadersEl.classList.add("empty");
    responseBodyEl.textContent = "—";
    responseBodyEl.classList.add("empty");
    lastResponseBodyText = "";
    copyBtn.disabled = true;
  }

  function setMetaPills(parts) {
    responseMetaEl.innerHTML = parts
      .map((p) => `<span class="pill ${p.cls || "muted"}">${escapeHtml(p.text)}</span>`)
      .join("");
  }

  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setScannerStatus(text, isError) {
    if (!scannerStatusEl) return;
    scannerStatusEl.textContent = text;
    scannerStatusEl.classList.toggle("scanner-status-error", !!isError);
  }

  function scannerIsAnimeOrLive(row) {
    const c = String(row.category || "").toLowerCase();
    return c.startsWith("anime") || c.includes("live action");
  }

  function parseNyaaSizeToBytes(s) {
    const m = String(s)
      .trim()
      .match(/^([\d,.]+)\s*(TiB|GiB|MiB|KiB|B)\b/i);
    if (!m) return 0;
    const n = parseFloat(m[1].replace(/,/g, ""));
    if (Number.isNaN(n)) return 0;
    const u = m[2].toLowerCase();
    const mul = { b: 1, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 };
    return n * (mul[u] || 0);
  }

  function parseNyaaIntField(s) {
    const n = parseInt(String(s).replace(/,/g, ""), 10);
    return Number.isNaN(n) ? 0 : n;
  }

  function scannerSortValue(row, key) {
    switch (key) {
      case "prefix":
        return row.prefix == null ? "\uffff" : String(row.prefix).toLowerCase();
      case "title":
        return String(row.title || "").toLowerCase();
      case "category":
        return String(row.category || "").toLowerCase();
      case "quality": {
        if (!scannerIsAnimeOrLive(row)) return "\ufffe";
        return row.quality == null ? "\uffff" : String(row.quality).toLowerCase();
      }
      case "size":
        return parseNyaaSizeToBytes(row.size);
      case "date":
        return String(row.date || "");
      case "seeders":
        return parseNyaaIntField(row.seeders);
      case "leechers":
        return parseNyaaIntField(row.leechers);
      case "downloads":
        return parseNyaaIntField(row.downloads);
      default:
        return "";
    }
  }

  function compareScannerRows(a, b, key, dir) {
    const va = scannerSortValue(a, key);
    const vb = scannerSortValue(b, key);
    let cmp = 0;
    if (typeof va === "number" && typeof vb === "number") {
      if (va < vb) cmp = -1;
      else if (va > vb) cmp = 1;
    } else {
      if (va < vb) cmp = -1;
      else if (va > vb) cmp = 1;
    }
    if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
    const ta = String(a.title || "").toLowerCase();
    const tb = String(b.title || "").toLowerCase();
    if (ta < tb) return -1;
    if (ta > tb) return 1;
    return 0;
  }

  function getFilteredScannerRows() {
    let rows = scannerLastResults.slice();
    const pf = scannerPrefixEl ? scannerPrefixEl.value : "";
    if (pf === "__none__") rows = rows.filter((r) => !r.prefix);
    else if (pf) rows = rows.filter((r) => r.prefix === pf);

    const cf = scannerCategoryEl ? scannerCategoryEl.value : "";
    if (cf) rows = rows.filter((r) => String(r.category) === cf);

    const qf = scannerQualityEl ? scannerQualityEl.value : "";
    if (qf === "__no_quality__") {
      rows = rows.filter((r) => scannerIsAnimeOrLive(r) && !r.quality);
    } else if (qf) {
      rows = rows.filter((r) => String(r.quality) === qf);
    }
    return rows;
  }

  function rebuildScannerFilters(data) {
    const results = Array.isArray(data.results) ? data.results : [];
    const empty = results.length === 0;

    if (scannerPrefixEl) {
      scannerPrefixEl.innerHTML = '<option value="">All prefixes</option>';
      if (results.some((r) => !r.prefix)) {
        const o = document.createElement("option");
        o.value = "__none__";
        o.textContent = "Other (no leading tag)";
        scannerPrefixEl.appendChild(o);
      }
      (data.prefixes || []).forEach((p) => {
        const o = document.createElement("option");
        o.value = p;
        o.textContent = p;
        scannerPrefixEl.appendChild(o);
      });
      scannerPrefixEl.disabled = empty;
    }

    if (scannerCategoryEl) {
      scannerCategoryEl.innerHTML = '<option value="">All categories</option>';
      (data.categories || []).forEach((c) => {
        const o = document.createElement("option");
        o.value = c;
        o.textContent = c;
        scannerCategoryEl.appendChild(o);
      });
      scannerCategoryEl.disabled = empty;
    }

    if (scannerQualityEl) {
      scannerQualityEl.innerHTML = '<option value="">All qualities</option>';
      const needsUnknown = results.some((r) => scannerIsAnimeOrLive(r) && !r.quality);
      if (needsUnknown) {
        const o = document.createElement("option");
        o.value = "__no_quality__";
        o.textContent = "Unknown (anime / live, no tag)";
        scannerQualityEl.appendChild(o);
      }
      (data.qualities || []).forEach((q) => {
        const o = document.createElement("option");
        o.value = q;
        o.textContent = q;
        scannerQualityEl.appendChild(o);
      });
      scannerQualityEl.disabled = empty;
    }
  }

  function updateScannerSortHeaders() {
    const thead = scannerTableEl && scannerTableEl.querySelector("thead");
    if (!thead) return;
    thead.querySelectorAll("th[data-sort]").forEach((th) => {
      const k = th.getAttribute("data-sort");
      th.classList.remove("sorted-asc", "sorted-desc");
      th.removeAttribute("aria-sort");
      const ind = th.querySelector(".scanner-sort-ind");
      if (ind) ind.textContent = "";
      if (k && k === scannerSort.key) {
        th.classList.add(scannerSort.dir === "asc" ? "sorted-asc" : "sorted-desc");
        th.setAttribute("aria-sort", scannerSort.dir === "asc" ? "ascending" : "descending");
        if (ind) ind.textContent = scannerSort.dir === "asc" ? " \u2191" : " \u2193";
      }
    });
  }

  function renderScannerTable() {
    if (!scannerTbodyEl || !scannerPrefixEl) return;
    let rows = getFilteredScannerRows();
    rows.sort((a, b) => compareScannerRows(a, b, scannerSort.key, scannerSort.dir));

    const frag = document.createDocumentFragment();
    const prefixFilter = scannerPrefixEl.value;

    const appendGroupRow = (displayLabel, count) => {
      const tr = document.createElement("tr");
      tr.className = "scanner-group";
      const td = document.createElement("td");
      td.colSpan = 10;
      const tag = document.createElement("span");
      tag.className = "scanner-group-tag";
      tag.textContent = displayLabel;
      const cnt = document.createElement("span");
      cnt.className = "scanner-group-count";
      cnt.textContent = count + (count === 1 ? " result" : " results");
      td.appendChild(tag);
      td.appendChild(cnt);
      tr.appendChild(td);
      frag.appendChild(tr);
    };

    const appendDataRow = (row) => {
      const tr = document.createElement("tr");
      const tdPref = document.createElement("td");
      tdPref.className = row.prefix == null ? "prefix-cell muted" : "prefix-cell";
      tdPref.textContent = row.prefix == null ? "—" : String(row.prefix);

      const tdTitle = document.createElement("td");
      tdTitle.className = "title-cell";
      const a = document.createElement("a");
      a.href = row.view_url ? String(row.view_url) : "#";
      a.rel = "noopener noreferrer";
      a.textContent = String(row.title || "");
      tdTitle.appendChild(a);

      const tdCat = document.createElement("td");
      tdCat.className = "cat-cell";
      tdCat.textContent = String(row.category || "");

      const tdQual = document.createElement("td");
      tdQual.className = "quality-cell";
      if (scannerIsAnimeOrLive(row)) {
        tdQual.textContent = row.quality ? String(row.quality) : "—";
        if (!row.quality) tdQual.classList.add("muted");
      } else {
        tdQual.textContent = "—";
        tdQual.classList.add("muted");
      }

      const tdSize = document.createElement("td");
      tdSize.textContent = String(row.size || "");
      const tdDate = document.createElement("td");
      tdDate.textContent = String(row.date || "");

      const tdS = document.createElement("td");
      tdS.className = "num";
      tdS.textContent = String(row.seeders ?? "");
      const tdL = document.createElement("td");
      tdL.className = "num";
      tdL.textContent = String(row.leechers ?? "");
      const tdD = document.createElement("td");
      tdD.className = "num";
      tdD.textContent = String(row.downloads ?? "");

      const tdLinks = document.createElement("td");
      const wrap = document.createElement("div");
      wrap.className = "scanner-links";
      const addLink = (href, label) => {
        const l = document.createElement("a");
        l.href = href;
        l.rel = "noopener noreferrer";
        l.textContent = label;
        wrap.appendChild(l);
      };
      if (row.view_url) addLink(String(row.view_url), "Nyaa");
      if (row.torrent_url) addLink(String(row.torrent_url), ".torrent");
      if (row.magnet) addLink(String(row.magnet), "Magnet");
      tdLinks.appendChild(wrap);

      tr.appendChild(tdPref);
      tr.appendChild(tdTitle);
      tr.appendChild(tdCat);
      tr.appendChild(tdQual);
      tr.appendChild(tdSize);
      tr.appendChild(tdDate);
      tr.appendChild(tdS);
      tr.appendChild(tdL);
      tr.appendChild(tdD);
      tr.appendChild(tdLinks);
      frag.appendChild(tr);
    };

    if (!prefixFilter && rows.length) {
      const byPrefix = new Map();
      const keyOrder = [];
      for (const row of rows) {
        const key = row.prefix == null ? "__none__" : row.prefix;
        if (!byPrefix.has(key)) {
          byPrefix.set(key, []);
          keyOrder.push(key);
        }
        byPrefix.get(key).push(row);
      }
      for (const key of keyOrder) {
        const groupRows = byPrefix.get(key) || [];
        const label =
          key === "__none__" ? "Other (no leading [tag])" : "[" + key + "]";
        appendGroupRow(label, groupRows.length);
        groupRows.forEach(appendDataRow);
      }
    } else {
      rows.forEach(appendDataRow);
    }

    scannerTbodyEl.replaceChildren(frag);
    updateScannerSortHeaders();
  }

  async function runNyaaSearch() {
    if (!scannerSearchBtn || !scannerQueryEl || !scannerTbodyEl) return;
    if (backendSelectEl && backendSelectEl.value === BACKEND_CUSTOM_VALUE) {
      persistBackendFromUI();
      syncBackendUIFromStorage();
    }
    const q = scannerQueryEl.value.trim();
    scannerSearchBtn.disabled = true;
    setScannerStatus("Loading…", false);
    scannerTbodyEl.replaceChildren();
    try {
      const res = await fetch(apiUrl("/api/nyaa/search?q=" + encodeURIComponent(q)));
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = {};
      }
      if (!res.ok) {
        scannerLastResults = [];
        rebuildScannerFilters({
          results: [],
          prefixes: [],
          categories: [],
          qualities: [],
        });
        setScannerStatus(
          String(data.error || data.detail || "Request failed") +
            (res.status ? " (HTTP " + res.status + ")" : ""),
          true
        );
        renderScannerTable();
        return;
      }
      scannerSort = { key: "date", dir: "desc" };
      scannerLastResults = Array.isArray(data.results) ? data.results : [];
      const n = data.count != null ? data.count : scannerLastResults.length;
      let statusMsg =
        n + " result" + (n === 1 ? "" : "s") + " from Nyaa.";
      if (data.pages_fetched != null && data.pages_fetched > 1) {
        statusMsg += " Fetched " + data.pages_fetched + " listing pages.";
      }
      if (
        data.total_reported != null &&
        typeof data.total_reported === "number" &&
        n < data.total_reported
      ) {
        statusMsg +=
          " Nyaa reports " +
          data.total_reported +
          " total (showing " +
          n +
          "; increase backend page limit if needed).";
      }
      setScannerStatus(statusMsg, false);
      rebuildScannerFilters(data);
      if (scannerPrefixEl) scannerPrefixEl.value = "";
      if (scannerCategoryEl) scannerCategoryEl.value = "";
      if (scannerQualityEl) scannerQualityEl.value = "";
      renderScannerTable();
    } catch {
      scannerLastResults = [];
      rebuildScannerFilters({
        results: [],
        prefixes: [],
        categories: [],
        qualities: [],
      });
      setScannerStatus(
        "Could not reach " +
          getBackendBase() +
          ". Check the Backend drop-down in this tab and that the server is running (e.g. uvicorn backend.main:app).",
        true
      );
      renderScannerTable();
    } finally {
      scannerSearchBtn.disabled = false;
    }
  }

  async function sendRequest() {
    const method = methodEl.value;
    const queryPairs = parseKvRows(queryRowsEl);
    let finalUrl;
    try {
      finalUrl = buildUrlWithQuery(urlEl.value, queryPairs);
    } catch (e) {
      setMetaPills([{ text: String(e.message || e), cls: "err" }]);
      responseHeadersEl.textContent = "—";
      responseBodyEl.textContent = "—";
      return;
    }

    const headers = buildHeaders();
    /** @type {RequestInit} */
    const init = { method, headers, redirect: "follow" };

    if (METHODS_WITH_BODY.has(method)) {
      const raw = bodyEl.value;
      if (raw.trim()) {
        if (!headers.has("Content-Type")) {
          headers.set("Content-Type", "application/json; charset=utf-8");
        }
        init.body = raw;
      }
    }

    activeController = new AbortController();
    const signal = activeController.signal;
    init.signal = signal;

    sendBtn.disabled = true;
    cancelBtn.classList.remove("hidden");
    cancelBtn.disabled = false;
    setMetaPills([{ text: "Sending…", cls: "muted" }]);
    responseHeadersEl.textContent = "";
    responseBodyEl.textContent = "";
    responseHeadersEl.classList.remove("empty");
    responseBodyEl.classList.remove("empty");

    const started = performance.now();

    try {
      const res = await fetch(finalUrl, init);
      const ms = Math.round(performance.now() - started);
      const headerLines = [`${res.status} ${res.statusText}`, `Time: ${ms} ms`];
      res.headers.forEach((v, k) => headerLines.push(`${k}: ${v}`));
      responseHeadersEl.textContent = headerLines.join("\n");

      const ct = res.headers.get("Content-Type") || "";
      const buf = await res.arrayBuffer();
      const sizeStr = buf.byteLength < 1024 ? `${buf.byteLength} B` : `${(buf.byteLength / 1024).toFixed(1)} KB`;

      let text;
      try {
        text = new TextDecoder("utf-8").decode(buf);
      } catch {
        text = "[Binary body — UTF-8 decode failed]";
      }

      lastResponseBodyText = text;
      const display = formatBody(text, ct);
      responseBodyEl.textContent = display;

      const cls = statusClass(res.status);
      setMetaPills([
        { text: `${res.status} ${res.statusText}`, cls },
        { text: `${ms} ms` },
        { text: sizeStr },
      ]);
      copyBtn.disabled = !text;
    } catch (err) {
      const name = err && err.name;
      const msg =
        name === "AbortError"
          ? "Request cancelled."
          : err instanceof TypeError
            ? "Network or CORS error. The browser blocked the response, or the URL is unreachable."
            : String(err.message || err);
      setMetaPills([{ text: msg, cls: "err" }]);
      responseHeadersEl.textContent = "—";
      responseBodyEl.textContent = name === "AbortError" ? "" : "Tip: try a public CORS-friendly API (e.g. https://httpbin.org/get) or run your server with appropriate Access-Control-Allow-Origin headers.";
      lastResponseBodyText = responseBodyEl.textContent;
      copyBtn.disabled = !lastResponseBodyText;
    } finally {
      sendBtn.disabled = false;
      cancelBtn.classList.add("hidden");
      cancelBtn.disabled = true;
      activeController = null;
    }
  }

  function cancelRequest() {
    if (activeController) activeController.abort();
  }

  function saveState() {
    try {
      const state = {
        method: methodEl.value,
        url: urlEl.value,
        body: bodyEl.value,
        query: parseKvRows(queryRowsEl),
        headers: parseKvRows(headerRowsEl),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const state = JSON.parse(raw);
      if (state.method) methodEl.value = state.method;
      if (typeof state.url === "string") urlEl.value = state.url;
      if (typeof state.body === "string") bodyEl.value = state.body;
      queryRowsEl.innerHTML = "";
      (state.query || []).forEach((p) => addKvRow(queryRowsEl, p.key, p.value));
      if (!queryRowsEl.querySelector(".kv-row")) addKvRow(queryRowsEl);
      headerRowsEl.innerHTML = "";
      (state.headers || []).forEach((p) => addKvRow(headerRowsEl, p.key, p.value));
      if (!headerRowsEl.querySelector(".kv-row")) {
        addKvRow(headerRowsEl, "Accept", "application/json");
      }
    } catch {
      addKvRow(queryRowsEl);
      addKvRow(headerRowsEl, "Accept", "application/json");
    }
  }

  viewRestEl.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => setTab(tab.dataset.tab));
  });

  document.querySelectorAll("[data-app-tab]").forEach((btn) => {
    btn.addEventListener("click", () => setAppView(btn.dataset.appTab));
  });

  if (scannerSearchBtn) {
    scannerSearchBtn.addEventListener("click", () => runNyaaSearch());
  }
  if (scannerQueryEl) {
    scannerQueryEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        runNyaaSearch();
      }
    });
  }
  if (scannerPrefixEl) {
    scannerPrefixEl.addEventListener("change", () => renderScannerTable());
  }
  if (scannerCategoryEl) {
    scannerCategoryEl.addEventListener("change", () => renderScannerTable());
  }
  if (scannerQualityEl) {
    scannerQualityEl.addEventListener("change", () => renderScannerTable());
  }

  if (scannerTableEl) {
    const thead = scannerTableEl.querySelector("thead");
    if (thead) {
      thead.addEventListener("click", (e) => {
        const th = e.target && e.target.closest("th[data-sort]");
        if (!th) return;
        const key = th.getAttribute("data-sort");
        if (!key) return;
        if (scannerSort.key === key) {
          scannerSort.dir = scannerSort.dir === "asc" ? "desc" : "asc";
        } else {
          scannerSort.key = key;
          const descFirst = ["date", "size", "seeders", "leechers", "downloads"];
          scannerSort.dir = descFirst.includes(key) ? "desc" : "asc";
        }
        renderScannerTable();
      });
    }
  }

  updateScannerSortHeaders();

  if (backendSelectEl) {
    syncBackendUIFromStorage();
    backendSelectEl.addEventListener("change", () => onBackendSelectChange());
  }
  if (backendCustomEl) {
    backendCustomEl.addEventListener("blur", () => onBackendCustomCommit());
    backendCustomEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onBackendCustomCommit();
      }
    });
  }

  document.querySelectorAll("[data-add-row]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kind = btn.getAttribute("data-add-row");
      addKvRow(kind === "query" ? queryRowsEl : headerRowsEl);
    });
  });

  sendBtn.addEventListener("click", () => {
    saveState();
    sendRequest();
  });

  cancelBtn.addEventListener("click", cancelRequest);

  prettyJsonEl.addEventListener("change", () => {
    if (!lastResponseBodyText) return;
    const ct = "";
    responseBodyEl.textContent = formatBody(lastResponseBodyText, ct);
  });

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(responseBodyEl.textContent || "");
      const prev = copyBtn.textContent;
      copyBtn.textContent = "Copied";
      setTimeout(() => {
        copyBtn.textContent = prev;
      }, 1600);
    } catch {
      copyBtn.textContent = "Copy failed";
      setTimeout(() => {
        copyBtn.textContent = "Copy body";
      }, 1600);
    }
  });

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      if (viewRestEl.hidden) return;
      e.preventDefault();
      saveState();
      sendRequest();
    }
  });

  ["method", "url", "body"].forEach((id) => {
    document.getElementById(id).addEventListener("change", saveState);
  });

  queryRowsEl.addEventListener("input", saveState);
  headerRowsEl.addEventListener("input", saveState);

  addKvRow(queryRowsEl);
  loadState();
  if (!headerRowsEl.querySelector(".kv-row")) addKvRow(headerRowsEl, "Accept", "application/json");
  setResponseEmpty();
})();
