(function () {
  const SOURCE_URL = "https://whirlpool.observer/";
  const SUMMARY_URL = `${SOURCE_URL}api/summary`;
  const CHARTS_URL = `${SOURCE_URL}api/charts`;

  const POOL_ORDER = ["0.025_BTC_Pool", "0.25_BTC_Pool"];
  const POOL_COLORS = {
    "0.025_BTC_Pool": "#8e8e93",
    "0.25_BTC_Pool": "#448aff",
  };

  const CHART_COPY = {
    poolsize: {
      title: "Total Poolsize",
      description: "Unmixed premix BTC plus unspent Whirlpool postmix BTC. This shows the active bitcoin currently sitting in Whirlpool pools.",
      yLabel: "BTC",
      mode: "btc",
    },
    postmix: {
      title: "Unspent Whirlpool Postmix",
      description: "Tracked Whirlpool postmix outputs that have completed at least one CoinJoin and remain unspent in their pool denomination.",
      yLabel: "BTC",
      mode: "btc",
    },
    premix: {
      title: "Unmixed Premix",
      description: "TX0 premix outputs that are still unspent and waiting to enter their first Whirlpool CoinJoin cycle.",
      yLabel: "BTC",
      mode: "btc",
    },
    "utxos-in-pool": {
      title: "Total UTXOs in Whirlpool",
      description: "Unmixed premix UTXOs plus unspent Whirlpool postmix UTXOs.",
      yLabel: "UTXOs",
      mode: "integer",
    },
    "unspent-utxos": {
      title: "Unspent Postmix UTXOs",
      description: "Tracked Whirlpool postmix UTXOs that have completed CoinJoin and have not yet been spent.",
      yLabel: "UTXOs",
      mode: "integer",
    },
  };

  let sharedSummaryRequest = null;
  let sharedChartsRequest = null;

  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const parseNumber = (value) => Number(String(value || "").replace(/,/g, "").replace(/\s*BTC$/i, ""));
  const finite = (value) => Number.isFinite(Number(value));
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  const formatNumber = (value, maximumFractionDigits = 4) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    return number.toLocaleString(undefined, { maximumFractionDigits });
  };

  const formatBtcNumber = (value) => `${formatNumber(value, 4)} BTC`;

  const formatInteger = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    return number.toLocaleString(undefined, { maximumFractionDigits: 0 });
  };

  const formatCompact = (value, mode) => {
    if (mode === "integer") return formatInteger(value);
    return formatNumber(value, 3);
  };

  const formatSeconds = (seconds) => {
    if (!Number.isFinite(Number(seconds))) return "—";
    const value = Math.max(0, Number(seconds));
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const secs = Math.floor(value % 60);
    if (hours) return `${hours}h ${minutes}m`;
    if (minutes) return `${minutes}m ${secs}s`;
    return `${secs}s`;
  };

  const fetchJson = async (url) => {
    const response = await fetch(url, { method: "GET", cache: "no-store", mode: "cors" });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return response.json();
  };

  const fetchText = async (url) => {
    const response = await fetch(url, { method: "GET", cache: "no-store", mode: "cors" });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return response.text();
  };

  const poolKeyFromLabel = (label) => {
    const text = normalize(label);
    if (text.includes("0.25")) return "0.25_BTC_Pool";
    if (text.includes("0.025")) return "0.025_BTC_Pool";
    return text.replace(/\s+/g, "_");
  };

  const poolLabel = (pool) => normalize(pool?.label || String(pool?.pool || "").replace(/_/g, " "));

  const emptyPool = (pool, label) => ({
    pool,
    label,
    color: POOL_COLORS[pool] || "#7c4dff",
    poolsize_btc: 0,
    unspent_btc: 0,
    unspent_utxos: 0,
    unmixed_btc: 0,
    unmixed_utxos: 0,
    utxos_in_pool: 0,
    cycles: 0,
    tx0s: 0,
    exited_utxos: 0,
  });

  const normalizePool = (pool) => {
    const key = poolKeyFromLabel(pool?.pool || pool?.label);
    return {
      ...emptyPool(key, poolLabel(pool)),
      ...pool,
      pool: key,
      label: poolLabel(pool),
      color: pool?.color || POOL_COLORS[key] || "#7c4dff",
      poolsize_btc: Number(pool?.poolsize_btc || 0),
      unspent_btc: Number(pool?.unspent_btc || 0),
      unspent_utxos: Number(pool?.unspent_utxos || 0),
      unmixed_btc: Number(pool?.unmixed_btc || 0),
      unmixed_utxos: Number(pool?.unmixed_utxos || 0),
      utxos_in_pool: Number(pool?.utxos_in_pool || 0),
      cycles: Number(pool?.cycles || 0),
      tx0s: Number(pool?.tx0s ?? pool?.tx0_count ?? 0),
      exited_utxos: Number(pool?.exited_utxos ?? pool?.exited_count ?? 0),
    };
  };

  const normalizeSummary = (summary) => {
    const pools = (summary?.pools || []).map(normalizePool).sort((a, b) => {
      const ai = POOL_ORDER.indexOf(a.pool);
      const bi = POOL_ORDER.indexOf(b.pool);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    const totals = pools.reduce((acc, pool) => {
      acc.poolsize_btc += pool.poolsize_btc;
      acc.unspent_btc += pool.unspent_btc;
      acc.unspent_utxos += pool.unspent_utxos;
      acc.unmixed_btc += pool.unmixed_btc;
      acc.unmixed_utxos += pool.unmixed_utxos;
      acc.utxos_in_pool += pool.utxos_in_pool;
      acc.cycles += pool.cycles;
      acc.tx0s += pool.tx0s;
      acc.exited_utxos += pool.exited_utxos;
      return acc;
    }, {
      poolsize_btc: 0,
      unspent_btc: 0,
      unspent_utxos: 0,
      unmixed_btc: 0,
      unmixed_utxos: 0,
      utxos_in_pool: 0,
      cycles: 0,
      tx0s: 0,
      exited_utxos: 0,
    });

    return {
      ...summary,
      pools,
      totals,
      source: "api",
    };
  };

  const parseObserverHtml = (html) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const cardTexts = [...doc.querySelectorAll(".grid.cards > .card")].map((card) => ({
      label: normalize(card.querySelector(".label")?.textContent),
      value: normalize(card.querySelector(".value")?.textContent),
    }));

    const totalPoolsize = parseNumber(cardTexts.find((card) => /Total BTC in Whirlpool/i.test(card.label))?.value);
    const progressCard = cardTexts.find((card) => /Synced|Sync progress/i.test(card.label));

    const pools = [...doc.querySelectorAll("#poolCards > .card")].map((card) => {
      const label = normalize(card.querySelector(".label")?.textContent);
      const pool = poolKeyFromLabel(label);
      const metrics = [...card.querySelectorAll(".metric")].reduce((acc, metric) => {
        const metricLabel = normalize(metric.querySelector(".label")?.textContent);
        const metricValue = normalize(metric.querySelector(".n")?.textContent);
        acc[metricLabel] = metricValue;
        return acc;
      }, {});

      return normalizePool({
        pool,
        label: label.replace(/^\s*/, ""),
        color: POOL_COLORS[pool],
        poolsize_btc: parseNumber(card.querySelector(".value")?.textContent),
        utxos_in_pool: parseNumber(metrics["UTXOs in pool"]),
        unspent_btc: parseNumber(metrics.Unspent),
        unmixed_btc: parseNumber(metrics.Unmixed),
        cycles: parseNumber(metrics.Cycles),
        tx0s: parseNumber(metrics.TX0s),
        exited_utxos: parseNumber(metrics["Exited UTXOs"]),
      });
    });

    if (!pools.length || !Number.isFinite(totalPoolsize)) {
      throw new Error("Could not parse whirlpool.observer HTML");
    }

    return normalizeSummary({
      pools,
      is_synced: /Synced/i.test(progressCard?.label || ""),
      last_processed_block: parseNumber(String(progressCard?.value || "").replace(/Blockheight/i, "")),
      next_update_seconds: null,
      source: "html",
    });
  };

  const getSummary = () => {
    if (!sharedSummaryRequest) {
      sharedSummaryRequest = fetchJson(SUMMARY_URL)
        .then(normalizeSummary)
        .catch(async (apiError) => {
          console.warn("Whirlpool stats API fetch failed, trying HTML fallback:", apiError);
          const html = await fetchText(SOURCE_URL);
          return parseObserverHtml(html);
        })
        .finally(() => {
          sharedSummaryRequest = null;
        });
    }
    return sharedSummaryRequest;
  };

  const getCharts = () => {
    if (!sharedChartsRequest) {
      sharedChartsRequest = fetchJson(CHARTS_URL).finally(() => {
        sharedChartsRequest = null;
      });
    }
    return sharedChartsRequest;
  };

  const setText = (root, selector, value) => {
    const element = root.querySelector(selector);
    if (element) element.textContent = value || "—";
  };

  const overviewMarkup = (compact) => `
    <div class="whirlpool-stats-error" data-whirlpool-error hidden>
      Stats couldn't be fetched from <a href="${SOURCE_URL}">whirlpool.observer</a>. Please reload. If the problem persists, open an issue at <a href="https://github.com/vibrant-btc/bitcoinprivacy-wiki/issues">github.com/vibrant-btc/bitcoinprivacy-wiki/issues</a>.
    </div>

    <div class="whirlpool-stats-content" data-whirlpool-content hidden>
      <section class="whirlpool-section" aria-label="Ashigaru Whirlpool pool overview">
        <div class="whirlpool-topline">
          <span>Status: <span data-whirlpool-sync-status>Loading...</span></span>
          <span class="whirlpool-updated" data-whirlpool-last-updated>Fetching Whirlpool.Observer stats...</span>
        </div>

        <div class="whirlpool-section-heading">
          <div class="whirlpool-heading-copy">
            <p class="whirlpool-kicker">Ashigaru Whirlpool</p>
            <h2>
              <span class="whirlpool-title-desktop">Live pool overview</span>
              <span class="whirlpool-title-mobile">Whirlpool Stats</span>
            </h2>
          </div>
          <div class="whirlpool-total-inline">
            <span>Total BTC in Whirlpool</span>
            <strong data-whirlpool-total-poolsize>—</strong>
          </div>
        </div>

        <div class="whirlpool-summary-grid">
          <div class="whirlpool-summary-card">
            <span>Total unspent postmix</span>
            <strong data-whirlpool-total-postmix>—</strong>
          </div>
          <div class="whirlpool-summary-card">
            <span>Total unmixed premix</span>
            <strong data-whirlpool-total-unmixed>—</strong>
          </div>
          <div class="whirlpool-summary-card">
            <span>Total pool UTXOs</span>
            <strong data-whirlpool-total-utxos>—</strong>
          </div>
          <div class="whirlpool-summary-card">
            <span>Total CoinJoin cycles</span>
            <strong data-whirlpool-total-cycles>—</strong>
          </div>
        </div>

        <div class="whirlpool-pool-overview-grid" data-whirlpool-pool-rows></div>
      </section>

      ${compact ? "" : `<p class="whirlpool-footer">Source: <a href="${SOURCE_URL}">Whirlpool.Observer</a>.</p>`}
    </div>
  `;

  const ensureOverviewMarkup = (root) => {
    if (root.querySelector("[data-whirlpool-content]") || root.querySelector("[data-whirlpool-error]")) return;
    root.classList.add("whirlpool-stats-widget");
    if (root.dataset.whirlpoolCompact === "true") root.classList.add("whirlpool-stats-widget--compact");
    root.innerHTML = overviewMarkup(root.dataset.whirlpoolCompact === "true");
  };

  const renderPoolRows = (root, state) => {
    const container = root.querySelector("[data-whirlpool-pool-rows]");
    if (!container) return;
    container.innerHTML = state.pools.map((pool) => `
      <article class="whirlpool-pool-card" data-pool="${pool.pool}">
        <div class="whirlpool-pool-card-heading">
          <span class="whirlpool-pool-name"><span class="whirlpool-swatch" style="background:${pool.color}"></span>${pool.label.replace(/\s+Pool$/i, "")}</span>
          <strong>${formatBtcNumber(pool.poolsize_btc)}</strong>
        </div>
        <div class="whirlpool-pool-stat-grid">
          <div><span>Unspent Postmix</span><strong>${formatBtcNumber(pool.unspent_btc)}</strong></div>
          <div><span>Unmixed Premix</span><strong>${formatBtcNumber(pool.unmixed_btc)}</strong></div>
          <div><span>Pool UTXOs</span><strong>${formatInteger(pool.utxos_in_pool)}</strong></div>
          <div><span>CoinJoin Cycles</span><strong>${formatInteger(pool.cycles)}</strong></div>
          <div><span>TX0s Detected</span><strong>${formatInteger(pool.tx0s)}</strong></div>
          <div><span>Exited Premix</span><strong>${formatInteger(pool.exited_utxos)}</strong></div>
        </div>
      </article>
    `).join("");
  };

  const renderOverview = (root, state) => {
    setText(root, "[data-whirlpool-total-poolsize]", formatBtcNumber(state.totals.poolsize_btc));
    setText(root, "[data-whirlpool-total-postmix]", formatBtcNumber(state.totals.unspent_btc));
    setText(root, "[data-whirlpool-total-unmixed]", formatBtcNumber(state.totals.unmixed_btc));
    setText(root, "[data-whirlpool-total-utxos]", formatInteger(state.totals.utxos_in_pool));
    setText(root, "[data-whirlpool-total-cycles]", formatInteger(state.totals.cycles));

    const syncedText = state.is_synced === false
      ? `Syncing ${Number(state.progress_pct || 0).toFixed(2)}%`
      : `Synced at block ${formatInteger(state.last_processed_block)}`;
    const updatedText = state.next_update_seconds == null
      ? "Live data from Whirlpool.Observer"
      : `Next update in ${formatSeconds(state.next_update_seconds)}`;
    setText(root, "[data-whirlpool-sync-status]", syncedText);
    setText(root, "[data-whirlpool-last-updated]", updatedText);

    renderPoolRows(root, state);

    const errorBox = root.querySelector("[data-whirlpool-error]");
    const content = root.querySelector("[data-whirlpool-content]");
    if (errorBox) errorBox.hidden = true;
    if (content) content.hidden = false;
  };

  const failWidget = (root) => {
    const content = root.querySelector("[data-whirlpool-content], [data-whirlpool-chart-content]");
    const errorBox = root.querySelector("[data-whirlpool-error]");
    if (content) content.hidden = true;
    if (errorBox) errorBox.hidden = false;
  };

  const chartMarkup = (type) => {
    const copy = CHART_COPY[type] || CHART_COPY.poolsize;
    return `
      <div class="whirlpool-stats-error" data-whirlpool-error hidden>
        Chart data couldn't be fetched from <a href="${SOURCE_URL}">whirlpool.observer</a>. Please reload.
      </div>
      <section class="whirlpool-detail-chart" data-whirlpool-chart-content hidden aria-label="${copy.title}">
        <div class="whirlpool-detail-chart-heading">
          <div>
            <p class="whirlpool-kicker">Whirlpool.Observer</p>
            <h2>${copy.title}</h2>
            <p>${copy.description}</p>
          </div>
          <div class="whirlpool-chart-latest" data-whirlpool-chart-latest>—</div>
        </div>
        <div class="whirlpool-chart-svg-wrap">
          <svg class="whirlpool-detail-svg" viewBox="0 0 760 360" role="img" aria-label="${copy.title} chart">
            <g class="whirlpool-chart-grid-lines" data-whirlpool-grid-lines></g>
            <g class="whirlpool-chart-y-axis" data-whirlpool-y-axis></g>
            <g class="whirlpool-chart-x-axis" data-whirlpool-x-axis></g>
            <g data-whirlpool-series></g>
            <g class="whirlpool-hover-layer" data-whirlpool-hover-layer hidden>
              <line data-whirlpool-hover-line y1="24" y2="284"></line>
            </g>
            <rect class="whirlpool-hover-capture" data-whirlpool-hover-capture x="72" y="24" width="662" height="260"></rect>
          </svg>
        </div>
        <div class="whirlpool-chart-hover-detail" data-whirlpool-hover-detail>Hover the chart for exact block values.</div>
        <div class="whirlpool-chart-legend" data-whirlpool-chart-legend></div>
      </section>
    `;
  };

  const ensureChartMarkup = (root) => {
    if (root.querySelector("[data-whirlpool-chart-content]") || root.querySelector("[data-whirlpool-error]")) return;
    root.classList.add("whirlpool-chart-widget");
    root.innerHTML = chartMarkup(root.dataset.whirlpoolChartWidget || "poolsize");
  };

  const pointsToPath = (points) => points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");

  const valueAtBlock = (blocks, values, block) => {
    let current = 0;
    for (let index = 0; index < blocks.length; index += 1) {
      if (Number(blocks[index]) > block) break;
      if (finite(values[index])) current = Number(values[index]);
    }
    return current;
  };

  const buildPoolSeries = (charts, type) => {
    const poolsize = charts.poolsize || { blocks: [], series: {} };
    const postmix = charts.capacity || { blocks: [], series: {} };

    if (type === "poolsize") return { blocks: poolsize.blocks || [], series: poolsize.series || {}, mode: "btc" };
    if (type === "postmix") return { blocks: postmix.blocks || [], series: postmix.series || {}, mode: "btc" };

    if (type === "premix") {
      const blocks = [...new Set([...(poolsize.blocks || []), ...(postmix.blocks || [])])].map(Number).filter(Number.isFinite).sort((a, b) => a - b);
      const series = {};
      POOL_ORDER.forEach((pool) => {
        const poolsizeValues = poolsize.series?.[pool] || [];
        const postmixValues = postmix.series?.[pool] || [];
        series[pool] = blocks.map((block) => Math.max(0, valueAtBlock(poolsize.blocks || [], poolsizeValues, block) - valueAtBlock(postmix.blocks || [], postmixValues, block)));
      });
      return { blocks, series, mode: "btc" };
    }

    if (type === "utxos-in-pool") {
      return { blocks: charts.utxos_in_pool?.blocks || [], total: charts.utxos_in_pool?.total_utxos || [], mode: "integer" };
    }

    return { blocks: charts.utxos?.blocks || [], total: charts.utxos?.total_utxos || [], mode: "integer" };
  };

  const niceStep = (range, targetTicks = 5) => {
    if (!Number.isFinite(range) || range <= 0) return 1;
    const rough = range / targetTicks;
    const power = Math.pow(10, Math.floor(Math.log10(rough)));
    const fraction = rough / power;
    if (fraction <= 1) return power;
    if (fraction <= 2) return 2 * power;
    if (fraction <= 5) return 5 * power;
    return 10 * power;
  };

  const axisBounds = (values, mode) => {
    const rawMax = Math.max(...values.filter(Number.isFinite), 1);
    const step = mode === "integer" ? Math.max(1, Math.ceil(niceStep(rawMax, 5))) : niceStep(rawMax, 5);
    const max = Math.ceil(rawMax / step) * step;
    return { min: 0, max, step };
  };

  const renderAxis = (root, blocks, maxValue, minValue, mode, bounds, yStep) => {
    const grid = root.querySelector("[data-whirlpool-grid-lines]");
    const yAxis = root.querySelector("[data-whirlpool-y-axis]");
    const xAxis = root.querySelector("[data-whirlpool-x-axis]");
    if (!grid || !yAxis || !xAxis) return;

    grid.innerHTML = "";
    yAxis.innerHTML = "";
    xAxis.innerHTML = "";

    for (let value = minValue; value <= maxValue + (yStep / 2); value += yStep) {
      const y = bounds.top + bounds.height - ((value - minValue) / Math.max(maxValue - minValue, 1)) * bounds.height;
      grid.insertAdjacentHTML("beforeend", `<line x1="${bounds.left}" y1="${y}" x2="${bounds.left + bounds.width}" y2="${y}"></line>`);
      yAxis.insertAdjacentHTML("beforeend", `<text x="${bounds.left - 10}" y="${y + 4}">${formatCompact(value, mode)}</text>`);
    }

    const firstBlock = blocks[0];
    const lastBlock = blocks[blocks.length - 1];
    const blockRange = Math.max(lastBlock - firstBlock, 1);
    const blockStep = Math.max(1, Math.ceil(niceStep(blockRange, 4)));
    const firstTick = Math.ceil(firstBlock / blockStep) * blockStep;
    const ticks = [firstBlock];
    for (let block = firstTick; block < lastBlock; block += blockStep) {
      if (block > firstBlock) ticks.push(block);
    }
    ticks.push(lastBlock);

    [...new Set(ticks)].filter(finite).forEach((block) => {
      const x = bounds.left + ((Number(block) - firstBlock) / blockRange) * bounds.width;
      xAxis.insertAdjacentHTML("beforeend", `<text x="${x}" y="${bounds.top + bounds.height + 28}">${formatInteger(block)}</text>`);
    });
  };

  const renderChart = (root, charts) => {
    const type = root.dataset.whirlpoolChartWidget || "poolsize";
    const copy = CHART_COPY[type] || CHART_COPY.poolsize;
    const data = buildPoolSeries(charts, type);
    const bounds = { left: 72, top: 24, width: 662, height: 260 };
    const seriesRoot = root.querySelector("[data-whirlpool-series]");
    const legend = root.querySelector("[data-whirlpool-chart-legend]");
    const latest = root.querySelector("[data-whirlpool-chart-latest]");
    const content = root.querySelector("[data-whirlpool-chart-content]");
    const errorBox = root.querySelector("[data-whirlpool-error]");
    if (!seriesRoot || !legend || !latest) return;

    const blocks = (data.blocks || []).map(Number).filter(Number.isFinite);
    if (blocks.length < 2) throw new Error(`Not enough ${type} chart points`);

    const chartSeries = data.total
      ? [{ key: "total", label: copy.title, color: "#448aff", values: data.total.map(Number) }]
      : POOL_ORDER.map((pool) => ({
        key: pool,
        label: String(pool).replace(/_/g, " ").replace(/ Pool$/i, ""),
        color: POOL_COLORS[pool],
        values: (data.series?.[pool] || []).map(Number),
      }));

    const mode = data.mode || copy.mode;
    const values = chartSeries.flatMap((series) => series.values).filter(Number.isFinite);
    const axis = axisBounds(values, mode);
    const maxValue = axis.max;
    const minValue = axis.min;
    const firstBlock = blocks[0];
    const lastBlock = blocks[blocks.length - 1];
    const blockSpan = Math.max(lastBlock - firstBlock, 1);
    const valueSpan = Math.max(maxValue - minValue, 1);

    renderAxis(root, blocks, maxValue, minValue, mode, bounds, axis.step);

    seriesRoot.innerHTML = chartSeries.map((series) => {
      const points = blocks.map((block, index) => {
        const value = finite(series.values[index]) ? Number(series.values[index]) : 0;
        return {
          x: bounds.left + ((block - firstBlock) / blockSpan) * bounds.width,
          y: bounds.top + bounds.height - ((value - minValue) / valueSpan) * bounds.height,
        };
      });
      const latestValue = [...series.values].reverse().find(finite) || 0;
      return `<path class="whirlpool-detail-path" data-series-key="${series.key}" d="${pointsToPath(points)}" style="stroke:${series.color}"><title>${series.label}: ${formatCompact(latestValue, mode)} ${copy.yLabel}</title></path>`;
    }).join("");

    const updateLatest = () => {
      const enabledKeys = [...root.querySelectorAll("[data-chart-series-toggle][aria-pressed='true']")].map((button) => button.dataset.chartSeriesToggle);
      const activeSeries = chartSeries.filter((series) => enabledKeys.includes(series.key));
      const latestTotal = activeSeries.reduce((sum, series) => {
        const latestValue = [...series.values].reverse().find(finite) || 0;
        return sum + Number(latestValue);
      }, 0);
      latest.textContent = `Latest: ${formatCompact(latestTotal, mode)} ${copy.yLabel}`;
    };

    legend.innerHTML = chartSeries.map((series) => `
      <button type="button" class="whirlpool-chart-toggle" data-chart-series-toggle="${series.key}" aria-pressed="true">
        <span class="whirlpool-swatch" style="background:${series.color}"></span>${series.label}
      </button>
    `).join("");

    legend.querySelectorAll("[data-chart-series-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const nextPressed = button.getAttribute("aria-pressed") !== "true";
        const pressedButtons = [...legend.querySelectorAll("[data-chart-series-toggle][aria-pressed='true']")];
        if (!nextPressed && pressedButtons.length === 1) return;
        button.setAttribute("aria-pressed", String(nextPressed));
        const path = root.querySelector(`[data-series-key='${button.dataset.chartSeriesToggle}']`);
        if (path) path.hidden = !nextPressed;
        updateLatest();
      });
    });

    updateLatest();

    const hoverLayer = root.querySelector("[data-whirlpool-hover-layer]");
    const hoverLine = root.querySelector("[data-whirlpool-hover-line]");
    const hoverCapture = root.querySelector("[data-whirlpool-hover-capture]");
    const hoverDetail = root.querySelector("[data-whirlpool-hover-detail]");

    if (hoverLayer && hoverLine && hoverCapture && hoverDetail) {
      hoverCapture.setAttribute("x", String(bounds.left));
      hoverCapture.setAttribute("y", String(bounds.top));
      hoverCapture.setAttribute("width", String(bounds.width));
      hoverCapture.setAttribute("height", String(bounds.height));
      hoverLine.setAttribute("y1", String(bounds.top));
      hoverLine.setAttribute("y2", String(bounds.top + bounds.height));

      const updateHover = (event) => {
        const point = hoverCapture.ownerSVGElement.createSVGPoint();
        point.x = event.clientX;
        point.y = event.clientY;
        const svgPoint = point.matrixTransform(hoverCapture.ownerSVGElement.getScreenCTM().inverse());
        const ratio = clamp((svgPoint.x - bounds.left) / bounds.width, 0, 1);
        const targetBlock = firstBlock + ratio * blockSpan;
        let nearestIndex = 0;
        blocks.forEach((block, index) => {
          if (Math.abs(block - targetBlock) < Math.abs(blocks[nearestIndex] - targetBlock)) nearestIndex = index;
        });
        const x = bounds.left + ((blocks[nearestIndex] - firstBlock) / blockSpan) * bounds.width;
        hoverLine.setAttribute("x1", String(x));
        hoverLine.setAttribute("x2", String(x));
        hoverLayer.hidden = false;
        const enabledKeys = [...root.querySelectorAll("[data-chart-series-toggle][aria-pressed='true']")].map((button) => button.dataset.chartSeriesToggle);
        const details = chartSeries
          .filter((series) => enabledKeys.includes(series.key))
          .map((series) => `${series.label}: ${formatCompact(series.values[nearestIndex], mode)} ${copy.yLabel}`)
          .join(" · ");
        hoverDetail.textContent = `Block ${formatInteger(blocks[nearestIndex])} · ${details}`;
      };

      hoverCapture.addEventListener("pointermove", updateHover);
      hoverCapture.addEventListener("pointerleave", () => {
        hoverLayer.hidden = true;
        hoverDetail.textContent = "Hover the chart for exact block values.";
      });
    }

    if (errorBox) errorBox.hidden = true;
    if (content) content.hidden = false;
  };

  const initWhirlpoolStats = async () => {
    const widgets = [...document.querySelectorAll("[data-whirlpool-stats-widget]")]
      .filter((widget) => widget.dataset.initialized !== "true");
    const chartWidgets = [...document.querySelectorAll("[data-whirlpool-chart-widget]")]
      .filter((widget) => widget.dataset.initialized !== "true");

    widgets.forEach((widget) => {
      widget.dataset.initialized = "true";
      ensureOverviewMarkup(widget);
    });

    chartWidgets.forEach((widget) => {
      widget.dataset.initialized = "true";
      ensureChartMarkup(widget);
    });

    if (widgets.length) {
      try {
        const summary = await getSummary();
        widgets.forEach((widget) => renderOverview(widget, summary));
      } catch (error) {
        console.warn("Whirlpool stats widget failed:", error);
        widgets.forEach(failWidget);
      }
    }

    if (chartWidgets.length) {
      try {
        const charts = await getCharts();
        chartWidgets.forEach((widget) => renderChart(widget, charts));
      } catch (error) {
        console.warn("Whirlpool chart widget failed:", error);
        chartWidgets.forEach(failWidget);
      }
    }
  };

  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(initWhirlpoolStats);
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initWhirlpoolStats);
  } else {
    initWhirlpoolStats();
  }
})();
