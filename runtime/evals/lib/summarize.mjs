import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import process from 'node:process';

const resultsPath = process.argv[2];
const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY;
const strictMode = process.env.EVAL_STRICT === '1';
const llmEnabled = process.env.EVAL_USE_LLM_SUMMARY !== '0';
const evalExitCode = Number.parseInt(process.env.EVAL_EXIT_CODE || '0', 10) || 0;
const FALLBACK_FAILURE_REASON = 'Assertion failed without a structured reason';

function clip(value, max = 220) {
  if (typeof value !== 'string') {
    return '';
  }

  const singleLine = value.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= max) {
    return singleLine;
  }

  if (max <= 3) {
    return singleLine.slice(0, max);
  }

  return `${singleLine.slice(0, max - 3)}...`;
}

function formatPercent(numerator, denominator) {
  if (!denominator) {
    return '0%';
  }

  return `${Math.round((numerator / denominator) * 100)}%`;
}

function escapeAnnotation(value) {
  return String(value)
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');
}

function emptySummary(parseError = '') {
  return {
    total: 0,
    passed: 0,
    failed: evalExitCode ? 1 : 0,
    failures: [],
    topReasons: [],
    commonFailure: null,
    parseError,
  };
}

function readJson(path) {
  if (!path || !existsSync(path)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return {
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

function getByPath(value, path) {
  return path.split('.').reduce((current, part) => {
    if (current && typeof current === 'object' && part in current) {
      return current[part];
    }
    return undefined;
  }, value);
}

function firstValue(value, paths) {
  for (const path of paths) {
    const candidate = getByPath(value, path);
    if (candidate !== undefined && candidate !== null && candidate !== '') {
      return candidate;
    }
  }
  return undefined;
}

function parseCount(value, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeReason(reason) {
  return clip(String(reason || ''), 180).toLowerCase();
}

function gatherFailureReasons(output) {
  const reasons = [];

  const directReason = firstValue(output, [
    'error',
    'reason',
    'gradingResult.reason',
    'gradingResult.error',
    'response.error',
  ]);
  if (typeof directReason === 'string') {
    reasons.push(directReason);
  }

  const assertions = firstValue(output, ['assertions', 'gradingResult.componentResults']);
  if (Array.isArray(assertions)) {
    for (const assertion of assertions) {
      const passed = firstValue(assertion, ['pass', 'success']);
      if (passed === false) {
        const message = firstValue(assertion, [
          'reason',
          'error',
          'message',
          'assertion.value',
          'value',
          'name',
          'type',
        ]);
        if (message !== undefined) {
          reasons.push(String(message));
        }
      }
    }
  }

  return [...new Set(reasons.map((reason) => clip(String(reason), 180)).filter(Boolean))];
}

function analyzeFailurePatterns(failures) {
  const reasonCounts = new Map();

  for (const failure of failures) {
    for (const reason of failure.reasons) {
      const normalized = normalizeReason(reason);
      if (!normalized) {
        continue;
      }

      const entry = reasonCounts.get(normalized) || {
        text: reason,
        count: 0,
      };
      entry.count += 1;
      reasonCounts.set(normalized, entry);
    }
  }

  const topReasons = [...reasonCounts.values()]
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
    .slice(0, 3);

  const dominantReason = topReasons[0] && topReasons[0].count >= 2 ? topReasons[0] : null;

  return {
    topReasons,
    commonFailure:
      dominantReason && dominantReason.count === failures.length
        ? {
            reason: dominantReason.text,
            count: dominantReason.count,
          }
        : null,
  };
}

function normalizeOutput(output, index) {
  const passValue = firstValue(output, ['pass', 'success']);
  const pass = typeof passValue === 'boolean' ? passValue : passValue === 1;
  const name = clip(String(firstValue(output, [
    'testCase.description',
    'test.description',
    'description',
    'vars.prompt',
    'prompt.raw',
  ]) || `Test ${index + 1}`), 80);
  const reasons = gatherFailureReasons(output);

  return {
    name,
    pass,
    reason: reasons[0] || (pass ? '' : FALLBACK_FAILURE_REASON),
    reasons,
  };
}

function buildSummary(data) {
  if (!data) {
    return emptySummary();
  }

  if (data.parseError) {
    return emptySummary(`Could not parse eval JSON: ${data.parseError}`);
  }

  const root = data.results || data;
  const rawOutputs = Array.isArray(root.results)
    ? root.results
    : Array.isArray(root.outputs)
      ? root.outputs
      : [];
  const normalized = rawOutputs.map(normalizeOutput);
  const passed = normalized.filter((output) => output.pass).length;
  const failedOutputs = normalized.filter((output) => !output.pass);
  const stats = root.stats && typeof root.stats === 'object' ? root.stats : {};
  const total = parseCount(firstValue(stats, ['tests', 'total']), rawOutputs.length);
  const statsPassed = parseCount(firstValue(stats, ['passed', 'successes']));
  const failed = parseCount(firstValue(stats, ['failed', 'failures']), failedOutputs.length);
  const inferredFailed = Math.max(failed, failedOutputs.length, evalExitCode ? 1 : 0);
  const inferredPassed = Math.max(0, Math.max(Number.isFinite(statsPassed) ? statsPassed : 0, Math.min(total || normalized.length, passed)));
  const finalTotal = Math.max(total, normalized.length, inferredPassed + inferredFailed);
  const patterns = analyzeFailurePatterns(failedOutputs);

  return {
    total: finalTotal,
    passed: inferredPassed,
    failed: inferredFailed,
    failures: failedOutputs,
    topReasons: patterns.topReasons,
    commonFailure: patterns.commonFailure,
    parseError: '',
  };
}

async function generateLlmSummary(summary) {
  if (!llmEnabled || summary.failed === 0) {
    return '';
  }

  const apiKey = process.env.EVAL_OPENROUTER_API_KEY;
  if (!apiKey) {
    return '';
  }

  const model = '@preset/assistants-ci';
  const payload = {
    model,
    temperature: 0,
    max_tokens: 180,
    messages: [
      {
        role: 'system',
        content:
          'You summarize CI eval failures for engineers from structured JSON data. Be concise, specific, and factual. Prefer repeated concrete causes over per-test details. Do not speculate about missing context. If a shared upstream failure appears across multiple tests, state that explicitly. Respond in plain markdown with 2-4 short bullets. Do not mention that you are an AI.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          totals: {
            total: summary.total,
            passed: summary.passed,
            failed: summary.failed,
          },
          common_failure: summary.commonFailure,
          top_reasons: summary.topReasons,
          failed_tests: summary.failures.slice(0, 7).map((failure) => ({
            test: failure.name,
            reason: failure.reason,
          })),
        }),
      },
    ],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      return '';
    }

    const json = await response.json();
    const content = json?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content.trim() : '';
  } catch {
    return '';
  } finally {
    clearTimeout(timeout);
  }
}

function writeStepSummary(markdown) {
  if (!stepSummaryPath) {
    return;
  }

  try {
    appendFileSync(stepSummaryPath, `${markdown}\n`);
  } catch {
    // Step summary is optional; don't block primary output
  }
}

function emitError(summary, llmSummary) {
  const headline = `${summary.failed}/${summary.total || summary.failed} eval tests failed`;
  const details = summary.commonFailure
    ? `common cause across all failures: ${summary.commonFailure.reason}`
    : summary.failures
        .slice(0, 3)
        .map((failure) => `${failure.name}: ${failure.reason}`)
        .join(' | ');
  const llmLine = llmSummary ? ` | ${clip(llmSummary.replace(/[*`#>\n-]+/g, ' '), 180)}` : '';
  const message = clip(`${headline}${details ? ` | ${details}` : ''}${llmLine}`, 500);
  console.log(`::error title=E2E eval failed::${escapeAnnotation(message)}`);
}

const data = readJson(resultsPath);
const summary = buildSummary(data);
const llmSummary = await generateLlmSummary(summary);

const lines = [
  '## E2E Eval Summary',
  '',
  `- Status: ${summary.failed > 0 || evalExitCode !== 0 ? 'failed' : 'passed'}`,
  `- Passed: ${summary.passed}/${summary.total || summary.passed + summary.failed} (${formatPercent(summary.passed, summary.total || summary.passed + summary.failed)})`,
  `- Failed: ${summary.failed}/${summary.total || summary.passed + summary.failed} (${formatPercent(summary.failed, summary.total || summary.passed + summary.failed)})`,
  '',
];

if (summary.parseError) {
  lines.push(`- ${summary.parseError}`);
  lines.push('');
}

if (summary.commonFailure) {
  lines.push('### Common Cause');
  lines.push('');
  lines.push(`- ${summary.commonFailure.reason} (${summary.commonFailure.count}/${summary.failed} failed tests)`);
  lines.push('');
} else if (summary.topReasons.length > 0) {
  lines.push('### Top Failure Reasons');
  lines.push('');
  for (const entry of summary.topReasons) {
    lines.push(`- ${entry.text} (${entry.count}/${summary.failed} failed tests)`);
  }
  lines.push('');
}

if (summary.failures.length > 0) {
  lines.push('### Failed Tests');
  lines.push('');
  for (const failure of summary.failures.slice(0, 7)) {
    lines.push(`- \`${failure.name}\` — ${failure.reason}`);
  }
  lines.push('');
}

if (llmSummary) {
  lines.push('### LLM Summary');
  lines.push('');
  lines.push(llmSummary);
  lines.push('');
}

lines.push('Artifact: `eval-report`');

const markdown = lines.join('\n');
writeStepSummary(markdown);
console.log(markdown);

if (summary.failed > 0 || evalExitCode !== 0) {
  emitError(summary, llmSummary);
  if (strictMode) {
    process.exit(1);
  }
}
