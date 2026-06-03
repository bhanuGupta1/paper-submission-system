'use strict';

/**
 * Live Groq smoke test — run on your own machine (the sandbox has no network).
 *
 *   npm run groq:smoke
 *
 * Reads GROQ_API_KEY from .env, makes a few real calls, and prints the parsed
 * output plus which model answered. Exit code 0 = all good, 1 = something failed.
 */

require('dotenv').config();
const config = require('../src/config');
const groq = require('../src/services/llm/groq');

const SAMPLE = {
  title: 'A Lightweight Transformer for On-Device Keyword Spotting',
  abstract:
    'We propose a compact transformer architecture for keyword spotting on ' +
    'resource-constrained microcontrollers. Our model uses depthwise-separable ' +
    'attention and 8-bit quantization to fit within 64KB of RAM. On the Google ' +
    'Speech Commands benchmark it reaches 96.1% accuracy, within 0.8% of a model ' +
    '12x its size, while cutting inference latency by 40%.',
};

function hr(label) { console.log('\n' + '─'.repeat(60) + '\n' + label + '\n' + '─'.repeat(60)); }
function show(v) { console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2)); }

(async () => {
  hr('Config');
  console.log('provider (resolved):', config.llm.provider);
  console.log('groq model        :', config.llm.groq.model);
  console.log('groq timeout (ms) :', config.llm.groq.timeoutMs);
  console.log('GROQ_API_KEY set  :', config.llm.groq.apiKey ? 'yes' : 'NO  <-- set it in .env');

  if (!config.llm.groq.apiKey) {
    console.error('\nNo GROQ_API_KEY found. Add it to .env, then re-run: npm run groq:smoke');
    process.exit(1);
  }

  let failures = 0;
  const step = async (name, fn) => {
    hr(name);
    const t = Date.now();
    try {
      const out = await fn();
      if (out == null) { console.error('✗ returned null (call failed; would fall back to heuristic in-app)'); failures++; }
      else { show(out); console.log(`\n✓ ${name} ok in ${Date.now() - t}ms`); }
    } catch (err) { console.error('✗ threw:', err.message); failures++; }
  };

  await step('summarize() — plain text', () => groq.summarize(SAMPLE.abstract, 2));
  await step('draftReview() — JSON mode', () => groq.draftReview(SAMPLE));
  await step('plainLanguageSummary() — NEW feature', () => groq.plainLanguageSummary(SAMPLE.title, SAMPLE.abstract));
  await step('keyContributions() — NEW feature', () => groq.keyContributions(SAMPLE.title, SAMPLE.abstract));
  await step('titleAbstractConsistency() — NEW feature', () => groq.titleAbstractConsistency(SAMPLE.title, SAMPLE.abstract));
  await step('limitationsFinder() — NEW feature', () => groq.limitationsFinder(SAMPLE.title, SAMPLE.abstract, null));

  hr('Result');
  if (failures) { console.error(`${failures} call(s) failed. Check the key, model name, or rate limits above.`); process.exit(1); }
  console.log('All Groq calls succeeded. The platform is wired to Groq correctly.');
  process.exit(0);
})();
