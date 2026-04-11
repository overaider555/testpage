(function () {
  "use strict";

  const STORAGE_KEY = "api-console-state-v1";

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

  /** @type {AbortController | null} */
  let activeController = null;
  /** @type {string} */
  let lastResponseBodyText = "";

  const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH", "DELETE"]);

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
    document.querySelectorAll(".tab").forEach((t) => {
      const active = t.dataset.tab === name;
      t.classList.toggle("active", active);
      t.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.querySelectorAll(".tab-panel").forEach((p) => {
      const id = p.id.replace("panel-", "");
      const show = id === name;
      p.toggleAttribute("hidden", !show);
      p.classList.toggle("active", show);
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

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => setTab(tab.dataset.tab));
  });

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
