const API_BASE = '';
const REFRESH_INTERVAL = 2000;

let lastMetrics = null;
let latencyHistory = [];
let throughputHistory = [];
const MAX_HISTORY = 30;

function $(id) { return document.getElementById(id); }

async function fetchJSON(url) {
  try {
    const res = await fetch(API_BASE + url);
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch (err) {
    console.error('Fetch error:', url, err);
    return null;
  }
}

function getCounter(metrics, pattern) {
  if (!metrics || !metrics.counters) return 0;
  let total = 0;
  for (const [key, val] of Object.entries(metrics.counters)) {
    if (key.startsWith(pattern)) total += val;
  }
  return total;
}

function getTimingPercentile(metrics, pattern, percentile) {
  if (!metrics || !metrics.timings) return 0;
  for (const [key, data] of Object.entries(metrics.timings)) {
    if (key.startsWith(pattern)) {
      if (percentile === 50) return data.p50 || 0;
      if (percentile === 99) return data.p99 || 0;
      return data.avg || 0;
    }
  }
  return 0;
}

async function refreshMetrics() {
  const data = await fetchJSON('/api/v1/monitoring/metrics');
  if (!data) {
    $('connection-status').className = 'status-dot disconnected';
    return;
  }

  $('connection-status').className = 'status-dot connected';
  $('refresh-time').textContent = new Date().toLocaleTimeString();

  const success = getCounter(data, 'deduct.success');
  const insufficient = getCounter(data, 'deduct.insufficient_stock');
  const duplicate = getCounter(data, 'deduct.duplicate');
  const error = getCounter(data, 'deduct.error');
  const rollbackSuccess = getCounter(data, 'rollback.success');
  const confirmSuccess = getCounter(data, 'confirm.success');
  const autoRollback = getCounter(data, 'tx.auto_rollback');
  const cacheHit = getCounter(data, 'degradation.cache_hit');
  const rateLimitRejected = getCounter(data, 'rate_limit.rejected');

  $('deduct-success').textContent = success.toLocaleString();
  $('deduct-insufficient').textContent = insufficient.toLocaleString();
  $('deduct-duplicate').textContent = duplicate.toLocaleString();
  $('deduct-error').textContent = error.toLocaleString();
  $('rollback-success').textContent = rollbackSuccess.toLocaleString();
  $('confirm-success').textContent = confirmSuccess.toLocaleString();
  $('auto-rollback').textContent = autoRollback.toLocaleString();
  $('cache-hit').textContent = cacheHit.toLocaleString();
  $('rate-limit-rejected').textContent = rateLimitRejected.toLocaleString();

  if (lastMetrics) {
    const dt = (data.timestamp - lastMetrics.timestamp) / 1000;
    if (dt > 0) {
      const successRate = ((success - getCounter(lastMetrics, 'deduct.success')) / dt).toFixed(1);
      const insuffRate = ((insufficient - getCounter(lastMetrics, 'deduct.insufficient_stock')) / dt).toFixed(1);
      $('deduct-success-rate').textContent = `${successRate}/s`;
      $('insufficient-rate').textContent = `${insuffRate}/s`;
    }
  }

  const avgLatency = getTimingPercentile(data, 'deduct.latency', 0);
  const p99Latency = getTimingPercentile(data, 'deduct.latency', 99);
  $('avg-latency').textContent = Math.round(avgLatency);
  $('p99-latency').textContent = Math.round(p99Latency);

  latencyHistory.push({ time: Date.now(), avg: avgLatency, p99: p99Latency });
  throughputHistory.push({ time: Date.now(), success, insufficient, error });
  if (latencyHistory.length > MAX_HISTORY) latencyHistory.shift();
  if (throughputHistory.length > MAX_HISTORY) throughputHistory.shift();

  lastMetrics = data;
}

async function refreshCircuitBreaker() {
  const data = await fetchJSON('/api/v1/monitoring/circuit-breaker');
  if (!data) return;

  const el = $('circuit-state');
  el.textContent = data.state;
  el.style.color = data.state === 'CLOSED' ? '#22c55e'
    : data.state === 'OPEN' ? '#ef4444'
    : '#f59e0b';
}

async function refreshTraces() {
  const data = await fetchJSON('/api/v1/monitoring/traces?count=15');
  if (!data || !data.traces) return;

  const tbody = $('traces-body');
  tbody.innerHTML = '';

  for (const trace of data.traces.reverse()) {
    for (const span of trace.spans) {
      const tr = document.createElement('tr');
      const duration = span.endTime ? span.endTime - span.startTime : '--';
      const statusClass = span.status === 'OK' ? 'badge-ok' : 'badge-error';
      const time = new Date(span.startTime).toLocaleTimeString();

      tr.innerHTML = `
        <td title="${span.traceId}">${span.traceId.substring(0, 8)}...</td>
        <td>${span.operation}</td>
        <td>${duration}</td>
        <td><span class="badge ${statusClass}">${span.status}</span></td>
        <td>${time}</td>
      `;
      tbody.appendChild(tr);
    }
  }
}

async function refreshRateLimits() {
  const data = await fetchJSON('/api/v1/rate-limit');
  if (!data || !data.rules) return;

  const tbody = $('rate-limit-body');
  tbody.innerHTML = '';

  for (const rule of data.rules) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${rule.merchantId}</td>
      <td>${rule.limit}</td>
      <td>${rule.burstLimit}</td>
      <td>${rule.windowMs}</td>
    `;
    tbody.appendChild(tr);
  }
}

function drawLatencyChart() {
  const canvas = $('latency-chart');
  const ctx = canvas.getContext('2d');
  const w = canvas.width = canvas.offsetWidth * 2;
  const h = canvas.height = canvas.offsetHeight * 2;
  ctx.scale(2, 2);
  const cw = canvas.offsetWidth;
  const ch = canvas.offsetHeight;

  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = '#0f1117';
  ctx.fillRect(0, 0, cw, ch);

  if (latencyHistory.length < 2) return;

  const maxVal = Math.max(...latencyHistory.map(d => Math.max(d.avg, d.p99)), 1);
  const pad = { top: 10, right: 10, bottom: 20, left: 40 };
  const plotW = cw - pad.left - pad.right;
  const plotH = ch - pad.top - pad.bottom;

  ctx.strokeStyle = '#2a2d3a';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (plotH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(cw - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = '#8b8fa3';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(maxVal * (1 - i / 4)) + 'ms', pad.left - 4, y + 3);
  }

  function drawLine(data, key, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    data.forEach((d, i) => {
      const x = pad.left + (plotW / (data.length - 1)) * i;
      const y = pad.top + plotH - (d[key] / maxVal) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  drawLine(latencyHistory, 'p99', '#ef4444');
  drawLine(latencyHistory, 'avg', '#22c55e');

  ctx.fillStyle = '#22c55e';
  ctx.font = '10px sans-serif';
  ctx.fillText('● avg', cw - 80, ch - 4);
  ctx.fillStyle = '#ef4444';
  ctx.fillText('● p99', cw - 40, ch - 4);
}

function drawThroughputChart() {
  const canvas = $('throughput-chart');
  const ctx = canvas.getContext('2d');
  const w = canvas.width = canvas.offsetWidth * 2;
  const h = canvas.height = canvas.offsetHeight * 2;
  ctx.scale(2, 2);
  const cw = canvas.offsetWidth;
  const ch = canvas.offsetHeight;

  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = '#0f1117';
  ctx.fillRect(0, 0, cw, ch);

  if (throughputHistory.length < 2) return;

  const prevSuccess = throughputHistory.length > 1
    ? throughputHistory[throughputHistory.length - 2].success : 0;
  const current = throughputHistory[throughputHistory.length - 1];
  const rate = current.success - prevSuccess;

  const maxVal = Math.max(...throughputHistory.map(d => d.success), 1);
  const pad = { top: 10, right: 10, bottom: 20, left: 40 };
  const plotW = cw - pad.left - pad.right;
  const plotH = ch - pad.top - pad.bottom;

  ctx.strokeStyle = '#2a2d3a';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (plotH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(cw - pad.right, y);
    ctx.stroke();
  }

  ctx.strokeStyle = '#8b5cf6';
  ctx.lineWidth = 2;
  ctx.beginPath();
  throughputHistory.forEach((d, i) => {
    const x = pad.left + (plotW / (throughputHistory.length - 1)) * i;
    const y = pad.top + plotH - (d.success / maxVal) * plotH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = '#8b5cf6';
  ctx.font = '10px sans-serif';
  ctx.fillText('累计扣减成功', cw - 80, ch - 4);
}

async function refresh() {
  await Promise.all([
    refreshMetrics(),
    refreshCircuitBreaker(),
    refreshTraces(),
    refreshRateLimits(),
  ]);
  drawLatencyChart();
  drawThroughputChart();
}

refresh();
setInterval(refresh, REFRESH_INTERVAL);
