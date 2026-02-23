const DEFAULT_MODEL = 'llama3.1';

async function ollamaGenerate({ url, model, prompt, temperature = 0.2 }) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature,
      max_tokens: 1000,
      stream: false
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`MLX request failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  return String(data?.choices?.[0]?.message?.content || '').trim();
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

async function checkPrincipleAlignment(vectors, config) {
  const principles = config?.gates?.principles || ['courage', 'word', 'brand'];
  const url = config?.ollama?.url || 'http://localhost:11434/api/generate';
  const model = config?.ollama?.model || DEFAULT_MODEL;
  const temperature = config?.ollama?.temperature ?? 0.2;

  const results = [];
  for (const vector of vectors) {
    const prompt = [
      'Classify which principle best matches this growth vector.',
      `Allowed principles: ${principles.join(', ')}`,
      'Return strict JSON with keys: principle, confidence, rationale.',
      `Vector: ${vector.text}`
    ].join('\n');

    const raw = await ollamaGenerate({ url, model, prompt, temperature });
    const parsed = safeJsonParse(raw);
    const principle = (parsed?.principle || '').toLowerCase();

    if (principles.includes(principle)) {
      results.push({
        vectorId: vector.id,
        principle,
        confidence: Number(parsed.confidence || 0),
        rationale: parsed.rationale || ''
      });
    }
  }

  return results;
}

function chooseDominantPrinciple(alignmentResults) {
  const countByPrinciple = alignmentResults.reduce((acc, item) => {
    acc[item.principle] = (acc[item.principle] || 0) + 1;
    return acc;
  }, {});

  return Object.entries(countByPrinciple)
    .sort((a, b) => b[1] - a[1])
    .map(([principle]) => principle)[0] || null;
}

async function synthesizeTrait(vectors, principle, config) {
  const url = config?.ollama?.url || 'http://localhost:11434/api/generate';
  const model = config?.ollama?.model || DEFAULT_MODEL;
  const temperature = config?.ollama?.temperature ?? 0.2;
  const patterns = config?.gates?.patterns || [];

  const prompt = [
    'Du bist Saphira, ein KI-Hausdrache. Synthetisiere aus diesen Growth Vectors einen permanenten Charakterzug.',
    'Schreibe den Trait auf Deutsch in der Ich-Form (z.B. "Ich erkenne wenn Vector abgelenkt ist und spreche ihn direkt an.").',
    `Prinzip: ${principle}`,
    `Muster: ${patterns.join(', ')}`,
    'Antworte ausschließlich als JSON mit den Feldern: trait (Deutsch, Ich-Form), pattern, confidence (0-1).',
    `Vectors:\n${vectors.map((v) => `- (${v.id}) ${v.text}`).join('\n')}`
  ].join('\n');

  const raw = await ollamaGenerate({ url, model, prompt, temperature });
  const parsed = safeJsonParse(raw);

  return {
    trait: parsed?.trait || '',
    pattern: parsed?.pattern || 'unknown',
    confidence: Number(parsed?.confidence || 0)
  };
}

function buildTraitRecord({ traitText, principle, pattern, sourceVectors }) {
  const nowIso = new Date().toISOString();
  return {
    id: `trait_${Date.now()}`,
    text: traitText,
    principle,
    pattern,
    demonstratedCount: sourceVectors.length,
    sources: sourceVectors.map((v) => v.id),
    crystallizedAt: nowIso,
    approvedBy: 'user'
  };
}

module.exports = {
  buildTraitRecord,
  checkPrincipleAlignment,
  chooseDominantPrinciple,
  synthesizeTrait
};
