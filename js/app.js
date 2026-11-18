(() => {
  "use strict";

  const byId = id => document.getElementById(id);
  const { colors, number } = Charts;
  const buttons = [...document.querySelectorAll("[data-regime]")];
  const initial = { a: 1, c: 1.5, height: 2.5, regime: "finite" };
  const config = { ...initial };
  const plots = ["potential", "bands", "gaps"].map(byId);
  let result;
  let timer;
  let frame;
  const runner = Charts.scheduler(receive, message => status(message, true));

  function status(message, error = false) {
    const element = byId("status");
    element.textContent = message;
    element.classList.toggle("error", error);
  }

  function renderControls() {
    for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.regime === config.regime));
    byId("c").min = (config.a + 0.1).toFixed(2);
    byId("a").value = config.a;
    byId("c").value = config.c;
    byId("height").value = config.height;
    byId("height").disabled = config.regime !== "finite";
    byId("a-value").textContent = number(config.a) + " нм";
    byId("c-value").textContent = number(config.c) + " нм";
    byId("height-value").textContent = config.regime === "isolated"
      ? "∞" : number(config.regime === "free" ? 0 : config.height) + " эВ";
  }

  function requestSolve() {
    runner.invalidate();
    clearTimeout(timer);
    status("Выполняется расчёт…");
    timer = setTimeout(() => runner.run({ ...config }), 55);
  }

  function renderRows(id, values) {
    const rows = values.map(cells => {
      const tr = document.createElement("tr");
      for (const value of cells) {
        const td = document.createElement("td");
        td.textContent = value;
        tr.append(td);
      }
      return tr;
    });
    byId(id).replaceChildren(...rows);
  }

  function receive(data) {
    result = { ...data, config: { ...config } };
    status(config.regime === "free"
      ? "Свободный электрон · все щели закрыты."
      : config.regime === "isolated"
        ? "Изолированная яма · ширина каждой зоны равна нулю."
        : "Готово · показаны первые пять энергетических зон.");
    renderRows("band-values", data.edges.map(({ min, max }, i) => [
      i + 1, number(min, 5), number(max, 5), number(max - min, 5),
      i < data.gaps.length ? number(data.gaps[i], 5) : "—",
    ]));
    byId("grid-check").hidden = !data.gridComparison.length;
    renderRows("grid-values", data.gridComparison.map(({ intervals, firstGap, maxError }) => [
      intervals, number(firstGap, 9), number(maxError, 9),
    ]));
    redraw();
  }

  function redraw() {
    if (!frame) frame = requestAnimationFrame(draw);
  }

  function draw() {
    frame = undefined;
    if (!result) return;
    const { a, c, height, regime } = result.config;
    const isolated = regime === "isolated";
    const displayHeight = isolated ? 1 : regime === "free" ? 0 : height;
    const profile = [];
    const zones = [];
    for (let n = -1; n <= 1; n++) {
      const start = n * c;
      const edge = start + a;
      profile.push([start, 0], [edge, 0], [edge, displayHeight], [(n + 1) * c, displayHeight]);
      if (isolated) zones.push({ axis: "x", from: edge, to: (n + 1) * c, fill: "#d9e4f4" });
    }
    profile.push([2 * c, 0]);
    byId("cell-info").textContent = "a = " + number(a) + " нм · c − a = " + number(c - a) + " нм";
    Charts.plot(plots[0], {
      xDomain: [-c, 2 * c], yDomain: [0, Math.max(1, displayHeight * 1.18)],
      xLabel: "x, нм", yLabel: isolated ? "V (условно)" : "V, эВ",
      xTicks: [-c, 0, c, 2 * c], yTicks: isolated ? [0] : displayHeight > 0 ? [0, displayHeight / 2, displayHeight] : [0],
      zones, series: [{ points: profile, color: colors[1] }],
      guides: [{ axis: "x", value: 0 }, { axis: "x", value: c }],
    });
    const bands = result.bands.map((points, i) => ({ points, color: colors[i] }));
    const gapZones = result.edges.slice(1).map(({ min }, i) => ({
      axis: "y", from: result.edges[i].max, to: min, fill: "#e9f0fb",
    })).filter(zone => zone.to - zone.from > 1e-9);
    Charts.plot(plots[1], {
      xDomain: [-1, 1], yDomain: Charts.limits(bands), xTicks: [-1, -0.5, 0, 0.5, 1],
      xLabel: "kc/π", yLabel: "E, эВ", series: bands, zones: gapZones,
      guides: [{ axis: "x", value: 0 }],
    });
    const gapCurves = [0, 1, 2].map(i => ({
      points: result.sweep.map(([u, gaps]) => [u, gaps[i]]), color: colors[i],
    }));
    Charts.plot(plots[2], {
      xDomain: [0, result.maxHeight], yDomain: Charts.limits(gapCurves),
      xLabel: "U, эВ", yLabel: "ΔE, эВ", series: gapCurves,
      guides: isolated ? [] : [{ axis: "x", value: displayHeight }],
    });
  }

  for (const [i, color] of colors.slice(0, 3).entries()) {
    const label = document.createElement("span");
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.setProperty("--curve", color);
    label.append(swatch, "ΔE" + ["₁", "₂", "₃"][i]);
    byId("gap-legend").append(label);
  }
  for (const button of buttons) {
    button.addEventListener("click", () => {
      config.regime = button.dataset.regime;
      renderControls();
      requestSolve();
    });
  }
  for (const id of ["a", "c", "height"]) {
    byId(id).addEventListener("input", event => {
      config[id] = event.target.valueAsNumber;
      if (id === "a") config.c = Math.max(config.c, Number((config.a + 0.1).toFixed(2)));
      renderControls();
      requestSolve();
    });
  }
  byId("controls").addEventListener("submit", event => event.preventDefault());
  byId("reset").addEventListener("click", () => {
    Object.assign(config, initial);
    renderControls();
    requestSolve();
  });
  const resize = new ResizeObserver(redraw);
  for (const plot of plots) resize.observe(plot);
  renderControls();
  requestSolve();
})();
