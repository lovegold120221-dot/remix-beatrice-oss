import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerCounter,
  registerHistogram,
  incCounter,
  observeHistogram,
  renderMetrics,
} from '../server/metrics.js';

test('counter increments and renders in Prometheus format', () => {
  registerCounter('test_counter_total', 'A test counter');
  incCounter('test_counter_total', 3);
  const out = renderMetrics();
  assert.match(out, /# TYPE test_counter_total counter/);
  assert.match(out, /test_counter_total 3/);
});

test('histogram buckets render correctly', () => {
  registerHistogram('test_hist_seconds', 'A test histogram', [0.1, 1, 10]);
  observeHistogram('test_hist_seconds', 0.05);
  observeHistogram('test_hist_seconds', 5);
  const out = renderMetrics();
  // Cumulative buckets: 0.05 falls in le=0.1, le=1, le=10; 5 falls in le=10.
  assert.match(out, /test_hist_seconds_bucket\{le="0.1"\} 1/);
  assert.match(out, /test_hist_seconds_bucket\{le="1"\} 1/);
  assert.match(out, /test_hist_seconds_bucket\{le="10"\} 2/);
  assert.match(out, /test_hist_seconds_bucket\{le="\+Inf"\} 2/);
  assert.match(out, /test_hist_seconds_sum 5.05/);
  assert.match(out, /test_hist_seconds_count 2/);
});

test('metric names are sanitized', () => {
  registerCounter('bad name!', 'help');
  const out = renderMetrics();
  assert.match(out, /bad_name_/);
});
