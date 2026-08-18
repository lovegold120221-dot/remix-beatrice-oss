// In-memory metrics registry with a Prometheus text-format exporter.
// Counters and histograms are cheap and lock-free enough for this workload;
// they reset on process restart, which is acceptable for operational dashboards.

interface Counter {
  name: string;
  help: string;
  value: number;
}

interface Histogram {
  name: string;
  help: string;
  buckets: number[];
  counts: number[];
  sum: number;
}

const counters = new Map<string, Counter>();
const histograms = new Map<string, Histogram>();

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60];

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_:]/g, '_');
}

export function registerCounter(name: string, help: string): void {
  if (!counters.has(name)) counters.set(name, { name: sanitize(name), help, value: 0 });
}

export function registerHistogram(name: string, help: string, buckets: number[] = DEFAULT_BUCKETS): void {
  if (!histograms.has(name)) {
    histograms.set(name, {
      name: sanitize(name),
      help,
      buckets: [...buckets].sort((a, b) => a - b),
      counts: new Array(buckets.length + 1).fill(0),
      sum: 0,
    });
  }
}

export function incCounter(name: string, by = 1): void {
  const c = counters.get(name);
  if (c) c.value += by;
}

export function observeHistogram(name: string, value: number): void {
  const h = histograms.get(name);
  if (!h) return;
  h.sum += value;
  // Prometheus histograms are cumulative: every bucket whose upper bound is
  // >= value is incremented, plus the +Inf bucket.
  for (let i = 0; i < h.buckets.length; i++) {
    if (value <= h.buckets[i]) {
      h.counts[i]++;
    }
  }
  h.counts[h.buckets.length]++;
}

// Render the Prometheus exposition format.
export function renderMetrics(): string {
  const lines: string[] = [];
  for (const c of counters.values()) {
    lines.push(`# HELP ${c.name} ${c.help}`);
    lines.push(`# TYPE ${c.name} counter`);
    lines.push(`${c.name} ${c.value}`);
  }
  for (const h of histograms.values()) {
    lines.push(`# HELP ${h.name} ${h.help}`);
    lines.push(`# TYPE ${h.name} histogram`);
    for (let i = 0; i < h.buckets.length; i++) {
      lines.push(`${h.name}_bucket{le="${h.buckets[i]}"} ${h.counts[i]}`);
    }
    lines.push(`${h.name}_bucket{le="+Inf"} ${h.counts[h.buckets.length]}`);
    lines.push(`${h.name}_sum ${h.sum}`);
    lines.push(`${h.name}_count ${h.counts[h.buckets.length]}`);
  }
  return lines.join('\n') + '\n';
}

// Standard app metrics, registered once at startup.
export function registerStandardMetrics(): void {
  registerCounter('beatrice_ws_connections_total', 'Total WebSocket /live connections accepted');
  registerCounter('beatrice_ws_connections_rejected_total', 'WebSocket /live connections rejected (auth failure)');
  registerCounter('beatrice_http_requests_total', 'Total HTTP requests');
  registerCounter('beatrice_http_requests_rejected_total', 'HTTP requests rejected (auth failure)');
  registerCounter('beatrice_tool_calls_total', 'Total tool calls dispatched');
  registerCounter('beatrice_tool_errors_total', 'Total tool calls that errored');
  registerHistogram('beatrice_tool_duration_seconds', 'Tool call duration in seconds');
  registerHistogram('beatrice_http_duration_seconds', 'HTTP request duration in seconds');
}
