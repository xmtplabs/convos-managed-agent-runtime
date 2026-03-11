import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import process from 'node:process';

const resultsPath = process.argv[2];
const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY;
const strictMode = process.env.EVAL_STRICT === '1';
const llmEnabled = process.env.EVAL_USE_LLM_SUMMARY !== '0';
const evalExitCode = Number.parseInt(process.env.EVAL_EXIT_CODE || '0', 10) || 0;

function clip(value, max = 220) {
  if (typeof value !== 'string') {
    return '';
  }

  const singleLine = value.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= max) {
    return singleLine;
  }

  return `${singleLine.slice(0, max - 1)}...`;
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
  const transcript = clip(String(firstValue(output, [
    'output',
    'response.output',
    'response.text',
    'response.raw',
  ]) || ''), 280);
  const reasons = gatherFailureReasons(output);

  return {
    name,
    pass,
    transcript,
    reason: reasons[0] || (pass ? '' : 'Assertion failed without a structured reason'),
    reasons,
  };
}

function buildSummary(data) {
  if (!data) {
    return {
      total: 0,
      passed: 0,
      failed: 0,
      failures: [],
      parseError: '',
    };
  }

  if (data.parseError) {
    return {
      total: 0,
      passed: 0,
      failed: evalExitCode ? 1 : 0,
      failures: [],
      parseError: `Could not parse eval JSON: ${data.parseError}`,
    };
  }

  const root = data.results || data;
  const rawOutputs = Array.isArray(root.outputs) ? root.outputs : [];
  const normalized = rawOutputs.map(normalizeOutput);
  const passed = normalized.filter((output) => output.pass).length;
  const failedOutputs = normalized.filter((output) => !output.pass);
  const stats = root.stats && typeof root.stats === 'object' ? root.stats : {};
  const total = Number(firstValue(stats, ['tests', 'total']) ?? rawOutputs.length);
  const statsPassed = Number(firstValue(stats, ['passed', 'successes']));
  const failed = Number(firstValue(stats, ['failed', 'failures']) ?? failedOutputs.length);
  const inferredFailed = Math.max(failed, failedOutputs.length, evalExitCode ? 1 : 0);
  const inferredPassed = Math.max(0, Math.max(Number.isFinite(statsPassed) ? statsPassed : 0, Math.min(total || normalized.length, passed)));
  const finalTotal = Math.max(total, normalized.length, inferredPassed + inferredFailed);

  return {
    total: finalTotal,
    passed: inferredPassed,
    failed: inferredFailed,
    failures: failedOutputs.slice(0, 5),
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

  const model = process.env.EVAL_SUMMARY_MODEL || 'anthropic/claude-sonnet-4';
  const payload = {
    model,
    temperature: 0,
    max_tokens: 180,
    messages: [
      {
        role: 'system',
        content:
          'You summarize CI eval failures for engineers. Be concise, specific, and factual. Respond in plain markdown with 2-4 short bullets. Do not mention that you are an AI.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          totals: {
            total: summary.total,
            passed: summary.passed,
            failed: summary.failed,
          },
          failures: summary.failures.map((failure) => ({
            test: failure.name,
            reason: failure.reason,
            transcript_excerpt: failure.transcript,
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

  appendFileSync(stepSummaryPath, `${markdown}\n`);
}

function emitError(summary, llmSummary) {
  const headline = `${summary.failed}/${summary.total || summary.failed} eval tests failed`;
  const details = summary.failures
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

if (summary.failures.length > 0) {
  lines.push('### Failed Tests');
  lines.push('');
  for (const failure of summary.failures) {
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
