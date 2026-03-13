const fs = require('fs/promises');
const path = require('path');

const defaultConfig = require('./config.default.json');
const scanner = require('./lib/scanner');
const crystallize = require('./lib/crystallize');
const prompt = require('./lib/prompt');

function mergeConfig(userConfig = {}) {
  return {
    ...defaultConfig,
    ...userConfig,
    gates: {
      ...defaultConfig.gates,
      ...(userConfig.gates || {})
    },
    crystallization: {
      ...defaultConfig.crystallization,
      ...(userConfig.crystallization || {})
    },
    output: {
      ...defaultConfig.output,
      ...(userConfig.output || {})
    },
    output_changelog: {
      ...(defaultConfig.output_changelog || {}),
      ...(userConfig.output_changelog || {}),
      growthFeed: {
        ...(defaultConfig.output_changelog?.growthFeed || {}),
        ...(userConfig.output_changelog?.growthFeed || {})
      }
    },
    prompts: {
      ...defaultConfig.prompts,
      ...(userConfig.prompts || {})
    },
    ollama: {
      ...defaultConfig.ollama,
      ...(userConfig.ollama || {})
    }
  };
}

/**
 * Append a crystallization event to the changelog file.
 * Format: date, trait, trigger principle, source count, description.
 */
async function appendChangelog(config, traitRecord) {
  const changelogPath = config.output_changelog?.changelogPath;
  if (!changelogPath) return;

  const resolvedPath = path.resolve(__dirname, changelogPath);

  const date = new Date().toISOString().split('T')[0];
  const entry = [
    '',
    `### ${date} — ${traitRecord.pattern || 'unknown'}`,
    `- **Trait:** ${traitRecord.text}`,
    `- **Principle:** ${traitRecord.principle}`,
    `- **Sources:** ${traitRecord.demonstratedCount} growth vectors`,
    `- **Approved by:** ${traitRecord.approvedBy || 'user'}`,
    ''
  ].join('\n');

  try {
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.appendFile(resolvedPath, entry);
  } catch (err) {
    // Silent fail — changelog is supplementary
  }
}

/**
 * Optionally notify a Telegram topic about a new crystallized trait.
 */
async function notifyGrowthFeed(config, traitRecord) {
  const feed = config.output_changelog?.growthFeed;
  if (!feed?.enabled || !feed?.chatId) return;

  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) return;

    const message = [
      '🔮 *Neuer Charakterzug kristallisiert*',
      '',
      `> ${traitRecord.text}`,
      '',
      `Prinzip: ${traitRecord.principle} | Muster: ${traitRecord.pattern}`,
      `Quellen: ${traitRecord.demonstratedCount} Growth Vectors`
    ].join('\n');

    const params = new URLSearchParams({
      chat_id: feed.chatId,
      text: message,
      parse_mode: 'Markdown'
    });
    if (feed.threadId) params.set('message_thread_id', feed.threadId);

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage?${params}`, { method: 'GET' });
  } catch (err) {
    // Silent fail — notification is optional
  }
}

async function ensureJsonArray(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

function extractLastMessageText(context = {}) {
  const candidates = [
    context.lastUserMessage,
    context.userMessage,
    context.input,
    context.message?.text,
    context.message?.content,
    context.payload?.message,
    context.payload?.text
  ].filter(Boolean);

  if (candidates.length) {
    return String(candidates[0]).trim();
  }

  const messages = context.messages || context.history || [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    const role = String(msg?.role || '').toLowerCase();
    if (role === 'user' || role === 'human') {
      return String(msg?.content || msg?.text || '').trim();
    }
  }

  return '';
}

function detectApprovalDecision(messageText) {
  const text = (messageText || '').toLowerCase().trim();
  if (!text) {
    return { decision: 'none' };
  }

  const editMatch = text.match(/\bedit\s*:\s*(.+)$/i);
  if (editMatch) {
    return { decision: 'edit', editText: editMatch[1].trim() };
  }

  const hasApprove = /\b(yes|approve|crystallize)\b/i.test(text);
  const hasReject = /\b(no|reject|skip)\b/i.test(text);

  if (hasApprove && !hasReject) {
    return { decision: 'approve' };
  }

  if (hasReject && !hasApprove) {
    return { decision: 'reject' };
  }

  return { decision: 'none' };
}

function latestPendingGroup(vectors) {
  const pending = vectors.filter((v) => v?.crystallization?.status === 'pending_review');
  if (!pending.length) {
    return [];
  }

  const latestTimestamp = pending
    .map((v) => Date.parse(v?.crystallization?.proposedAt || 0))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => b - a)[0];

  if (!latestTimestamp) {
    return pending;
  }

  return pending.filter((v) => Date.parse(v?.crystallization?.proposedAt || 0) === latestTimestamp);
}

async function sendMessage(api, message) {
  if (api?.message?.send) {
    await api.message.send({ message });
    return;
  }
  if (api?.messages?.send) {
    await api.messages.send({ message });
  }
}

function createPlugin(api, userConfig = {}) {
  const config = mergeConfig(userConfig);

  async function runCrystallization(candidateIds = null) {
    if (!config.enabled) {
      return { status: 'disabled' };
    }

    const vectorsPath = config.output.vectorsPath;
    const vectors = await ensureJsonArray(vectorsPath);
    const sourceCandidates = Array.isArray(candidateIds) && candidateIds.length
      ? scanner.selectCandidatesById(vectors, candidateIds)
      : scanner.findCandidates(vectors, config);

    if (sourceCandidates.length < (config.crystallization.minVectors || 3)) {
      return { status: 'insufficient_candidates', count: sourceCandidates.length };
    }

    const alignment = await crystallize.checkPrincipleAlignment(sourceCandidates, config);
    const principle = crystallize.chooseDominantPrinciple(alignment);

    if (!principle) {
      return { status: 'no_principle_alignment' };
    }

    const alignedIds = new Set(alignment.filter((a) => a.principle === principle).map((a) => a.vectorId));
    const alignedVectors = sourceCandidates.filter((v) => alignedIds.has(v.id));

    if (alignedVectors.length < (config.crystallization.minVectors || 3)) {
      return { status: 'insufficient_aligned_vectors', count: alignedVectors.length };
    }

    const synthesis = await crystallize.synthesizeTrait(alignedVectors, principle, config);
    if (!synthesis.trait) {
      return { status: 'empty_synthesis' };
    }

    const nowIso = new Date().toISOString();
    const byId = new Map(alignedVectors.map((v) => [v.id, v]));

    const updatedVectors = vectors.map((vector) => {
      if (!byId.has(vector.id)) {
        return vector;
      }

      return {
        ...vector,
        crystallization: {
          status: 'pending_review',
          proposedTrait: synthesis.trait,
          principle,
          pattern: synthesis.pattern,
          proposedAt: nowIso
        }
      };
    });

    await writeJson(vectorsPath, updatedVectors);

    const approvalMessage = prompt.generateApprovalRequest({
      template: config.prompts.approvalRequest,
      trait: synthesis.trait,
      principle,
      count: alignedVectors.length
    });

    await sendMessage(api, approvalMessage);

    return {
      status: 'pending_review',
      principle,
      count: alignedVectors.length,
      proposedTrait: synthesis.trait
    };
  }

  async function onAgentEnd(context = {}) {
    if (!config.enabled) {
      return;
    }

    const text = extractLastMessageText(context);
    const { decision, editText } = detectApprovalDecision(text);

    if (decision === 'none') {
      return;
    }

    const vectorsPath = config.output.vectorsPath;
    const traitsPath = config.output.traitsPath;
    const vectors = await ensureJsonArray(vectorsPath);
    const pending = latestPendingGroup(vectors);

    if (!pending.length) {
      return;
    }

    const pendingIds = new Set(pending.map((v) => v.id));
    const nowIso = new Date().toISOString();

    if (decision === 'reject') {
      const rejected = vectors.map((vector) => {
        if (!pendingIds.has(vector.id)) {
          return vector;
        }

        return {
          ...vector,
          crystallization: {
            ...(vector.crystallization || {}),
            status: 'rejected_crystallization',
            rejectedAt: nowIso
          }
        };
      });

      await writeJson(vectorsPath, rejected);
      return;
    }

    if (decision === 'edit') {
      const edited = vectors.map((vector) => {
        if (!pendingIds.has(vector.id)) {
          return vector;
        }

        return {
          ...vector,
          crystallization: {
            ...(vector.crystallization || {}),
            proposedTrait: editText,
            proposedAt: nowIso,
            status: 'pending_review'
          }
        };
      });

      await writeJson(vectorsPath, edited);
      return;
    }

    if (decision === 'approve') {
      const traits = await ensureJsonArray(traitsPath);
      const first = pending[0].crystallization || {};
      const traitRecord = crystallize.buildTraitRecord({
        traitText: first.proposedTrait || 'Trait crystallized',
        principle: first.principle || 'word',
        pattern: first.pattern || 'unknown',
        sourceVectors: pending
      });

      const approvedVectors = vectors.map((vector) => {
        if (!pendingIds.has(vector.id)) {
          return vector;
        }

        return {
          ...vector,
          crystallization: {
            ...(vector.crystallization || {}),
            status: 'approved',
            approvedAt: nowIso,
            traitId: traitRecord.id
          }
        };
      });

      traits.push(traitRecord);
      await writeJson(traitsPath, traits);
      await writeJson(vectorsPath, approvedVectors);

      // Changelog + Growth Feed
      await appendChangelog(config, traitRecord);
      await notifyGrowthFeed(config, traitRecord);
    }
  }

  if (global.__ocNightshift?.registerTaskRunner) {
    global.__ocNightshift.registerTaskRunner('crystallization', async (task, _ctx) => {
      const payload = task?.payload;
      const candidateIds = Array.isArray(payload)
        ? payload
        : payload?.candidateVectorIds || payload?.vectorIds || [];
      return runCrystallization(candidateIds);
    });
  }

  return {
    name: 'crystallization',
    hooks: {
      agent_end_crystallization: async (_ctx) => runCrystallization(),
      agent_end: async (ctx) => onAgentEnd(ctx)
    },
    runCrystallization,
    onAgentEnd,
    detectApprovalDecision
  };
}

module.exports = {
  id: 'crystallization',
  name: 'Crystallization — Trait Formation',

  configSchema: {
    jsonSchema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        gates: { type: 'object' },
        crystallization: { type: 'object' },
        output: { type: 'object' },
        prompts: { type: 'object' },
        ollama: { type: 'object' }
      }
    }
  },

  register(api) {
    // Merge: pluginConfig (from openclaw.json) overrides local config.json
    let localConfig = {};
    try {
      localConfig = require('./config.json');
    } catch (e) { /* no local config.json */ }
    const userConfig = { ...localConfig, ...(api.pluginConfig || {}) };
    const plugin = createPlugin(api, userConfig);
    
    // Register hooks
    api.on('agent_end', plugin.hooks.agent_end_crystallization);
    api.on('agent_end', plugin.hooks.agent_end);
    
    api.logger.info('Crystallization plugin registered — converts growth vectors to permanent traits');
  }
};

module.exports.createPlugin = createPlugin;
module.exports.detectApprovalDecision = detectApprovalDecision;
