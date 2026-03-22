function isTimeEligible(vector, minAge, nowMs) {
  if (!vector || !vector.created) {
    return false;
  }

  const createdMs = Date.parse(vector.created);
  if (Number.isNaN(createdMs)) {
    return false;
  }

  return nowMs - createdMs >= minAge;
}

function isBlockedByStatus(vector) {
  const status = vector?.crystallization?.status;
  // Block if already in any terminal or active crystallization state
  return ['pending_review', 'approved', 'crystallized', 'skipped', 'rejected', 'rejected_crystallization'].includes(status);
}

function findCandidates(vectors, config, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const minAge = config?.gates?.minAge ?? 0;
  const maxPending = config?.crystallization?.maxPending ?? 5;
  const pendingCount = vectors.filter((v) => v?.crystallization?.status === 'pending_review').length;

  if (pendingCount >= maxPending) {
    return [];
  }

  // Collect proposedTrait texts from all terminal/active crystallization states to deduplicate
  const terminalStatuses = ['pending_review', 'approved', 'crystallized', 'skipped', 'rejected', 'rejected_crystallization', 'rejected_duplicate'];
  const existingPendingTexts = new Set(
    vectors
      .filter((v) => terminalStatuses.includes(v?.crystallization?.status))
      .map((v) => (v?.crystallization?.proposedTrait || '').trim())
      .filter(Boolean)
  );

  // Also collect description texts from all vectors with terminal status to catch duplicates at ingestion level
  const existingDescTexts = new Set(
    vectors
      .filter((v) => terminalStatuses.includes(v?.crystallization?.status))
      .map((v) => (v.description || v.text || v.insight || '').substring(0, 200).trim())
      .filter(Boolean)
  );

  const candidates = vectors.filter((vector) => {
    if (!vector || !vector.id) {
      return false;
    }

    if (isBlockedByStatus(vector)) {
      return false;
    }

    if (vector.resolved === false) {
      return false;
    }

    return isTimeEligible(vector, minAge, nowMs);
  });

  // Dedup candidates: skip if insight/text already matches an existing trait (any terminal status)
  const seenTexts = new Set(existingPendingTexts);
  const seenDescs = new Set(existingDescTexts);
  return candidates.filter((v) => {
    const text = (v.insight || v.text || '').substring(0, 200).trim();
    const desc = (v.description || v.text || v.insight || '').substring(0, 200).trim();

    // Check against existing proposedTrait texts
    if (text && seenTexts.has(text)) return false;
    // Check against existing description texts from terminal vectors
    if (desc && seenDescs.has(desc)) return false;

    if (text) seenTexts.add(text);
    if (desc) seenDescs.add(desc);
    return true;
  });
}

function selectCandidatesById(vectors, ids) {
  const idSet = new Set(ids || []);
  if (!idSet.size) {
    return [];
  }

  return vectors.filter((vector) => idSet.has(vector.id));
}

module.exports = {
  findCandidates,
  isTimeEligible,
  selectCandidatesById
};
