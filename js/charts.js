(() => {
  "use strict";

  const colors = ["#245dc4", "#087d76", "#a95025", "#8a4b9e", "#476f9d"];
  const ru = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3, useGrouping: false });
  function number(value, digits = 3) {
    if (!Number.isFinite(value)) return "—";
    if (value !== 0 && Math.abs(value) < 10 ** -digits) {
      return value.toExponential(1).replace(".", ",").replace("e-", "e−");
    }
    return digits === 3 ? ru.format(value) : new Intl.NumberFormat("ru-RU", {
      maximumFractionDigits: digits, useGrouping: false,
    }).format(value);
  }

  function limits(series, from = 0) {
    let lo = from;
    let hi = from;
    for (const { points } of series) {
      for (const [, value] of points) {
        lo = Math.min(lo, value);
        hi = Math.max(hi, value);
      }
    }
    const padding = Math.max((hi - lo) * 0.12, 1e-8);
    return [lo < 0 ? lo - padding : 0, hi + padding];
  }

  function plot(canvas, options) {
    if (!options) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    const ratio = window.devicePixelRatio || 1;
    const bufferWidth = Math.round(width * ratio);
    const bufferHeight = Math.round(height * ratio);
    if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
      canvas.width = bufferWidth;
      canvas.height = bufferHeight;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const { xDomain, yDomain, xLabel, yLabel, series, guides = [], zones = [], marker, xTicks, yTicks } = options;
    const left = width < 370 ? 58 : 69;
    const right = width - 19;
    const top = 22;
    const bottom = height - 40;
    const xAt = value => left + (value - xDomain[0]) * (right - left) / (xDomain[1] - xDomain[0]);
    const yAt = value => bottom - (value - yDomain[0]) * (bottom - top) / (yDomain[1] - yDomain[0]);

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, right - left, bottom - top);
    ctx.clip();
    for (const { axis, from, to, fill } of zones) {
      ctx.fillStyle = fill || "#eaf2fd";
      if (axis === "x") ctx.fillRect(xAt(from), top, xAt(to) - xAt(from), bottom - top);
      else ctx.fillRect(left, yAt(to), right - left, yAt(from) - yAt(to));
    }
    ctx.restore();

    function line(x0, y0, x1, y1, color) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    function divisions(domain, count) {
      return Array.from({ length: count + 1 }, (_, i) => (
        domain[0] + i * (domain[1] - domain[0]) / count
      ));
    }
    const gridColor = "#e0e9f3";
    const axisColor = "#9eb2c8";
    ctx.lineWidth = 1;
    ctx.font = "12px Segoe UI, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#425974";
    for (const x of xTicks || divisions(xDomain, width < 465 ? 4 : 6)) {
      const px = xAt(x);
      line(px, top, px, bottom, gridColor);
      ctx.fillText(number(x, 2), px, bottom + 6);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const y of yTicks || divisions(yDomain, height < 220 ? 3 : 4)) {
      const py = yAt(y);
      line(left, py, right, py, gridColor);
      ctx.fillText(number(y, 2), left - 7, py);
    }
    line(left, top, left, bottom, axisColor);
    line(left, bottom, right, bottom, axisColor);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(yLabel, 2, 2);
    ctx.textAlign = "right";
    ctx.fillText(xLabel, right, height - 13);

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, right - left, bottom - top);
    ctx.clip();
    ctx.setLineDash([5, 4]);
    for (const guide of guides) {
      if (guide.axis === "x") line(xAt(guide.value), top, xAt(guide.value), bottom, guide.color || axisColor);
      else line(left, yAt(guide.value), right, yAt(guide.value), guide.color || axisColor);
    }
    ctx.setLineDash([]);
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    for (const { points, color } of series) {
      if (!points.length) continue;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(xAt(points[0][0]), yAt(points[0][1]));
      for (let i = 1; i < points.length; i++) ctx.lineTo(xAt(points[i][0]), yAt(points[i][1]));
      ctx.stroke();
    }
    ctx.restore();
    if (marker) {
      const x = xAt(marker.x);
      const y = yAt(marker.y);
      if (y >= top - 1 && y <= bottom + 1 && x >= left - 1 && x <= right + 1) {
        ctx.fillStyle = marker.color || colors[0];
        ctx.beginPath();
        ctx.arc(x, y, 4.5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "white";
        ctx.stroke();
      }
    }
  }

  function scheduler(onResult, onError) {
    let worker;
    let inFlight = false;
    let latest = 0;
    let queued;
    if (location.protocol !== "file:") {
      try {
        worker = new Worker("js/worker.js");
        worker.onmessage = ({ data }) => finish(data);
        worker.onerror = () => {
          worker.terminate();
          worker = undefined;
          inFlight = false;
          submit(lastRequest);
        };
      } catch {
        worker = undefined;
      }
    }
    let lastRequest;
    function submit(request) {
      if (!request) return;
      if (inFlight) {
        queued = request;
        return;
      }
      inFlight = true;
      if (worker) {
        worker.postMessage(request);
        return;
      }
      // A static file opened directly still works with the same solver.
      setTimeout(() => {
        try {
          finish({ id: request.id, result: Simulation.solve(request.config) });
        } catch (error) {
          finish({ id: request.id, error: error.message });
        }
      }, 0);
    }
    function finish({ id, result, error }) {
      inFlight = false;
      if (id === latest) {
        if (error) onError(error);
        else onResult(result);
      }
      const next = queued;
      queued = undefined;
      submit(next);
    }
    return {
      run(config) {
        lastRequest = { id: ++latest, config };
        submit(lastRequest);
      },
      invalidate() {
        latest++;
        queued = undefined;
        lastRequest = undefined;
      },
    };
  }

  globalThis.Charts = { colors, number, limits, plot, scheduler };
})();
