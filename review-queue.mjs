const QUEUE_SCHEMA_VERSION = "1.0.0";

export const REVIEW_QUEUE_STORAGE_KEY =
  "lll.shared-city-cloud.review-queue.v1";
export const STORAGE_KEY = REVIEW_QUEUE_STORAGE_KEY;
export const STORAGE_SCOPE = "BROWSER_LOCAL_PROTOTYPE_ONLY";
export const RECORD_EFFECT = "NONE";
export const SHARED_MEMORY_EFFECT = "NONE";

export const ITEM_TYPES = Object.freeze([
  "EVIDENCE",
  "QUESTION",
  "PROPOSAL",
  "FINDING",
]);

export const RESEARCH_LABELS = Object.freeze([
  "EVIDENCE",
  "DERIVED",
  "ASSUMPTION",
  "HYPOTHESIS",
  "PROPOSAL",
  "UNKNOWN / NOT ESTIMABLE",
  "APPROVED",
]);

export const REVIEW_TARGETS = Object.freeze([
  "SHARED_FOUNDATION",
  "FOOD",
  "MONEY",
  "SAND",
]);

export const WORKFLOW_STATUSES = Object.freeze([
  "DRAFT",
  "UNDER_REVIEW",
  "APPROVED",
  "AMENDED",
  "HELD",
  "REJECTED",
  "SUPERSEDED",
]);

export const TERMINAL_STATUSES = Object.freeze([
  "APPROVED",
  "AMENDED",
  "HELD",
  "REJECTED",
  "SUPERSEDED",
]);

export const DECISION_OUTCOMES = Object.freeze([
  "APPROVED",
  "AMENDED",
  "HELD",
  "REJECTED",
  "SUPERSEDED",
]);

export const OUTCOME_TO_STATUS = Object.freeze({
  APPROVED: "APPROVED",
  AMENDED: "AMENDED",
  HELD: "HELD",
  REJECTED: "REJECTED",
  SUPERSEDED: "SUPERSEDED",
});

export const STATUS_DISPLAY = Object.freeze({
  DRAFT: "DRAFT",
  UNDER_REVIEW: "UNDER REVIEW / PENDING",
  APPROVED: "APPROVED GOVERNANCE / LOCAL PROTOTYPE",
  AMENDED: "AMENDED / NEW VERSION REQUIRED",
  HELD: "HELD",
  REJECTED: "REJECTED",
  SUPERSEDED: "SUPERSEDED",
});

export const REVIEW_POLICIES = Object.freeze({
  ROUTINE_ADDITION: Object.freeze({
    id: "ROUTINE_ADDITION",
    requiredConcurringDecisions: 1,
    reviewerSlots: 3,
    authority: "CONDITIONAL / NOT TEAM-APPROVED",
  }),
  CONSEQUENTIAL_CHANGE: Object.freeze({
    id: "CONSEQUENTIAL_CHANGE",
    requiredConcurringDecisions: 2,
    reviewerSlots: 3,
    authority: "CONDITIONAL / NOT TEAM-APPROVED",
  }),
});

export const QUEUE_LIMITS = Object.freeze({
  importBytes: 1_000_000,
  submissions: 250,
  ledgerEntriesPerSubmission: 500,
  shortText: 240,
  longText: 12_000,
  sourceReferences: 50,
});

const TERMINAL_SET = new Set(TERMINAL_STATUSES);
const UNKNOWN_PATTERN = /^UNKNOWN\b/i;

const DEFAULT_CONTRIBUTOR =
  "CONTRIBUTOR DESCRIPTOR / UNAUTHENTICATED PLACEHOLDER";
const DEFAULT_REVIEWER =
  "REVIEWER DESCRIPTOR / UNAUTHENTICATED PLACEHOLDER";
const POLICY_ID = "CONDITIONAL-THREE-REVIEWER-01";
const AUTHORITY_STATUS = "CONDITIONAL POLICY / NOT REAL AUTHORITY";

function invariantError(message) {
  const error = new Error(message);
  error.name = "ReviewQueueValidationError";
  return error;
}

function conflictError(message) {
  const error = new Error(message);
  error.name = "ReviewQueueRevisionConflictError";
  return error;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requirePlainObject(value, label) {
  if (!isPlainObject(value)) {
    throw invariantError(`${label} must be a plain object.`);
  }
  return value;
}

function cleanText(value, label, options = {}) {
  const {
    required = false,
    maxLength = QUEUE_LIMITS.longText,
    fallback = "",
  } = options;
  const text = value === undefined || value === null ? fallback : String(value);
  const cleaned = text.replace(/\r\n?/g, "\n").trim();

  if (required && !cleaned) {
    throw invariantError(`${label} is required.`);
  }
  if (cleaned.length > maxLength) {
    throw invariantError(`${label} exceeds ${maxLength} characters.`);
  }
  return cleaned;
}

function normalizeEnum(value, allowed, label, aliases = {}) {
  const raw = cleanText(value, label, {
    required: true,
    maxLength: QUEUE_LIMITS.shortText,
  });
  const alias = aliases[raw.toLowerCase()];
  const normalized = alias || raw.toUpperCase().replace(/[\s-]+/g, "_");
  if (!allowed.includes(normalized)) {
    throw invariantError(`${label} is not an allowed value.`);
  }
  return normalized;
}

function normalizeStringArray(value, label) {
  let entries;
  if (Array.isArray(value)) {
    entries = value;
  } else {
    entries = String(value || "").split(/\r?\n|,/);
  }

  const cleaned = entries
    .map((entry) =>
      cleanText(entry, label, {
        maxLength: QUEUE_LIMITS.longText,
      }),
    )
    .filter(Boolean);

  if (cleaned.length > QUEUE_LIMITS.sourceReferences) {
    throw invariantError(
      `${label} exceeds ${QUEUE_LIMITS.sourceReferences} entries.`,
    );
  }
  return cleaned;
}

function normalizeTimestamp(value, label) {
  const text = cleanText(value, label, {
    required: true,
    maxLength: QUEUE_LIMITS.shortText,
  });
  const date = new Date(text);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== text) {
    throw invariantError(`${label} must be an ISO timestamp.`);
  }
  return text;
}

function normalizeId(value, label) {
  const id = cleanText(value, label, {
    required: true,
    maxLength: QUEUE_LIMITS.shortText,
  });
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) {
    throw invariantError(
      `${label} may contain only letters, numbers, period, underscore, colon, and hyphen.`,
    );
  }
  return id;
}

function cloneValue(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
}

export function getWorkingReviewConfig(config, options = {}) {
  const source =
    config === undefined
      ? globalThis.SCC_DATA?.workingReviewQueue
      : config;
  if (!isPlainObject(source)) {
    if (options.required === false) {
      return null;
    }
    throw invariantError(
      "The immutable Working Review Queue target configuration is unavailable.",
    );
  }

  const snapshot = cloneValue(source);
  if (
    snapshot.schemaVersion !== QUEUE_SCHEMA_VERSION ||
    snapshot.storageKey !== REVIEW_QUEUE_STORAGE_KEY ||
    snapshot.initialItemCount !== 0 ||
    !Array.isArray(snapshot.publicSeed) ||
    snapshot.publicSeed.length !== 0 ||
    snapshot.authorityEffect !== RECORD_EFFECT ||
    snapshot.sharedMemoryEffect !== SHARED_MEMORY_EFFECT ||
    snapshot.empiricalTruthFromApproval !== false ||
    snapshot.protectedRecordMutation !== false ||
    snapshot.sharedPersistence !== false ||
    snapshot.authenticated !== false
  ) {
    throw invariantError(
      "The Working Review Queue publication boundary does not match the approved empty, browser-local contract.",
    );
  }
  if (
    !isPlainObject(snapshot.policy) ||
    snapshot.policy.policyId !== POLICY_ID ||
    snapshot.policy.status !== "CONDITIONAL / NOT TEAM-APPROVED" ||
    snapshot.policy.authorityEffect !== RECORD_EFFECT ||
    snapshot.policy.reviewerSlots !== 3 ||
    snapshot.policy.routineConcurringDecisions !== 1 ||
    snapshot.policy.consequentialConcurringDecisions !== 2
  ) {
    throw invariantError(
      "The Working Review Queue conditional policy fingerprint is invalid.",
    );
  }
  if (
    !Array.isArray(snapshot.targets) ||
    snapshot.targets.map((target) => target.id).join("|") !==
      "SHARED_FOUNDATION|FOOD|MONEY|SAND"
  ) {
    throw invariantError(
      "Working Review Queue targets must be the shared foundation followed by equal Food, Money, and Sand lenses.",
    );
  }

  for (const target of snapshot.targets) {
    requirePlainObject(target, "Working Review Queue target");
    normalizeEnum(target.id, REVIEW_TARGETS, "Working Review Queue target ID");
    cleanText(target.targetRecordId, "Target record ID", {
      required: true,
      maxLength: QUEUE_LIMITS.shortText,
    });
    if (
      !Number.isSafeInteger(target.targetRecordVersion) ||
      target.targetRecordVersion < 1
    ) {
      throw invariantError("Target record version must be a positive integer.");
    }
    if (!/^[A-F0-9]{64}$/.test(target.targetRecordSha256)) {
      throw invariantError("Target record SHA-256 fingerprint is invalid.");
    }
    if (
      !["SHARED_CITY", "LENS"].includes(target.layer) ||
      target.protectedStatus !== "DRAFT / FOR TEAM REVIEW" ||
      target.recordEffect !== RECORD_EFFECT
    ) {
      throw invariantError(
        `Protected target ${target.id} has crossed its status or effect boundary.`,
      );
    }
    if (
      (target.id === "SHARED_FOUNDATION" &&
        (target.layer !== "SHARED_CITY" || target.lens !== null)) ||
      (target.id !== "SHARED_FOUNDATION" &&
        (target.layer !== "LENS" ||
          target.lens !==
            `${target.id.slice(0, 1)}${target.id.slice(1).toLowerCase()}` ||
          target.currentAnswer !== "UNKNOWN / NOT ESTIMABLE"))
    ) {
      throw invariantError(
        `Protected target ${target.id} has an invalid layer, lens, or current answer.`,
      );
    }
  }

  const lenses = snapshot.targets.filter((target) => target.layer === "LENS");
  const lensBoundary = lenses.map((target) =>
    canonicalJson({
      layer: target.layer,
      protectedStatus: target.protectedStatus,
      currentAnswer: target.currentAnswer,
      recordEffect: target.recordEffect,
    }),
  );
  if (new Set(lensBoundary).size !== 1) {
    throw invariantError(
      "Food, Money, and Sand must retain identical protected status, answer, and effect boundaries.",
    );
  }

  return deepFreeze(snapshot);
}

function canonicalize(value) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw invariantError("Non-finite numbers cannot be hashed.");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (isPlainObject(value)) {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) {
        output[key] = canonicalize(value[key]);
      }
    }
    return output;
  }
  throw invariantError("Only JSON values can be hashed.");
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export async function sha256Hex(value) {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) {
    throw invariantError(
      "SHA-256 is unavailable; the review queue cannot safely persist changes.",
    );
  }

  const bytes = new TextEncoder().encode(
    typeof value === "string" ? value : canonicalJson(value),
  );
  const digest = await cryptoApi.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function createEmptyQueue() {
  return {
    schemaVersion: QUEUE_SCHEMA_VERSION,
    storageScope: STORAGE_SCOPE,
    authorityEffect: RECORD_EFFECT,
    sharedMemoryEffect: SHARED_MEMORY_EFFECT,
    protectedRecordMutation: false,
    empiricalTruth: false,
    seededSubmissionCount: 0,
    revision: 0,
    submissions: [],
  };
}

export function displayStatus(status) {
  return STATUS_DISPLAY[status] || status;
}

export function isTerminalStatus(status) {
  return TERMINAL_SET.has(status);
}

export function getReviewPolicy(submissionOrDraft) {
  const submissionKind = normalizeEnum(
    submissionOrDraft.submissionKind ?? submissionOrDraft.itemType,
    ITEM_TYPES,
    "Submission kind",
  );
  const targetId = normalizeEnum(
    submissionOrDraft.targetId ?? submissionOrDraft.target,
    REVIEW_TARGETS,
    "Target",
    {
      "shared foundation": "SHARED_FOUNDATION",
      "shared-foundation": "SHARED_FOUNDATION",
      foundation: "SHARED_FOUNDATION",
    },
  );
  const researchLabel = submissionOrDraft.researchLabel
    ? normalizeEnum(
        submissionOrDraft.researchLabel,
        RESEARCH_LABELS,
        "Research label",
        {
          "unknown / not estimable": "UNKNOWN / NOT ESTIMABLE",
        },
      )
    : "";

  if (
    targetId === "SHARED_FOUNDATION" ||
    submissionKind === "EVIDENCE" ||
    submissionKind === "FINDING" ||
    researchLabel === "EVIDENCE"
  ) {
    return cloneValue(REVIEW_POLICIES.CONSEQUENTIAL_CHANGE);
  }

  return cloneValue(REVIEW_POLICIES.ROUTINE_ADDITION);
}

export function deriveChangeType(submissionOrDraft) {
  const policy = getReviewPolicy(submissionOrDraft);
  if (
    (submissionOrDraft.targetId ?? submissionOrDraft.target) ===
    "SHARED_FOUNDATION"
  ) {
    return "SHARED_CITY_DEFINITION";
  }
  if (policy.id === "CONSEQUENTIAL_CHANGE") {
    return "EVIDENCE_BACKED_FINDING";
  }
  return "ROUTINE_NOTE";
}

export function normalizeDraftInput(input) {
  requirePlainObject(input, "Draft");

  const submissionKind = normalizeEnum(
    input.submissionKind ?? input.itemType,
    ITEM_TYPES,
    "Submission kind",
  );
  const targetId = normalizeEnum(
    input.targetId ?? input.target,
    REVIEW_TARGETS,
    "Target",
    {
      "shared foundation": "SHARED_FOUNDATION",
      "shared-foundation": "SHARED_FOUNDATION",
      foundation: "SHARED_FOUNDATION",
    },
  );
  const researchLabel = normalizeEnum(
    input.researchLabel,
    RESEARCH_LABELS,
    "Research label",
    {
      evidence: "EVIDENCE",
      derived: "DERIVED",
      assumption: "ASSUMPTION",
      hypothesis: "HYPOTHESIS",
      proposal: "PROPOSAL",
      "unknown / not estimable": "UNKNOWN / NOT ESTIMABLE",
      unknown: "UNKNOWN / NOT ESTIMABLE",
      approved: "APPROVED",
    },
  );

  const place = cleanText(input.place, "Place", {
    required: true,
    maxLength: QUEUE_LIMITS.shortText,
  });
  const time = cleanText(input.time, "Time", {
    required: true,
    maxLength: QUEUE_LIMITS.shortText,
  });
  const sourceRefs = normalizeStringArray(
    input.sourceRefs ?? input.sourceReferences,
    "Source reference",
  );
  if (sourceRefs.length === 0) {
    throw invariantError(
      "At least one source or method reference is required.",
    );
  }
  const missingEvidence = normalizeStringArray(
    input.missingEvidence,
    "Missing evidence",
  );

  const evidenceClaim =
    submissionKind === "EVIDENCE" || researchLabel === "EVIDENCE";
  if (
    evidenceClaim &&
    (UNKNOWN_PATTERN.test(place) || UNKNOWN_PATTERN.test(time))
  ) {
    throw invariantError(
      "EVIDENCE requires known place and time references; use another label while either remains unknown.",
    );
  }
  if (evidenceClaim && sourceRefs.length === 0) {
    throw invariantError("EVIDENCE requires at least one source reference.");
  }
  if (
    researchLabel === "UNKNOWN / NOT ESTIMABLE" &&
    missingEvidence.length === 0
  ) {
    throw invariantError(
      "UNKNOWN / NOT ESTIMABLE requires a missing-evidence note.",
    );
  }

  const supersedesSubmissionIdText = cleanText(
    input.supersedesSubmissionId,
    "Superseded submission ID",
    {
      maxLength: QUEUE_LIMITS.shortText,
    },
  );
  if (supersedesSubmissionIdText) {
    normalizeId(supersedesSubmissionIdText, "Superseded submission ID");
  }

  const normalized = {
    submissionKind,
    targetId,
    title: cleanText(input.title, "Title", {
      required: true,
      maxLength: QUEUE_LIMITS.shortText,
    }),
    statement: cleanText(input.statement, "Statement", {
      required: true,
      maxLength: QUEUE_LIMITS.longText,
    }),
    proposedChangeSummary: cleanText(
      input.proposedChangeSummary,
      "Proposed change summary",
      {
        required: true,
        maxLength: QUEUE_LIMITS.longText,
      },
    ),
    researchLabel,
    nativeLabel:
      cleanText(input.nativeLabel, "Native label", {
        maxLength: QUEUE_LIMITS.shortText,
      }) || null,
    place,
    time,
    uncertaintyOrCompetition: cleanText(
      input.uncertaintyOrCompetition ?? input.conflictNotes,
      "Uncertainty or competing account",
      {
        required: true,
        maxLength: QUEUE_LIMITS.longText,
      },
    ),
    missingEvidence,
    nextTestOrReview: cleanText(
      input.nextTestOrReview ?? input.nextTest,
      "Next test or review",
      {
        required: true,
        maxLength: QUEUE_LIMITS.longText,
      },
    ),
    sourceRefs,
    submittedByDescriptor: cleanText(
      input.submittedByDescriptor ?? input.contributorDescriptor,
      "Contributor descriptor",
      {
        required: true,
        maxLength: QUEUE_LIMITS.shortText,
      },
    ),
    exactReason: cleanText(input.exactReason, "Exact submission reason", {
      required: true,
      maxLength: QUEUE_LIMITS.longText,
    }),
    preservesOriginal: true,
    recordEffect: RECORD_EFFECT,
    supersedesSubmissionId: supersedesSubmissionIdText || null,
  };
  normalized.changeType = deriveChangeType(normalized);
  normalized.reviewClass = getReviewPolicy(normalized).id;
  return normalized;
}

function immutableSubmissionPayload(submission) {
  return {
    schemaVersion: submission.schemaVersion,
    id: submission.id,
    familyId: submission.familyId,
    versionNumber: submission.versionNumber,
    supersedesSubmissionId: submission.supersedesSubmissionId,
    submittedAt: submission.submittedAt,
    submissionKind: submission.submissionKind,
    targetId: submission.targetId,
    targetRecordId: submission.targetRecordId,
    targetRecordVersion: submission.targetRecordVersion,
    targetRecordSha256: submission.targetRecordSha256,
    targetClaimId: submission.targetClaimId,
    layer: submission.layer,
    lens: submission.lens,
    protectedStatus: submission.protectedStatus,
    currentAnswer: submission.currentAnswer,
    targetRecordEffect: submission.targetRecordEffect,
    changeType: submission.changeType,
    reviewClass: submission.reviewClass,
    title: submission.title,
    statement: submission.statement,
    proposedChangeSummary: submission.proposedChangeSummary,
    researchLabel: submission.researchLabel,
    nativeLabel: submission.nativeLabel,
    place: submission.place,
    time: submission.time,
    uncertaintyOrCompetition: submission.uncertaintyOrCompetition,
    missingEvidence: submission.missingEvidence,
    nextTestOrReview: submission.nextTestOrReview,
    sourceRefs: submission.sourceRefs,
    submittedByDescriptor: submission.submittedByDescriptor,
    exactReason: submission.exactReason,
    preservesOriginal: submission.preservesOriginal,
    recordEffect: submission.recordEffect,
    reviewPolicy: submission.reviewPolicy,
    authorityEffect: submission.authorityEffect,
    sharedMemoryEffect: submission.sharedMemoryEffect,
    protectedRecordMutation: submission.protectedRecordMutation,
    empiricalTruth: submission.empiricalTruth,
  };
}

function ledgerRecordPayload(record) {
  const payload = { ...record };
  delete payload.hash;
  return payload;
}

async function appendLedgerRecord(submission, record) {
  const records = [...submission.events, ...submission.decisions].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const priorHash =
    records.length > 0 ? records[records.length - 1].hash : submission.contentHash;
  const nextRecord = {
    ...record,
    sequence: records.length + 1,
    previousHash: priorHash,
    recordEffect: RECORD_EFFECT,
    authorityEffect: RECORD_EFFECT,
    sharedMemoryEffect: SHARED_MEMORY_EFFECT,
    protectedRecordMutation: false,
    empiricalTruth: false,
  };
  nextRecord.hash = await sha256Hex(ledgerRecordPayload(nextRecord));
  return nextRecord;
}

function normalizeMutationOptions(queue, options = {}) {
  requirePlainObject(options, "Mutation options");
  const expectedRevision =
    options.expectedRevision === undefined
      ? queue.revision
      : Number(options.expectedRevision);
  if (
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 0 ||
    expectedRevision !== queue.revision
  ) {
    throw conflictError(
      `Queue revision changed: expected ${String(options.expectedRevision)}, current ${queue.revision}. Reload before retrying.`,
    );
  }

  const now =
    typeof options.now === "function"
      ? options.now
      : () => new Date().toISOString();
  const makeId =
    typeof options.makeId === "function"
      ? options.makeId
      : (prefix) => {
          const random =
            globalThis.crypto?.randomUUID?.() ||
            `${Date.now()}-${Math.random().toString(16).slice(2)}`;
          return `${prefix}-${random}`;
        };

  const config = getWorkingReviewConfig(options.config);
  return { expectedRevision, now, makeId, config };
}

function nextQueue(queue) {
  const next = cloneValue(queue);
  next.revision += 1;
  return next;
}

function findSubmission(queue, submissionId) {
  const id = normalizeId(submissionId, "Submission ID");
  const index = queue.submissions.findIndex((submission) => submission.id === id);
  if (index < 0) {
    throw invariantError(`Submission ${id} does not exist.`);
  }
  return { id, index, submission: queue.submissions[index] };
}

export async function createDraft(queue, input, options = {}) {
  const deps = normalizeMutationOptions(queue, options);
  await validateQueue(queue, { config: deps.config });
  const normalized = normalizeDraftInput(input);
  const next = nextQueue(queue);

  if (next.submissions.length >= QUEUE_LIMITS.submissions) {
    throw invariantError(
      `The local queue is limited to ${QUEUE_LIMITS.submissions} submissions.`,
    );
  }

  let superseded = null;
  if (normalized.supersedesSubmissionId) {
    superseded = findSubmission(next, normalized.supersedesSubmissionId).submission;
  }

  const id = normalizeId(
    deps.makeId("submission"),
    "Generated submission ID",
  );
  if (next.submissions.some((submission) => submission.id === id)) {
    throw invariantError(`Generated submission ID ${id} already exists.`);
  }

  const target = deps.config.targets.find(
    (candidate) => candidate.id === normalized.targetId,
  );
  if (!target) {
    throw invariantError(
      `Protected target ${normalized.targetId} is unavailable.`,
    );
  }
  const submittedAt = normalizeTimestamp(
    deps.now(),
    "Submission timestamp",
  );
  const submission = {
    schemaVersion: QUEUE_SCHEMA_VERSION,
    id,
    familyId: superseded ? superseded.familyId : id,
    versionNumber: superseded ? superseded.versionNumber + 1 : 1,
    supersedesSubmissionId: superseded?.id || null,
    submittedAt,
    ...normalized,
    targetRecordId: target.targetRecordId,
    targetRecordVersion: target.targetRecordVersion,
    targetRecordSha256: target.targetRecordSha256,
    targetClaimId: null,
    layer: target.layer,
    lens: target.lens,
    protectedStatus: target.protectedStatus,
    currentAnswer: target.currentAnswer,
    targetRecordEffect: target.recordEffect,
    reviewPolicy: getReviewPolicy(normalized),
    status: "DRAFT",
    revision: 1,
    authorityEffect: RECORD_EFFECT,
    sharedMemoryEffect: SHARED_MEMORY_EFFECT,
    protectedRecordMutation: false,
    empiricalTruth: false,
    contentHash: "",
    events: [],
    decisions: [],
  };
  submission.contentHash = await sha256Hex(
    immutableSubmissionPayload(submission),
  );
  const createdEvent = await appendLedgerRecord(submission, {
    kind: "DRAFT_CREATED",
    id: normalizeId(deps.makeId("event"), "Generated event ID"),
    at: submittedAt,
    fromStatus: null,
    toStatus: "DRAFT",
    actorDescriptor: submission.submittedByDescriptor,
    rationale:
      submission.supersedesSubmissionId
        ? `New immutable version linked to ${submission.supersedesSubmissionId}.`
        : submission.exactReason,
  });
  submission.events.push(createdEvent);
  next.submissions.push(submission);
  await validateQueue(next, { config: deps.config });
  return next;
}

export async function submitForReview(
  queue,
  submissionId,
  input = {},
  options = {},
) {
  const deps = normalizeMutationOptions(queue, options);
  await validateQueue(queue, { config: deps.config });
  requirePlainObject(input, "Review submission");
  const next = nextQueue(queue);
  const { index, submission: current } = findSubmission(next, submissionId);

  if (current.status !== "DRAFT") {
    throw invariantError("Only a DRAFT can be sent to pending review.");
  }

  const submission = cloneValue(current);
  const at = normalizeTimestamp(deps.now(), "Review-start timestamp");
  const actorDescriptor = cleanText(
    input.actorDescriptor ??
      input.submittedByDescriptor ??
      input.contributorDescriptor,
    "Contributor descriptor",
    {
      maxLength: QUEUE_LIMITS.shortText,
      fallback: current.submittedByDescriptor || DEFAULT_CONTRIBUTOR,
    },
  );
  const rationale = cleanText(
    input.exactReason ?? input.rationale,
    "Review-start rationale",
    {
      maxLength: QUEUE_LIMITS.longText,
      fallback: "Submitted to the local pending review queue.",
    },
  );
  const event = await appendLedgerRecord(submission, {
    kind: "REVIEW_STARTED",
    id: normalizeId(deps.makeId("event"), "Generated event ID"),
    at,
    fromStatus: "DRAFT",
    toStatus: "UNDER_REVIEW",
    actorDescriptor,
    rationale,
  });
  submission.events.push(event);
  submission.status = "UNDER_REVIEW";
  submission.revision += 1;
  next.submissions[index] = submission;
  await validateQueue(next, { config: deps.config });
  return next;
}

export function normalizeDecisionInput(input) {
  requirePlainObject(input, "Decision");
  const proposedOutcome = normalizeEnum(
    input.proposedOutcome ?? input.outcome,
    DECISION_OUTCOMES,
    "Decision outcome",
    {
      accept: "APPROVED",
      accepted: "APPROVED",
      approved: "APPROVED",
      amend: "AMENDED",
      amended: "AMENDED",
      hold: "HELD",
      held: "HELD",
      reject: "REJECTED",
      rejected: "REJECTED",
      supersede: "SUPERSEDED",
      superseded: "SUPERSEDED",
    },
  );
  const reviewerSlot = Number(input.reviewerSlot);
  if (
    !Number.isSafeInteger(reviewerSlot) ||
    reviewerSlot < 1 ||
    reviewerSlot > 3
  ) {
    throw invariantError("Reviewer slot must be 1, 2, or 3.");
  }

  const exactReason = cleanText(
    input.exactReason ?? input.rationale ?? input.decisionRationale,
    "Decision rationale",
    {
      required: true,
      maxLength: QUEUE_LIMITS.longText,
    },
  );
  const requiredChanges = normalizeStringArray(
    input.requiredChanges,
    "Required changes",
  );
  if (proposedOutcome === "AMENDED" && requiredChanges.length === 0) {
    throw invariantError("AMENDED requires at least one required change.");
  }
  if (proposedOutcome !== "AMENDED" && requiredChanges.length > 0) {
    throw invariantError(
      "Required changes are allowed only for an AMENDED decision.",
    );
  }

  const relatedSubmissionIdText = cleanText(
    input.relatedSubmissionId ?? input.replacementSubmissionId,
    "Replacement submission ID",
    {
      maxLength: QUEUE_LIMITS.shortText,
    },
  );
  if (proposedOutcome === "SUPERSEDED" && !relatedSubmissionIdText) {
    throw invariantError(
      "SUPERSEDE requires an existing replacement submission.",
    );
  }
  if (relatedSubmissionIdText) {
    normalizeId(relatedSubmissionIdText, "Replacement submission ID");
  }
  if (proposedOutcome !== "SUPERSEDED" && relatedSubmissionIdText) {
    throw invariantError(
      "Only a SUPERSEDE decision may identify a replacement submission.",
    );
  }

  return {
    proposedOutcome,
    reviewerSlot,
    reviewerDescriptor: cleanText(
      input.reviewerDescriptor,
      "Reviewer descriptor",
      {
        required: true,
        maxLength: QUEUE_LIMITS.shortText,
      },
    ),
    exactReason,
    requiredChanges,
    relatedSubmissionId: relatedSubmissionIdText || null,
  };
}

export function decisionTallies(submission) {
  const tallies = Object.fromEntries(
    DECISION_OUTCOMES.map((outcome) => [outcome, 0]),
  );
  const supersededByReplacement = new Map();
  for (const decision of submission.decisions) {
    if (decision.proposedOutcome === "SUPERSEDED") {
      const replacementId = decision.relatedSubmissionId || "";
      supersededByReplacement.set(
        replacementId,
        (supersededByReplacement.get(replacementId) || 0) + 1,
      );
    } else {
      tallies[decision.proposedOutcome] += 1;
    }
  }
  tallies.SUPERSEDED = Math.max(0, ...supersededByReplacement.values());
  return tallies;
}

function decisionPositionKey(decision) {
  return decision.proposedOutcome === "SUPERSEDED"
    ? `SUPERSEDED:${decision.relatedSubmissionId || "MISSING_REPLACEMENT"}`
    : decision.proposedOutcome;
}

function concurrenceForDecision(submission, decision) {
  const position = decisionPositionKey(decision);
  return submission.decisions.filter(
    (candidate) => decisionPositionKey(candidate) === position,
  ).length;
}

export function hasDecisionConflict(submission) {
  return (
    new Set(submission.decisions.map(decisionPositionKey)).size > 1
  );
}

export async function recordDecision(
  queue,
  submissionId,
  input,
  options = {},
) {
  const deps = normalizeMutationOptions(queue, options);
  await validateQueue(queue, { config: deps.config });
  const normalized = normalizeDecisionInput(input);
  const next = nextQueue(queue);
  const { index, submission: current } = findSubmission(next, submissionId);

  if (current.status !== "UNDER_REVIEW") {
    throw invariantError(
      "Decisions can be recorded only while a submission is UNDER_REVIEW.",
    );
  }
  if (
    current.decisions.some(
      (decision) => decision.reviewerSlot === normalized.reviewerSlot,
    )
  ) {
    throw invariantError(
      `Reviewer slot ${normalized.reviewerSlot} already has an immutable decision.`,
    );
  }
  if (
    current.decisions.some(
      (decision) =>
        decision.reviewerDescriptor.toLocaleLowerCase() ===
        normalized.reviewerDescriptor.toLocaleLowerCase(),
    )
  ) {
    throw invariantError(
      "Reviewer descriptor already has an immutable decision for this submission.",
    );
  }

  if (normalized.proposedOutcome === "SUPERSEDED") {
    const replacement = findSubmission(
      next,
      normalized.relatedSubmissionId,
    ).submission;
    if (replacement.id === current.id) {
      throw invariantError("A submission cannot supersede itself.");
    }
    if (replacement.supersedesSubmissionId !== current.id) {
      throw invariantError(
        "The replacement must be a new immutable version linked to this submission.",
      );
    }
  }

  const submission = cloneValue(current);
  const at = normalizeTimestamp(deps.now(), "Decision timestamp");
  const decision = await appendLedgerRecord(submission, {
    kind: "REVIEW_DECISION",
    schemaVersion: QUEUE_SCHEMA_VERSION,
    id: normalizeId(deps.makeId("decision"), "Generated decision ID"),
    at,
    createdAt: at,
    submissionId: submission.id,
    submissionSha256: submission.contentHash,
    targetRecordSha256: submission.targetRecordSha256,
    ...normalized,
    authorityStatus: AUTHORITY_STATUS,
    labelAssessment: submission.researchLabel,
    nativeLabelAssessment: submission.nativeLabel,
    placeAssessment: submission.place,
    timeAssessment: submission.time,
    sourceRefs: cloneValue(submission.sourceRefs),
    policyId: deps.config.policy.policyId,
    recordEffect: RECORD_EFFECT,
  });
  submission.decisions.push(decision);

  const threshold = submission.reviewPolicy.requiredConcurringDecisions;
  const concurrence = concurrenceForDecision(submission, decision);
  if (concurrence >= threshold) {
    const terminalStatus = OUTCOME_TO_STATUS[normalized.proposedOutcome];
    const event = await appendLedgerRecord(submission, {
      kind: "REVIEW_CONCLUDED",
      id: normalizeId(deps.makeId("event"), "Generated event ID"),
      at,
      fromStatus: "UNDER_REVIEW",
      toStatus: terminalStatus,
      actorDescriptor: normalized.reviewerDescriptor,
      rationale: `Conditional local prototype threshold reached: ${concurrence} of ${threshold} ${normalized.proposedOutcome} decision(s)${normalized.proposedOutcome === "SUPERSEDED" ? ` naming ${normalized.relatedSubmissionId}` : ""}.`,
      triggeringDecisionId: decision.id,
      relatedSubmissionId:
        normalized.proposedOutcome === "SUPERSEDED"
          ? normalized.relatedSubmissionId
          : null,
    });
    submission.events.push(event);
    submission.status = terminalStatus;
  }

  submission.revision += 1;
  next.submissions[index] = submission;
  await validateQueue(next, { config: deps.config });
  return next;
}

export async function createRevisedDraft(
  queue,
  sourceSubmissionId,
  overrides = {},
  options = {},
) {
  const config = getWorkingReviewConfig(options.config);
  await validateQueue(queue, { config });
  requirePlainObject(overrides, "Revision overrides");
  const source = findSubmission(queue, sourceSubmissionId).submission;

  const input = {
    submissionKind: source.submissionKind,
    targetId: source.targetId,
    title: source.title,
    statement: source.statement,
    proposedChangeSummary: source.proposedChangeSummary,
    researchLabel: source.researchLabel,
    nativeLabel: source.nativeLabel,
    place: source.place,
    time: source.time,
    uncertaintyOrCompetition: source.uncertaintyOrCompetition,
    missingEvidence: source.missingEvidence,
    nextTestOrReview: source.nextTestOrReview,
    sourceRefs: source.sourceRefs,
    submittedByDescriptor: source.submittedByDescriptor,
    exactReason: `New immutable version of ${source.id}: ${source.exactReason}`,
    ...overrides,
    supersedesSubmissionId: source.id,
  };
  return createDraft(queue, input, { ...options, config });
}

function assertExactInvariant(value, expected, label) {
  if (value !== expected) {
    throw invariantError(`${label} must remain ${JSON.stringify(expected)}.`);
  }
}

function assertAllowedKeys(value, allowed, label) {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length > 0) {
    throw invariantError(
      `${label} contains unsupported field(s): ${extras.sort().join(", ")}.`,
    );
  }
}

function assertSafeInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw invariantError(`${label} must be an integer of at least ${minimum}.`);
  }
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) {
    throw invariantError(`${label} must be unique.`);
  }
}

async function validateSubmission(submission, knownSubmissionIds, config) {
  requirePlainObject(submission, "Submission");
  assertAllowedKeys(
    submission,
    [
      "schemaVersion",
      "id",
      "familyId",
      "versionNumber",
      "supersedesSubmissionId",
      "submittedAt",
      "submissionKind",
      "targetId",
      "targetRecordId",
      "targetRecordVersion",
      "targetRecordSha256",
      "targetClaimId",
      "layer",
      "lens",
      "protectedStatus",
      "currentAnswer",
      "targetRecordEffect",
      "changeType",
      "reviewClass",
      "title",
      "statement",
      "proposedChangeSummary",
      "researchLabel",
      "nativeLabel",
      "place",
      "time",
      "uncertaintyOrCompetition",
      "missingEvidence",
      "nextTestOrReview",
      "sourceRefs",
      "submittedByDescriptor",
      "exactReason",
      "preservesOriginal",
      "recordEffect",
      "reviewPolicy",
      "status",
      "revision",
      "authorityEffect",
      "sharedMemoryEffect",
      "protectedRecordMutation",
      "empiricalTruth",
      "contentHash",
      "events",
      "decisions",
    ],
    "Submission",
  );
  assertExactInvariant(
    submission.schemaVersion,
    QUEUE_SCHEMA_VERSION,
    "Submission schema version",
  );
  normalizeId(submission.id, "Submission ID");
  normalizeId(submission.familyId, "Submission family ID");
  assertSafeInteger(submission.versionNumber, "Submission version number", 1);
  normalizeTimestamp(submission.submittedAt, "Submission timestamp");
  normalizeEnum(
    submission.submissionKind,
    ITEM_TYPES,
    "Submission kind",
  );
  normalizeEnum(submission.targetId, REVIEW_TARGETS, "Submission target");
  normalizeEnum(
    submission.researchLabel,
    RESEARCH_LABELS,
    "Submission research label",
    { "unknown / not estimable": "UNKNOWN / NOT ESTIMABLE" },
  );
  const normalizedDraft = normalizeDraftInput(submission);
  for (const field of [
    "submissionKind",
    "targetId",
    "title",
    "statement",
    "proposedChangeSummary",
    "researchLabel",
    "nativeLabel",
    "place",
    "time",
    "uncertaintyOrCompetition",
    "missingEvidence",
    "nextTestOrReview",
    "sourceRefs",
    "submittedByDescriptor",
    "exactReason",
    "preservesOriginal",
    "recordEffect",
    "supersedesSubmissionId",
    "changeType",
    "reviewClass",
  ]) {
    if (
      canonicalJson(submission[field]) !== canonicalJson(normalizedDraft[field])
    ) {
      throw invariantError(
        `Submission ${submission.id} field ${field} is not canonical.`,
      );
    }
  }

  const target = config.targets.find(
    (candidate) => candidate.id === submission.targetId,
  );
  if (!target) {
    throw invariantError(
      `Submission ${submission.id} identifies an unavailable target.`,
    );
  }
  for (const field of [
    "targetRecordId",
    "targetRecordVersion",
    "targetRecordSha256",
    "layer",
    "lens",
    "protectedStatus",
    "currentAnswer",
  ]) {
    assertExactInvariant(
      submission[field],
      target[field],
      `Submission protected target ${field}`,
    );
  }
  assertExactInvariant(
    submission.targetRecordEffect,
    target.recordEffect,
    "Submission protected target record effect",
  );
  assertExactInvariant(
    submission.targetClaimId,
    null,
    "Submission target claim ID",
  );

  if (
    submission.supersedesSubmissionId &&
    !knownSubmissionIds.has(submission.supersedesSubmissionId)
  ) {
    throw invariantError(
      `Submission ${submission.id} links to an absent prior submission.`,
    );
  }
  if (submission.supersedesSubmissionId === submission.id) {
    throw invariantError("A submission cannot link to itself.");
  }

  const expectedPolicy = getReviewPolicy(submission);
  requirePlainObject(submission.reviewPolicy, "Review policy");
  assertAllowedKeys(
    submission.reviewPolicy,
    [
      "id",
      "requiredConcurringDecisions",
      "reviewerSlots",
      "authority",
    ],
    "Review policy",
  );
  if (canonicalJson(submission.reviewPolicy) !== canonicalJson(expectedPolicy)) {
    throw invariantError(
      `Submission ${submission.id} has an altered review policy.`,
    );
  }
  normalizeEnum(
    submission.status,
    WORKFLOW_STATUSES,
    "Submission workflow status",
  );
  assertSafeInteger(submission.revision, "Submission revision", 1);
  assertExactInvariant(
    submission.authorityEffect,
    RECORD_EFFECT,
    "Submission authority effect",
  );
  assertExactInvariant(
    submission.sharedMemoryEffect,
    SHARED_MEMORY_EFFECT,
    "Submission shared-memory effect",
  );
  assertExactInvariant(
    submission.protectedRecordMutation,
    false,
    "Submission protected-record mutation",
  );
  assertExactInvariant(
    submission.empiricalTruth,
    false,
    "Submission empirical-truth flag",
  );

  if (!Array.isArray(submission.events) || !Array.isArray(submission.decisions)) {
    throw invariantError(
      `Submission ${submission.id} history must contain event and decision arrays.`,
    );
  }
  if (
    submission.events.length + submission.decisions.length >
    QUEUE_LIMITS.ledgerEntriesPerSubmission
  ) {
    throw invariantError(
      `Submission ${submission.id} exceeds the local history limit.`,
    );
  }

  const calculatedContentHash = await sha256Hex(
    immutableSubmissionPayload(submission),
  );
  if (submission.contentHash !== calculatedContentHash) {
    throw invariantError(
      `Submission ${submission.id} immutable content hash does not match.`,
    );
  }

  const ledger = [...submission.events, ...submission.decisions].sort(
    (left, right) => left.sequence - right.sequence,
  );
  if (ledger.length === 0) {
    throw invariantError(`Submission ${submission.id} has no creation event.`);
  }
  assertUnique(
    ledger.map((record) => record.id),
    `Submission ${submission.id} ledger IDs`,
  );

  let previousHash = submission.contentHash;
  for (let index = 0; index < ledger.length; index += 1) {
    const record = ledger[index];
    requirePlainObject(record, "History record");
    const baseRecordKeys = [
      "kind",
      "id",
      "at",
      "sequence",
      "previousHash",
      "recordEffect",
      "authorityEffect",
      "sharedMemoryEffect",
      "protectedRecordMutation",
      "empiricalTruth",
      "hash",
    ];
    const allowedRecordKeys =
      record.kind === "REVIEW_DECISION"
        ? [
            ...baseRecordKeys,
            "schemaVersion",
            "createdAt",
            "submissionId",
            "submissionSha256",
            "targetRecordSha256",
            "proposedOutcome",
            "reviewerSlot",
            "reviewerDescriptor",
            "authorityStatus",
            "exactReason",
            "requiredChanges",
            "relatedSubmissionId",
            "labelAssessment",
            "nativeLabelAssessment",
            "placeAssessment",
            "timeAssessment",
            "sourceRefs",
            "policyId",
            "recordEffect",
          ]
        : [
            ...baseRecordKeys,
            "fromStatus",
            "toStatus",
            "actorDescriptor",
            "rationale",
            ...(record.kind === "REVIEW_CONCLUDED"
              ? ["triggeringDecisionId", "relatedSubmissionId"]
              : []),
          ];
    assertAllowedKeys(record, allowedRecordKeys, "History record");
    normalizeId(record.id, "History record ID");
    normalizeTimestamp(record.at, "History timestamp");
    if (record.kind === "REVIEW_DECISION") {
      cleanText(record.exactReason, "Decision rationale", {
        required: true,
        maxLength: QUEUE_LIMITS.longText,
      });
    } else {
      cleanText(record.rationale, "History rationale", {
        required: true,
        maxLength: QUEUE_LIMITS.longText,
      });
      cleanText(record.actorDescriptor, "History actor descriptor", {
        required: true,
        maxLength: QUEUE_LIMITS.shortText,
      });
    }
    assertExactInvariant(
      record.sequence,
      index + 1,
      "History sequence",
    );
    assertExactInvariant(
      record.previousHash,
      previousHash,
      "History previous hash",
    );
    assertExactInvariant(
      record.recordEffect,
      RECORD_EFFECT,
      "History record effect",
    );
    assertExactInvariant(
      record.authorityEffect,
      RECORD_EFFECT,
      "History authority effect",
    );
    assertExactInvariant(
      record.sharedMemoryEffect,
      SHARED_MEMORY_EFFECT,
      "History shared-memory effect",
    );
    assertExactInvariant(
      record.protectedRecordMutation,
      false,
      "History protected-record mutation",
    );
    assertExactInvariant(
      record.empiricalTruth,
      false,
      "History empirical-truth flag",
    );
    const expectedHash = await sha256Hex(ledgerRecordPayload(record));
    if (record.hash !== expectedHash) {
      throw invariantError(
        `Submission ${submission.id} history hash ${record.id} does not match.`,
      );
    }
    previousHash = record.hash;
  }

  const creationEvents = submission.events.filter(
    (event) => event.kind === "DRAFT_CREATED",
  );
  if (
    creationEvents.length !== 1 ||
    creationEvents[0].sequence !== 1 ||
    creationEvents[0].fromStatus !== null ||
    creationEvents[0].toStatus !== "DRAFT"
  ) {
    throw invariantError(
      `Submission ${submission.id} must begin with one DRAFT_CREATED event.`,
    );
  }

  for (const decision of submission.decisions) {
    if (decision.kind !== "REVIEW_DECISION") {
      throw invariantError(
        `Submission ${submission.id} contains an invalid decision record.`,
      );
    }
    const normalizedDecision = normalizeDecisionInput(decision);
    for (const field of [
      "proposedOutcome",
      "reviewerSlot",
      "reviewerDescriptor",
      "exactReason",
      "requiredChanges",
      "relatedSubmissionId",
    ]) {
      if (
        canonicalJson(decision[field]) !==
        canonicalJson(normalizedDecision[field])
      ) {
        throw invariantError(
          `Decision ${decision.id} field ${field} is not canonical.`,
        );
      }
    }
    assertExactInvariant(
      decision.submissionId,
      submission.id,
      "Decision submission ID",
    );
    assertExactInvariant(
      decision.schemaVersion,
      QUEUE_SCHEMA_VERSION,
      "Decision schema version",
    );
    assertExactInvariant(
      decision.createdAt,
      decision.at,
      "Decision creation timestamp",
    );
    assertExactInvariant(
      decision.submissionSha256,
      submission.contentHash,
      "Decision submission SHA-256",
    );
    assertExactInvariant(
      decision.targetRecordSha256,
      submission.targetRecordSha256,
      "Decision target SHA-256",
    );
    assertExactInvariant(
      decision.authorityStatus,
      AUTHORITY_STATUS,
      "Decision authority status",
    );
    assertExactInvariant(
      decision.labelAssessment,
      submission.researchLabel,
      "Decision label assessment",
    );
    assertExactInvariant(
      decision.nativeLabelAssessment,
      submission.nativeLabel,
      "Decision native-label assessment",
    );
    assertExactInvariant(
      decision.placeAssessment,
      submission.place,
      "Decision place assessment",
    );
    assertExactInvariant(
      decision.timeAssessment,
      submission.time,
      "Decision time assessment",
    );
    if (canonicalJson(decision.sourceRefs) !== canonicalJson(submission.sourceRefs)) {
      throw invariantError(
        `Decision ${decision.id} source references differ from the immutable submission.`,
      );
    }
    assertExactInvariant(
      decision.policyId,
      config.policy.policyId,
      "Decision policy ID",
    );
    assertExactInvariant(
      decision.recordEffect,
      RECORD_EFFECT,
      "Decision record effect",
    );
  }
  assertUnique(
    submission.decisions.map((decision) => decision.reviewerSlot),
    `Submission ${submission.id} reviewer slots`,
  );
  assertUnique(
    submission.decisions.map((decision) =>
      decision.reviewerDescriptor.toLocaleLowerCase(),
    ),
    `Submission ${submission.id} reviewer descriptors`,
  );

  let derivedStatus = null;
  let terminalConclusionSeen = false;
  const sequencedDecisions = new Map();
  for (const record of ledger) {
    if (terminalConclusionSeen) {
      throw invariantError(
        `Submission ${submission.id} contains history after its terminal conclusion.`,
      );
    }

    if (record.kind === "DRAFT_CREATED") {
      if (record.sequence !== 1 || derivedStatus !== null) {
        throw invariantError(
          `Submission ${submission.id} has an invalid draft-creation position.`,
        );
      }
      derivedStatus = "DRAFT";
      continue;
    }

    if (record.kind === "REVIEW_STARTED") {
      if (
        derivedStatus !== "DRAFT" ||
        record.fromStatus !== "DRAFT" ||
        record.toStatus !== "UNDER_REVIEW"
      ) {
        throw invariantError(
          `Submission ${submission.id} has an invalid review-start transition.`,
        );
      }
      derivedStatus = "UNDER_REVIEW";
      continue;
    }

    if (record.kind === "REVIEW_DECISION") {
      if (derivedStatus !== "UNDER_REVIEW") {
        throw invariantError(
          `Submission ${submission.id} contains a decision outside UNDER_REVIEW.`,
        );
      }
      sequencedDecisions.set(record.id, record);
      continue;
    }

    if (record.kind === "REVIEW_CONCLUDED") {
      if (
        derivedStatus !== "UNDER_REVIEW" ||
        record.fromStatus !== "UNDER_REVIEW" ||
        !isTerminalStatus(record.toStatus)
      ) {
        throw invariantError(
          `Submission ${submission.id} has an invalid terminal transition.`,
        );
      }
      const triggeringDecision = sequencedDecisions.get(
        record.triggeringDecisionId,
      );
      if (
        !triggeringDecision ||
        triggeringDecision.sequence >= record.sequence ||
        OUTCOME_TO_STATUS[triggeringDecision.proposedOutcome] !==
          record.toStatus ||
        concurrenceForDecision(submission, triggeringDecision) <
          submission.reviewPolicy.requiredConcurringDecisions
      ) {
        throw invariantError(
          `Submission ${submission.id} conclusion must follow and point to its triggering decision.`,
        );
      }
      const expectedRelatedSubmissionId =
        triggeringDecision.proposedOutcome === "SUPERSEDED"
          ? triggeringDecision.relatedSubmissionId
          : null;
      if (record.relatedSubmissionId !== expectedRelatedSubmissionId) {
        throw invariantError(
          `Submission ${submission.id} conclusion has an invalid related submission.`,
        );
      }
      derivedStatus = record.toStatus;
      terminalConclusionSeen = true;
      continue;
    }

    throw invariantError(
      `Submission ${submission.id} contains an invalid workflow record.`,
    );
  }

  if (derivedStatus !== submission.status) {
    throw invariantError(
      `Submission ${submission.id} stored status does not match its immutable history.`,
    );
  }
  if (isTerminalStatus(derivedStatus)) {
    const concludingEvents = submission.events.filter(
      (event) => event.kind === "REVIEW_CONCLUDED",
    );
    if (concludingEvents.length !== 1) {
      throw invariantError(
        `Terminal submission ${submission.id} must have one conclusion event.`,
      );
    }
    const expectedOutcome = Object.entries(OUTCOME_TO_STATUS).find(
      ([, status]) => status === derivedStatus,
    )?.[0];
    const tallies = decisionTallies(submission);
    if (
      !expectedOutcome ||
      tallies[expectedOutcome] <
        submission.reviewPolicy.requiredConcurringDecisions
    ) {
      throw invariantError(
        `Terminal submission ${submission.id} lacks the required concurring decisions.`,
      );
    }
    const conclusion = concludingEvents[0];
    const triggeringDecision = submission.decisions.find(
      (decision) => decision.id === conclusion.triggeringDecisionId,
    );
    if (
      !triggeringDecision ||
      OUTCOME_TO_STATUS[triggeringDecision.proposedOutcome] !==
        derivedStatus ||
      concurrenceForDecision(submission, triggeringDecision) <
        submission.reviewPolicy.requiredConcurringDecisions ||
      conclusion.relatedSubmissionId !==
        (triggeringDecision.proposedOutcome === "SUPERSEDED"
          ? triggeringDecision.relatedSubmissionId
          : null)
    ) {
      throw invariantError(
        `Terminal submission ${submission.id} has an invalid triggering decision.`,
      );
    }
  } else if (derivedStatus === "UNDER_REVIEW") {
    const threshold = submission.reviewPolicy.requiredConcurringDecisions;
    if (
      Object.values(decisionTallies(submission)).some(
        (count) => count >= threshold,
      )
    ) {
      throw invariantError(
        `Submission ${submission.id} reached a decision threshold without a conclusion event.`,
      );
    }
  }

  const expectedRevision =
    1 +
    (submission.events.some((event) => event.kind === "REVIEW_STARTED")
      ? 1
      : 0) +
    submission.decisions.length;
  if (submission.revision !== expectedRevision) {
    throw invariantError(
      `Submission ${submission.id} revision does not match its append-only history.`,
    );
  }
}

export async function validateQueue(queue, options = {}) {
  requirePlainObject(queue, "Review queue");
  assertAllowedKeys(
    queue,
    [
      "schemaVersion",
      "storageScope",
      "authorityEffect",
      "sharedMemoryEffect",
      "protectedRecordMutation",
      "empiricalTruth",
      "seededSubmissionCount",
      "revision",
      "submissions",
    ],
    "Review queue",
  );
  assertExactInvariant(
    queue.schemaVersion,
    QUEUE_SCHEMA_VERSION,
    "Queue schema version",
  );
  assertExactInvariant(queue.storageScope, STORAGE_SCOPE, "Queue storage scope");
  assertExactInvariant(
    queue.authorityEffect,
    RECORD_EFFECT,
    "Queue authority effect",
  );
  assertExactInvariant(
    queue.sharedMemoryEffect,
    SHARED_MEMORY_EFFECT,
    "Queue shared-memory effect",
  );
  assertExactInvariant(
    queue.protectedRecordMutation,
    false,
    "Queue protected-record mutation",
  );
  assertExactInvariant(
    queue.empiricalTruth,
    false,
    "Queue empirical-truth flag",
  );
  assertExactInvariant(
    queue.seededSubmissionCount,
    0,
    "Queue seeded-submission count",
  );
  assertSafeInteger(queue.revision, "Queue revision");
  if (!Array.isArray(queue.submissions)) {
    throw invariantError("Queue submissions must be an array.");
  }
  if (queue.submissions.length > QUEUE_LIMITS.submissions) {
    throw invariantError(
      `Queue exceeds ${QUEUE_LIMITS.submissions} submissions.`,
    );
  }

  const ids = queue.submissions.map((submission) =>
    normalizeId(submission.id, "Submission ID"),
  );
  assertUnique(ids, "Submission IDs");
  const knownIds = new Set(ids);
  const config = getWorkingReviewConfig(options.config, {
    required: queue.submissions.length > 0,
  });
  for (const submission of queue.submissions) {
    await validateSubmission(submission, knownIds, config);
  }

  for (const submission of queue.submissions) {
    if (!submission.supersedesSubmissionId) {
      if (submission.familyId !== submission.id || submission.versionNumber !== 1) {
        throw invariantError(
          `Initial submission ${submission.id} has invalid version ancestry.`,
        );
      }
      continue;
    }
    const prior = queue.submissions.find(
      (candidate) => candidate.id === submission.supersedesSubmissionId,
    );
    if (
      !prior ||
      submission.familyId !== prior.familyId ||
      submission.versionNumber !== prior.versionNumber + 1
    ) {
      throw invariantError(
        `Submission ${submission.id} has invalid immutable version ancestry.`,
      );
    }
  }

  for (const submission of queue.submissions) {
    for (const decision of submission.decisions) {
      if (decision.proposedOutcome !== "SUPERSEDED") {
        continue;
      }
      const replacement = queue.submissions.find(
        (candidate) => candidate.id === decision.relatedSubmissionId,
      );
      if (
        !replacement ||
        replacement.id === submission.id ||
        replacement.supersedesSubmissionId !== submission.id
      ) {
        throw invariantError(
          `Submission ${submission.id} has an invalid SUPERSEDE replacement link.`,
        );
      }
    }
  }

  return true;
}

function utf8ByteLength(text) {
  return new TextEncoder().encode(text).byteLength;
}

export async function exportQueue(queue, options = {}) {
  await validateQueue(queue, options);
  const serialized = `${JSON.stringify(queue, null, 2)}\n`;
  if (utf8ByteLength(serialized) > QUEUE_LIMITS.importBytes) {
    throw invariantError(
      `Export exceeds the ${QUEUE_LIMITS.importBytes}-byte local limit.`,
    );
  }
  return serialized;
}

export async function parseQueueImport(text, options = {}) {
  if (typeof text !== "string") {
    throw invariantError("Imported queue must be JSON text.");
  }
  if (utf8ByteLength(text) > QUEUE_LIMITS.importBytes) {
    throw invariantError(
      `Import exceeds the ${QUEUE_LIMITS.importBytes}-byte local limit.`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw invariantError("Imported queue is not valid JSON.");
  }
  await validateQueue(parsed, options);
  return cloneValue(parsed);
}

function resolveStorage(storage) {
  if (storage !== undefined) {
    return storage;
  }
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function assertStorage(storage) {
  if (
    !storage ||
    typeof storage.getItem !== "function" ||
    typeof storage.setItem !== "function" ||
    typeof storage.removeItem !== "function"
  ) {
    throw invariantError(
      "Browser-local persistence is unavailable. No queue change was stored.",
    );
  }
}

export function createReviewQueueStore(options = {}) {
  requirePlainObject(options, "Store options");
  const storage = resolveStorage(options.storage);
  const config = getWorkingReviewConfig(options.config, { required: false });
  const now =
    typeof options.now === "function"
      ? options.now
      : () => new Date().toISOString();
  const makeId =
    typeof options.makeId === "function"
      ? options.makeId
      : (prefix) => {
          const random =
            globalThis.crypto?.randomUUID?.() ||
            `${Date.now()}-${Math.random().toString(16).slice(2)}`;
          return `${prefix}-${random}`;
        };

  async function load() {
    if (!storage) {
      return createEmptyQueue();
    }
    const raw = storage.getItem(REVIEW_QUEUE_STORAGE_KEY);
    if (raw === null) {
      return createEmptyQueue();
    }
    return parseQueueImport(raw, { config });
  }

  async function persist(candidate, expectedRevision) {
    assertStorage(storage);
    const current = await load();
    if (current.revision !== expectedRevision) {
      throw conflictError(
        `Queue revision changed in this browser: expected ${expectedRevision}, current ${current.revision}. Reload before retrying.`,
      );
    }
    await validateQueue(candidate, { config });
    const serialized = JSON.stringify(candidate);
    if (utf8ByteLength(serialized) > QUEUE_LIMITS.importBytes) {
      throw invariantError(
        `Queue exceeds the ${QUEUE_LIMITS.importBytes}-byte local persistence limit.`,
      );
    }
    storage.setItem(REVIEW_QUEUE_STORAGE_KEY, serialized);
    return cloneValue(candidate);
  }

  async function mutate(mutator, inputExpectedRevision) {
    const current = await load();
    const expectedRevision =
      inputExpectedRevision === undefined
        ? current.revision
        : Number(inputExpectedRevision);
    if (expectedRevision !== current.revision) {
      throw conflictError(
        `Queue revision changed: expected ${expectedRevision}, current ${current.revision}. Reload before retrying.`,
      );
    }
    const candidate = await mutator(current, {
      expectedRevision,
      now,
      makeId,
      config,
    });
    return persist(candidate, expectedRevision);
  }

  return Object.freeze({
    storageKey: REVIEW_QUEUE_STORAGE_KEY,
    load,
    createDraft(input, mutationOptions = {}) {
      return mutate(
        (queue, deps) => createDraft(queue, input, deps),
        mutationOptions.expectedRevision,
      );
    },
    submitForReview(submissionId, input = {}, mutationOptions = {}) {
      return mutate(
        (queue, deps) => submitForReview(queue, submissionId, input, deps),
        mutationOptions.expectedRevision,
      );
    },
    recordDecision(submissionId, input, mutationOptions = {}) {
      return mutate(
        (queue, deps) => recordDecision(queue, submissionId, input, deps),
        mutationOptions.expectedRevision,
      );
    },
    createRevisedDraft(
      submissionId,
      overrides = {},
      mutationOptions = {},
    ) {
      return mutate(
        (queue, deps) =>
          createRevisedDraft(queue, submissionId, overrides, deps),
        mutationOptions.expectedRevision,
      );
    },
    async export() {
      return exportQueue(await load(), { config });
    },
    async replaceFromImport(text, replacementOptions = {}) {
      if (replacementOptions.confirmed !== true) {
        throw invariantError(
          "Import replacement requires explicit confirmation.",
        );
      }
      const imported = await parseQueueImport(text, { config });
      const current = await load();
      const expectedRevision =
        replacementOptions.expectedRevision === undefined
          ? current.revision
          : Number(replacementOptions.expectedRevision);
      if (expectedRevision !== current.revision) {
        throw conflictError(
          `Queue revision changed: expected ${expectedRevision}, current ${current.revision}. Reload before importing.`,
        );
      }
      imported.revision = current.revision + 1;
      return persist(imported, expectedRevision);
    },
    async reset(resetOptions = {}) {
      if (resetOptions.confirmed !== true) {
        throw invariantError("Reset requires explicit confirmation.");
      }
      assertStorage(storage);
      const current = await load();
      if (
        resetOptions.expectedRevision !== undefined &&
        Number(resetOptions.expectedRevision) !== current.revision
      ) {
        throw conflictError(
          "Queue revision changed. Reload before resetting local data.",
        );
      }
      storage.removeItem(REVIEW_QUEUE_STORAGE_KEY);
      return createEmptyQueue();
    },
  });
}

export const createQueueStore = createReviewQueueStore;
export const importQueue = parseQueueImport;

function byId(id) {
  return document.getElementById(id);
}

function setNodeText(node, value) {
  if (node) {
    node.textContent = String(value ?? "");
  }
}

function clearNode(node) {
  node?.replaceChildren();
}

function appendTextBlock(parent, label, value, className = "") {
  if (!parent || !value) {
    return;
  }
  const block = document.createElement("div");
  if (className) {
    block.className = className;
  }
  const heading = document.createElement("strong");
  heading.textContent = label;
  const text = document.createElement("p");
  text.textContent = value;
  block.append(heading, text);
  parent.append(block);
}

function isTypingTarget(target) {
  if (!(target instanceof Element)) {
    return false;
  }
  return (
    target.matches("input, textarea, select, button") ||
    target.closest("[contenteditable='true']") !== null
  );
}

function normalizeFormDraft(form) {
  const values = new FormData(form);
  return {
    submissionKind: values.get("submissionKind"),
    targetId: values.get("targetId"),
    title: values.get("title"),
    statement: values.get("statement"),
    proposedChangeSummary: values.get("proposedChangeSummary"),
    researchLabel: values.get("researchLabel"),
    nativeLabel: values.get("nativeLabel"),
    place: values.get("place"),
    time: values.get("time"),
    uncertaintyOrCompetition: values.get("uncertaintyOrCompetition"),
    missingEvidence: values.get("missingEvidence"),
    nextTestOrReview: values.get("nextTestOrReview"),
    sourceRefs: values.get("sourceRefs"),
    submittedByDescriptor: values.get("submittedByDescriptor"),
    exactReason: values.get("exactReason"),
    supersedesSubmissionId:
      form.dataset.supersedesSubmissionId ||
      values.get("supersedesSubmissionId"),
  };
}

function normalizeFormDecision(form) {
  const values = new FormData(form);
  return {
    proposedOutcome: values.get("proposedOutcome"),
    reviewerSlot: values.get("reviewerSlot"),
    reviewerDescriptor: values.get("reviewerDescriptor"),
    exactReason: values.get("exactReason"),
    requiredChanges: values.get("requiredChanges"),
    relatedSubmissionId: values.get("relatedSubmissionId"),
  };
}

function setFormValue(form, name, value) {
  const field = form?.elements?.namedItem(name);
  if (field && "value" in field) {
    field.value = value ?? "";
  }
}

function immutableSceneConfig() {
  const source = globalThis.SCC_DATA?.workingReviewQueue;
  if (!isPlainObject(source)) {
    return Object.freeze({});
  }
  return Object.freeze(cloneValue(source));
}

export function bindReviewQueueUI(options = {}) {
  if (typeof document === "undefined") {
    return null;
  }

  const dialog = byId("reviewQueue");
  const openButton = byId("reviewQueueButton");
  if (!dialog || !openButton) {
    return null;
  }

  const closeButton = byId("reviewQueueClose");
  const disclosure = byId("reviewQueueDisclosure");
  const statusNode = byId("reviewQueueStatus");
  const list = byId("reviewQueueList");
  const empty = byId("reviewQueueEmpty");
  const newButton = byId("reviewQueueNew");
  const createPanel = byId("reviewQueueCreatePanel");
  const createForm = byId("reviewQueueCreateForm");
  const cancelDraft = byId("reviewQueueCancelDraft");
  const detail = byId("reviewQueueDetail");
  const detailTitle = byId("reviewQueueDetailTitle");
  const detailMeta = byId("reviewQueueDetailMeta");
  const detailBody = byId("reviewQueueDetailBody");
  const history = byId("reviewQueueHistory");
  const welcome = byId("reviewQueueWelcome");
  const submitReviewButton = byId("reviewQueueSubmitReview");
  const reviseButton = byId("reviewQueueRevise");
  const decisionForm = byId("reviewQueueDecisionForm");
  const exportButton = byId("reviewQueueExport");
  const importButton = byId("reviewQueueImport");
  const importFile = byId("reviewQueueImportFile");
  const resetButton = byId("reviewQueueReset");
  const sceneConfig = immutableSceneConfig();
  const store =
    options.store ||
    createReviewQueueStore({
      storage: options.storage,
      now: options.now,
      makeId: options.makeId,
      config: sceneConfig,
    });

  let queue = createEmptyQueue();
  let selectedSubmissionId = "";
  let returnFocus = null;

  const announce = (message, isError = false) => {
    setNodeText(statusNode, message);
    if (statusNode) {
      statusNode.dataset.state = isError ? "error" : "ready";
    }
  };

  const selectedSubmission = () =>
    queue.submissions.find(
      (submission) => submission.id === selectedSubmissionId,
    ) || null;

  function renderHistory(submission) {
    clearNode(history);
    if (!history) {
      return;
    }
    const ledger = [...submission.events, ...submission.decisions].sort(
      (left, right) => left.sequence - right.sequence,
    );
    for (const record of ledger) {
      const item = document.createElement("article");
      const title = document.createElement("strong");
      title.textContent =
        record.kind === "REVIEW_DECISION"
          ? `${record.sequence}. ${record.proposedOutcome} — reviewer slot ${record.reviewerSlot}`
          : `${record.sequence}. ${record.fromStatus || "START"} → ${record.toStatus}`;
      const meta = document.createElement("span");
      meta.textContent = `${record.at} · effect ${record.recordEffect ?? record.authorityEffect} · ${record.hash.slice(0, 12)}…`;
      const rationale = document.createElement("p");
      rationale.textContent = record.exactReason ?? record.rationale;
      item.append(title, meta, rationale);
      if (record.kind === "REVIEW_DECISION") {
        const descriptor = document.createElement("p");
        descriptor.textContent = `${record.reviewerDescriptor} — ${record.authorityStatus}`;
        item.append(descriptor);
        if (record.requiredChanges.length > 0) {
          const changes = document.createElement("p");
          changes.textContent = `Required changes: ${record.requiredChanges.join("; ")}`;
          item.append(changes);
        }
        if (record.relatedSubmissionId) {
          const related = document.createElement("p");
          related.textContent = `Related submission: ${record.relatedSubmissionId}`;
          item.append(related);
        }
      }
      history.append(item);
    }
  }

  function renderDetail() {
    const submission = selectedSubmission();
    if (!submission) {
      if (detail) {
        detail.hidden = true;
      }
      if (welcome) {
        welcome.hidden = createPanel ? !createPanel.hidden : false;
      }
      return;
    }
    if (welcome) {
      welcome.hidden = true;
    }
    if (detail) {
      detail.hidden = false;
    }
    setNodeText(detailTitle, submission.title);
    setNodeText(
      detailMeta,
      `${displayStatus(submission.status)} · ${submission.submissionKind} · ${submission.researchLabel} · ${submission.targetId.replace("_", " ")} · version ${submission.versionNumber}`,
    );
    clearNode(detailBody);
    appendTextBlock(detailBody, "Statement", submission.statement);
    appendTextBlock(detailBody, "Place", submission.place);
    appendTextBlock(detailBody, "Time", submission.time);
    appendTextBlock(
      detailBody,
      "Proposed change",
      submission.proposedChangeSummary,
    );
    appendTextBlock(
      detailBody,
      "Source or method references",
      submission.sourceRefs.join("\n"),
    );
    appendTextBlock(
      detailBody,
      "Missing evidence",
      submission.missingEvidence.join("\n") || "None recorded.",
    );
    appendTextBlock(
      detailBody,
      "Conflict / competing account",
      submission.uncertaintyOrCompetition,
    );
    appendTextBlock(
      detailBody,
      "Next test or review",
      submission.nextTestOrReview,
    );
    appendTextBlock(
      detailBody,
      "Review rule",
      `${submission.reviewPolicy.id}: ${submission.reviewPolicy.requiredConcurringDecisions} concurring decision(s) from 3 unauthenticated reviewer slots. ${submission.reviewPolicy.authority}.`,
    );
    appendTextBlock(
      detailBody,
      "Immutable local version",
      `${submission.id} · target ${submission.targetRecordId}@${submission.targetRecordVersion} · target SHA ${submission.targetRecordSha256.slice(0, 12)}… · content ${submission.contentHash.slice(0, 16)}… · protected status ${submission.protectedStatus} · protected record mutation FALSE · shared-memory effect NONE · empirical truth FALSE`,
    );
    if (hasDecisionConflict(submission)) {
      appendTextBlock(
        detailBody,
        "Visible decision conflict",
        "Different outcomes or replacement submissions remain in the immutable history. No position is silently selected.",
        "review-queue-conflict",
      );
    }
    renderHistory(submission);

    if (submitReviewButton) {
      submitReviewButton.hidden = submission.status !== "DRAFT";
    }
    if (decisionForm) {
      decisionForm.hidden = submission.status !== "UNDER_REVIEW";
    }
    if (reviseButton) {
      reviseButton.hidden = false;
    }
    const relatedField = decisionForm?.elements?.namedItem(
      "relatedSubmissionId",
    );
    if (relatedField instanceof HTMLSelectElement) {
      const currentValue = relatedField.value;
      relatedField.replaceChildren();
      const none = document.createElement("option");
      none.value = "";
      none.textContent = "None";
      relatedField.append(none);
      for (const candidate of queue.submissions.filter(
        (entry) => entry.supersedesSubmissionId === submission.id,
      )) {
        const option = document.createElement("option");
        option.value = candidate.id;
        option.textContent = `${candidate.title} · version ${candidate.versionNumber}`;
        relatedField.append(option);
      }
      relatedField.value = currentValue;
    }
  }

  function renderList() {
    clearNode(list);
    if (empty) {
      empty.hidden = queue.submissions.length > 0;
    }
    for (const submission of [...queue.submissions].reverse()) {
      const item = document.createElement("article");
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.submissionId = submission.id;
      button.setAttribute(
        "aria-pressed",
        String(submission.id === selectedSubmissionId),
      );
      const title = document.createElement("strong");
      title.textContent = submission.title;
      const meta = document.createElement("span");
      meta.textContent = `${displayStatus(submission.status)} · ${submission.targetId.replace("_", " ")} · ${submission.researchLabel}`;
      button.append(title, meta);
      button.addEventListener("click", () => {
        selectedSubmissionId = submission.id;
        renderList();
        renderDetail();
      });
      item.append(button);
      list?.append(item);
    }
    renderDetail();
  }

  async function refresh(message = "") {
    try {
      queue = await store.load();
      if (
        selectedSubmissionId &&
        !queue.submissions.some(
          (submission) => submission.id === selectedSubmissionId,
        )
      ) {
        selectedSubmissionId = "";
      }
      renderList();
      announce(
        message ||
          `${queue.submissions.length} browser-local submission(s). Protected records unchanged.`,
      );
    } catch (error) {
      announce(error.message, true);
    }
  }

  function showDialog() {
    returnFocus = document.activeElement;
    openButton.setAttribute("aria-expanded", "true");
    if (typeof dialog.showModal === "function" && !dialog.open) {
      dialog.showModal();
    } else {
      dialog.hidden = false;
    }
    refresh();
    closeButton?.focus();
  }

  function hideDialog() {
    openButton.setAttribute("aria-expanded", "false");
    if (typeof dialog.close === "function" && dialog.open) {
      dialog.close();
    } else {
      dialog.hidden = true;
    }
    if (returnFocus instanceof HTMLElement) {
      returnFocus.focus();
    } else {
      openButton.focus();
    }
  }

  if (disclosure && !disclosure.textContent.trim()) {
    disclosure.textContent =
      sceneConfig.disclosure ||
      "This is a single-device browser-local prototype queue. GitHub Pages publishes only the static app; entries are not uploaded or shared. Reviewer descriptors are unauthenticated placeholders. Real multi-person sharing requires a later authenticated database and hosting phase.";
  }

  openButton.addEventListener("click", showDialog);
  closeButton?.addEventListener("click", hideDialog);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    hideDialog();
  });
  dialog.addEventListener("close", () => {
    if (returnFocus instanceof HTMLElement) {
      returnFocus.focus();
    }
  });

  newButton?.addEventListener("click", () => {
    createForm?.reset();
    if (createForm) {
      createForm.dataset.supersedesSubmissionId = "";
    }
    if (createPanel) {
      createPanel.hidden = false;
    }
    if (detail) {
      detail.hidden = true;
    }
    if (welcome) {
      welcome.hidden = true;
    }
    setFormValue(createForm, "place", "UNKNOWN");
    setFormValue(createForm, "time", "UNKNOWN");
    createForm?.querySelector("input, textarea, select")?.focus();
  });

  cancelDraft?.addEventListener("click", () => {
    if (createPanel) {
      createPanel.hidden = true;
    }
    if (welcome) {
      welcome.hidden = Boolean(selectedSubmissionId);
    }
    createForm?.reset();
    if (createForm) {
      createForm.dataset.supersedesSubmissionId = "";
    }
    newButton?.focus();
  });

  createForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const beforeIds = new Set(queue.submissions.map((entry) => entry.id));
      queue = await store.createDraft(normalizeFormDraft(createForm), {
        expectedRevision: queue.revision,
      });
      const created = queue.submissions.find((entry) => !beforeIds.has(entry.id));
      selectedSubmissionId = created?.id || "";
      createForm.reset();
      createForm.dataset.supersedesSubmissionId = "";
      if (createPanel) {
        createPanel.hidden = true;
      }
      renderList();
      announce("Immutable browser-local DRAFT created. Shared memory effect: NONE.");
    } catch (error) {
      announce(error.message, true);
    }
  });

  submitReviewButton?.addEventListener("click", async () => {
    const submission = selectedSubmission();
    if (!submission) {
      return;
    }
    try {
      queue = await store.submitForReview(
        submission.id,
        {
          actorDescriptor: submission.submittedByDescriptor,
          exactReason: "Submitted to the local pending review queue.",
        },
        { expectedRevision: queue.revision },
      );
      renderList();
      announce("Submission is UNDER REVIEW / PENDING. Authority effect: NONE.");
    } catch (error) {
      announce(error.message, true);
    }
  });

  decisionForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submission = selectedSubmission();
    if (!submission) {
      return;
    }
    try {
      queue = await store.recordDecision(
        submission.id,
        normalizeFormDecision(decisionForm),
        { expectedRevision: queue.revision },
      );
      decisionForm.reset();
      renderList();
      const updated = selectedSubmission();
      announce(
        `Decision appended. ${displayStatus(updated.status)}. Empirical truth remains FALSE.`,
      );
    } catch (error) {
      announce(error.message, true);
    }
  });

  reviseButton?.addEventListener("click", () => {
    const submission = selectedSubmission();
    if (!submission) {
      return;
    }
    createForm?.reset();
    if (createForm) {
      createForm.dataset.supersedesSubmissionId = submission.id;
    }
    setFormValue(createForm, "submissionKind", submission.submissionKind);
    setFormValue(createForm, "targetId", submission.targetId);
    setFormValue(createForm, "title", submission.title);
    setFormValue(createForm, "statement", submission.statement);
    setFormValue(
      createForm,
      "proposedChangeSummary",
      submission.proposedChangeSummary,
    );
    setFormValue(createForm, "researchLabel", submission.researchLabel);
    setFormValue(createForm, "nativeLabel", submission.nativeLabel);
    setFormValue(createForm, "place", submission.place);
    setFormValue(createForm, "time", submission.time);
    setFormValue(
      createForm,
      "uncertaintyOrCompetition",
      submission.uncertaintyOrCompetition,
    );
    setFormValue(
      createForm,
      "missingEvidence",
      submission.missingEvidence.join("\n"),
    );
    setFormValue(
      createForm,
      "nextTestOrReview",
      submission.nextTestOrReview,
    );
    setFormValue(createForm, "sourceRefs", submission.sourceRefs.join("\n"));
    setFormValue(
      createForm,
      "submittedByDescriptor",
      submission.submittedByDescriptor,
    );
    setFormValue(
      createForm,
      "exactReason",
      `New immutable version of ${submission.id}`,
    );
    if (createPanel) {
      createPanel.hidden = false;
    }
    if (detail) {
      detail.hidden = true;
    }
    if (welcome) {
      welcome.hidden = true;
    }
    announce(
      `Preparing a new immutable version linked to ${submission.id}; the prior history will remain.`,
    );
    createForm?.querySelector("[name='statement']")?.focus();
  });

  exportButton?.addEventListener("click", async () => {
    try {
      const text = await store.export();
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `shared-city-review-queue-${new Date()
        .toISOString()
        .slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      announce(
        "Browser-local queue exported. The file has no protected research-record effect.",
      );
    } catch (error) {
      announce(error.message, true);
    }
  });

  importButton?.addEventListener("click", () => importFile?.click());
  importFile?.addEventListener("change", async () => {
    const file = importFile.files?.[0];
    importFile.value = "";
    if (!file) {
      return;
    }
    try {
      if (file.size > QUEUE_LIMITS.importBytes) {
        throw invariantError("Selected import file is too large.");
      }
      const confirmed = globalThis.confirm(
        "Replace this browser's entire local prototype queue with the validated import? This does not affect protected records or shared memory.",
      );
      if (!confirmed) {
        announce("Import cancelled; local queue unchanged.");
        return;
      }
      queue = await store.replaceFromImport(await file.text(), {
        confirmed: true,
        expectedRevision: queue.revision,
      });
      selectedSubmissionId = "";
      renderList();
      announce(
        "Validated import replaced this browser's local prototype queue. Shared memory effect: NONE.",
      );
    } catch (error) {
      announce(error.message, true);
    }
  });

  resetButton?.addEventListener("click", async () => {
    const confirmed = globalThis.confirm(
      "Remove only this browser's Working Review Queue data? Protected records and all other storage remain untouched.",
    );
    if (!confirmed) {
      announce("Reset cancelled; local queue unchanged.");
      return;
    }
    try {
      queue = await store.reset({
        confirmed: true,
        expectedRevision: queue.revision,
      });
      selectedSubmissionId = "";
      renderList();
      announce(
        "This browser's local review queue was reset. Protected records were not changed.",
      );
    } catch (error) {
      announce(error.message, true);
    }
  });

  globalThis.addEventListener?.("storage", (event) => {
    if (event.key === REVIEW_QUEUE_STORAGE_KEY) {
      refresh("Browser-local queue changed in another tab; view refreshed.");
    }
  });

  document.addEventListener("keydown", (event) => {
    if (
      event.key.toLowerCase() === "r" &&
      !event.repeat &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !isTypingTarget(event.target)
    ) {
      event.preventDefault();
      openButton.click();
    }
    if (event.key === "Escape" && dialog.open) {
      event.preventDefault();
      event.stopPropagation();
      hideDialog();
    }
  });

  refresh();
  return Object.freeze({
    refresh,
    open: showDialog,
    close: hideDialog,
    getQueue: () => cloneValue(queue),
  });
}

function autoBind() {
  if (typeof document === "undefined") {
    return;
  }
  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => bindReviewQueueUI(),
      { once: true },
    );
  } else {
    bindReviewQueueUI();
  }
}

autoBind();
