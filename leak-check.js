const { renderToString } = require('./hydrate');

const ITERATIONS = Number(process.env.ITERATIONS || 3000);
const D_ITERATIONS = Number(process.env.D_ITERATIONS || 800);
const SAMPLE_EVERY = Number(process.env.SAMPLE_EVERY || 200);
const D_SAMPLE_EVERY = Number(process.env.D_SAMPLE_EVERY || 50);
const WARMUP = Number(process.env.WARMUP || 200);

function heapMB() {
  if (global.gc) global.gc();
  return process.memoryUsage().heapUsed / 1024 / 1024;
}

async function runScenario(name, htmlFor, optsFor, iterations = ITERATIONS, sampleEvery = SAMPLE_EVERY, warmup = WARMUP) {
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const html = htmlFor(i);
    const opts = optsFor(i);
    const result = await renderToString(html, opts);
    if (result.diagnostics.length > 0) {
      console.error(`[${name}] iteration ${i} diagnostics:`, result.diagnostics.map((d) => d.messageText).join('\n'));
      throw new Error(`${name} produced diagnostics at iteration ${i}`);
    }
    if (i >= warmup && (i - warmup) % sampleEvery === 0) {
      samples.push({ i, heapMB: heapMB() });
    }
  }
  samples.push({ i: iterations, heapMB: heapMB() });
  return samples;
}

function report(name, samples) {
  console.log(`\n=== ${name} ===`);
  for (const s of samples) {
    console.log(`  iter ${String(s.i).padStart(5)}  heapUsed ${s.heapMB.toFixed(2)} MB`);
  }
  const first = samples[0].heapMB;
  const last = samples[samples.length - 1].heapMB;
  const deltaPerK = ((last - first) / (samples[samples.length - 1].i - samples[0].i)) * 1000;
  console.log(`  delta: ${(last - first).toFixed(2)} MB over ${samples[samples.length - 1].i - samples[0].i} iterations (~${deltaPerK.toFixed(3)} MB / 1000 renders)`);
  return { name, first, last, deltaPerK };
}

async function main() {
  if (!global.gc) {
    console.error('Run with: node --expose-gc leak-check.js');
    process.exit(1);
  }

  const summaries = [];

  // A: control baseline — no reuseWindow, fresh window every render, listener component
  summaries.push(
    report(
      'A: no reuseWindow, leak-cmp (window/document @Listen)',
      await runScenario(
        'A',
        () => `<leak-cmp></leak-cmp>`,
        () => ({ fullDocument: false }),
      ),
    ),
  );

  // B: reuseWindow + constant serializeShadowRoot + component WITH window/document listeners
  summaries.push(
    report(
      'B: reuseWindow=true, constant mode, leak-cmp (window/document @Listen)',
      await runScenario(
        'B',
        () => `<leak-cmp></leak-cmp>`,
        () => ({ fullDocument: false, reuseWindow: true, serializeShadowRoot: 'declarative-shadow-dom' }),
      ),
    ),
  );

  // C: reuseWindow + constant serializeShadowRoot + component WITHOUT listeners (isolates B's cause)
  summaries.push(
    report(
      'C: reuseWindow=true, constant mode, plain-cmp (no listeners)',
      await runScenario(
        'C',
        () => `<plain-cmp></plain-cmp>`,
        () => ({ fullDocument: false, reuseWindow: true, serializeShadowRoot: 'declarative-shadow-dom' }),
      ),
    ),
  );

  // D: reuseWindow + varying serializeShadowRoot per call + plain-cmp (isolates reusableWindows map growth)
  summaries.push(
    report(
      'D: reuseWindow=true, varying serializeShadowRoot per call, plain-cmp',
      await runScenario(
        'D',
        () => `<plain-cmp></plain-cmp>`,
        (i) => ({
          fullDocument: false,
          reuseWindow: true,
          serializeShadowRoot: { scoped: [`tag-${i}`] },
        }),
        D_ITERATIONS,
        D_SAMPLE_EVERY,
        D_SAMPLE_EVERY,
      ),
    ),
  );

  console.log('\n=== SUMMARY ===');
  for (const s of summaries) {
    console.log(`${s.name}: ${s.first.toFixed(2)} MB -> ${s.last.toFixed(2)} MB  (~${s.deltaPerK.toFixed(3)} MB/1000 renders)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
