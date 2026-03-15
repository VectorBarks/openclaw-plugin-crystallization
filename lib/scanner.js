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

  // Collect proposedTrait texts already in pending_review to deduplicate
  const existingPendingTexts = new Set(
    vectors
      .filter((v) => v?.crystallization?.status === 'pending_review')
      .map((v) => (v?.crystallization?.proposedTrait || '').trim())
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

  // Dedup candidates: skip if insight/text already matches an existing pending trait
  const seenTexts = new Set(existingPendingTexts);
  return candidates.filter((v) => {
    const text = (v.insight || v.text || '').substring(0, 200).trim();
    if (!text) return true; // no text to compare, allow
    if (seenTexts.has(text)) return false;
    seenTexts.add(text);
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
