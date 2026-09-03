/**
 * Read-only database access for the chat assistant.
 *
 * Every tool here reads. There is deliberately no code path to create, update
 * or delete a document: the models are only ever reached through find/count,
 * and the query builder rejects the operators Mongo would evaluate as code.
 *
 * Two more rules hold for everything that leaves this file:
 *   - Secrets are stripped. Config stores API keys and a service-account JSON,
 *     and WhatsAppState stores a login QR. The assistant must never be able to
 *     read those back out, whatever it asks for.
 *   - Results are bounded. A day's plan is thousands of tokens, so generic
 *     queries truncate long text and get_day_plan is the way to read one in
 *     full.
 *
 * Callers must have an open mongoose connection (dbConnect) before calling
 * runTool.
 *
 * Used by:
 *   - src/app/api/chat/route.ts (ES import via agent-tools.ts)
 *
 * Keep this file as plain JS so it matches the other shared lib modules.
 */

const {
  Config,
  CachedResponse,
  VerificationResult,
  GenerationJob,
  Scheduler,
  WhatsAppState,
  Contact
} = require('./models.js');
const { computeConfigHash } = require('./compute-config-hash.js');

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

/** Documents per db_query call, and the ceiling a caller can ask for. */
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

/** Hard cap on one tool result, so a wide query cannot flood the context. */
const MAX_RESULT_CHARS = 24000;

/** Long text fields collapsed in generic queries; read them via get_day_plan. */
const TRUNCATED_FIELDS = new Set(['responseText', 'thinkingText', 'prompt']);
const TRUNCATED_FIELD_CHARS = 600;

/**
 * Never leaves this module, at any nesting depth, under any projection.
 * Credentials plus the WhatsApp QR (a scannable login) and the job lease id.
 */
const REDACTED_FIELDS = new Set([
  'apiKey',
  'fireworksApiKey',
  'enterpriseApiKey',
  'enterpriseServiceAccountJson',
  'huggingFaceToken',
  'qr',
  'leaseId'
]);

/** Mongo operators that evaluate expressions or write; refused in every filter. */
const FORBIDDEN_OPERATORS = new Set([
  '$where',
  '$function',
  '$accumulator',
  '$expr',
  '$jsonSchema',
  '$out',
  '$merge',
  '$lookup',
  '$graphLookup',
  '$unionWith'
]);

/**
 * Collections the assistant may read, by the name it uses in db_query.
 * Anything not listed here is unreachable — including the assistant's own
 * chat threads, which would only feed its context back to itself.
 */
const COLLECTIONS = {
  config: {
    model: Config,
    description:
      'Single document. The whole diet setup: calorie/sodium targets, meals and their ingredients, per-day ingredient overrides, splits. API credentials are redacted.'
  },
  plans: {
    model: CachedResponse,
    description:
      "One document per weekday. The generated diet plan markdown for that day. responseText is truncated here — use get_day_plan to read a plan in full."
  },
  verifications: {
    model: VerificationResult,
    description:
      "One document per weekday. The verdict on that day's plan: recomputed calorie/macro/sodium totals, what the plan claimed, and any issues found."
  },
  generation_jobs: {
    model: GenerationJob,
    description:
      'One document per weekday. Status of the most recent plan generation run, including each automatic verification attempt and why a plan was regenerated.'
  },
  scheduler: {
    model: Scheduler,
    description:
      'Single document. WhatsApp delivery schedule: send time, timezone, recipients, and the last send result.'
  },
  whatsapp_state: {
    model: WhatsAppState,
    description: 'Single document. WhatsApp connection status and the connected account. The login QR is redacted.'
  },
  contacts: {
    model: Contact,
    description: 'Cached WhatsApp contacts and groups available as delivery recipients.'
  }
};

// -------------------------------------------------------------
// SANITIZATION
// -------------------------------------------------------------

/**
 * Strip secrets and mongoose bookkeeping from a document, and collapse the
 * long text fields, at every depth. Returns a new plain value.
 */
function sanitize(value, depth = 0) {
  if (depth > 12) return '[too deep]';
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry, depth + 1));
  if (typeof value !== 'object') return value;

  // Mongoose Maps (dailyVariables) serialize as plain objects.
  const source = typeof value.toObject === 'function' ? value.toObject() : value;
  if (source instanceof Map) {
    const fromMap = {};
    for (const [key, entry] of source.entries()) fromMap[key] = sanitize(entry, depth + 1);
    return fromMap;
  }

  const out = {};
  for (const [key, entry] of Object.entries(source)) {
    if (key === '_id' || key === '__v') continue;
    if (REDACTED_FIELDS.has(key)) {
      out[key] = entry ? '[redacted]' : '';
      continue;
    }
    if (TRUNCATED_FIELDS.has(key) && typeof entry === 'string' && entry.length > TRUNCATED_FIELD_CHARS) {
      out[key] = `${entry.slice(0, TRUNCATED_FIELD_CHARS)}\n…[truncated, ${entry.length} chars total]`;
      continue;
    }
    out[key] = sanitize(entry, depth + 1);
  }
  return out;
}

/**
 * Walk a user-supplied filter and refuse anything Mongo would evaluate as code
 * or treat as a write stage. Returns the filter unchanged when it is safe.
 */
function assertSafeFilter(value, depth = 0) {
  if (depth > 8) throw new Error('Filter is nested too deeply.');
  if (Array.isArray(value)) {
    value.forEach((entry) => assertSafeFilter(entry, depth + 1));
    return value;
  }
  if (!value || typeof value !== 'object') return value;

  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_OPERATORS.has(key)) {
      throw new Error(`Operator ${key} is not allowed. Use plain field comparisons instead.`);
    }
    assertSafeFilter(entry, depth + 1);
  }
  return value;
}

/** Parse a JSON-string tool argument, with a readable error on bad JSON. */
function parseJsonArg(value, label, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') throw new Error(`${label} must be a JSON string.`);
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} is not valid JSON. Received: ${String(value).slice(0, 200)}`);
  }
}

function resolveCollection(name) {
  const key = String(name || '').trim().toLowerCase();
  const entry = COLLECTIONS[key];
  if (!entry) {
    throw new Error(`Unknown collection "${name}". Available: ${Object.keys(COLLECTIONS).join(', ')}.`);
  }
  return entry;
}

function normalizeDay(value) {
  const day = String(value || '').trim().toUpperCase();
  if (!DAYS.includes(day)) {
    throw new Error(`Unknown day "${value}". Use one of: ${DAYS.join(', ')}.`);
  }
  return day;
}

/** Cap a tool result so one call cannot blow out the context window. */
function capResult(result) {
  const json = JSON.stringify(result);
  if (json.length <= MAX_RESULT_CHARS) return result;
  return {
    truncated: true,
    note: `Result was ${json.length} characters and has been truncated to ${MAX_RESULT_CHARS}. Narrow the filter, lower the limit, or use a projection.`,
    partial: `${json.slice(0, MAX_RESULT_CHARS)}…`
  };
}

// -------------------------------------------------------------
// SCHEMA DESCRIPTION
// -------------------------------------------------------------

/** Field list for one mongoose schema, one level into sub-document arrays. */
function describeSchema(schema) {
  const fields = [];
  schema.eachPath((path, type) => {
    if (path === '_id' || path === '__v') return;
    if (REDACTED_FIELDS.has(path)) {
      fields.push(`${path}: [redacted]`);
      return;
    }
    if (type.schema) {
      const children = [];
      type.schema.eachPath((childPath, childType) => {
        if (childPath === '_id' || childPath === '__v') return;
        children.push(`${childPath}:${childType.instance}`);
      });
      fields.push(`${path}: ${type.instance || 'Object'}[{ ${children.join(', ')} }]`);
      return;
    }
    fields.push(`${path}: ${type.instance || 'Mixed'}`);
  });
  return fields;
}

// -------------------------------------------------------------
// TOOLS
// -------------------------------------------------------------

async function toolDbSchema() {
  const collections = [];
  for (const [name, entry] of Object.entries(COLLECTIONS)) {
    collections.push({
      collection: name,
      description: entry.description,
      documentCount: await entry.model.estimatedDocumentCount(),
      fields: describeSchema(entry.model.schema)
    });
  }
  return { collections, note: 'Read-only access. Filters are plain MongoDB query documents.' };
}

async function toolDbQuery(args) {
  const { model } = resolveCollection(args.collection);
  const filter = assertSafeFilter(parseJsonArg(args.filter, 'filter', {}));
  const projection = parseJsonArg(args.projection, 'projection', null);
  const sort = parseJsonArg(args.sort, 'sort', null);

  const requested = Number(args.limit);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(MAX_LIMIT, Math.floor(requested)) : DEFAULT_LIMIT;

  let query = model.find(filter, projection || undefined).limit(limit).lean();
  if (sort) query = query.sort(sort);

  const documents = await query.exec();
  return capResult({
    collection: String(args.collection).toLowerCase(),
    matched: documents.length,
    limit,
    documents: documents.map((doc) => sanitize(doc))
  });
}

async function toolDbCount(args) {
  const { model } = resolveCollection(args.collection);
  const filter = assertSafeFilter(parseJsonArg(args.filter, 'filter', {}));
  return { collection: String(args.collection).toLowerCase(), count: await model.countDocuments(filter) };
}

async function toolGetDietConfig() {
  const config = await Config.findOne().lean();
  if (!config) return { configured: false, note: 'No configuration has been saved yet.' };

  const clean = sanitize(config);
  return capResult({
    configured: true,
    targets: clean.global || {},
    meals: clean.meals || [],
    dailyVariables: clean.dailyVariables || {},
    selectedGenerationDay: clean.selectedGenerationDay || '',
    updatedAt: clean.updatedAt || null,
    note:
      'Ingredients with isAuto=true have their weight solved by the plan generator within minGrams/maxGrams; the rest are fixed. A meal or ingredient with disabled=true is excluded from plans.'
  });
}

/**
 * A plan and its verdict describe one exact config. Once the config that
 * produced them changes, both are history rather than current state, so every
 * plan read says whether it is still current.
 */
function staleness(config, day, storedHash) {
  if (!config || !storedHash) return null;
  try {
    return storedHash !== computeConfigHash(config, day);
  } catch {
    return null;
  }
}

function summarizeVerification(verdict, isStale) {
  if (!verdict) return null;
  const clean = sanitize(verdict);
  return {
    ok: clean.ok,
    errorCount: clean.errorCount,
    warningCount: clean.warningCount,
    issues: clean.issues || [],
    computedTotals: clean.computed || null,
    statedTotals: clean.stated || null,
    feasibility: clean.feasibility || null,
    calorieTarget: clean.target || 0,
    aiReview: clean.aiReview || null,
    checkedAt: clean.checkedAt || null,
    isStale
  };
}

async function toolGetDayPlan(args) {
  const day = normalizeDay(args.day);
  const [config, plan, verdict] = await Promise.all([
    Config.findOne().lean(),
    CachedResponse.findOne({ day }).lean(),
    VerificationResult.findOne({ day }).lean()
  ]);

  if (!plan) {
    return { day, hasPlan: false, note: `No plan has been generated for ${day} yet.` };
  }

  const planStale = staleness(config, day, plan.configHash);
  const verdictStale =
    verdict && plan.generatedAt && verdict.planGeneratedAt
      ? new Date(verdict.planGeneratedAt).getTime() !== new Date(plan.generatedAt).getTime()
      : !!verdict;

  return capResult({
    day,
    hasPlan: true,
    generatedAt: plan.generatedAt ? new Date(plan.generatedAt).toISOString() : null,
    isStale: planStale,
    staleNote: planStale ? 'The diet config changed after this plan was generated, so it no longer matches the current setup.' : undefined,
    planMarkdown: plan.responseText || '',
    verification: summarizeVerification(verdict, verdictStale)
  });
}

async function toolListDays() {
  const config = await Config.findOne().lean();
  const [plans, verdicts] = await Promise.all([
    CachedResponse.find({}).lean(),
    VerificationResult.find({}).lean()
  ]);

  const planByDay = new Map(plans.map((plan) => [plan.day, plan]));
  const verdictByDay = new Map(verdicts.map((verdict) => [verdict.day, verdict]));

  return {
    days: DAYS.map((day) => {
      const plan = planByDay.get(day);
      const verdict = verdictByDay.get(day);
      return {
        day,
        hasPlan: !!plan,
        generatedAt: plan && plan.generatedAt ? new Date(plan.generatedAt).toISOString() : null,
        isStale: plan ? staleness(config, day, plan.configHash) : null,
        verified: verdict ? verdict.ok : null,
        errorCount: verdict ? verdict.errorCount : null,
        warningCount: verdict ? verdict.warningCount : null
      };
    })
  };
}

// -------------------------------------------------------------
// TOOL DEFINITIONS
// -------------------------------------------------------------

/**
 * Provider-neutral declarations. Every parameter is a string, number or enum —
 * free-form objects (filters, projections, sorts) travel as JSON strings —
 * because Gemini's function-declaration schema does not accept an untyped
 * object, and one shape that works everywhere beats two that drift.
 */
const TOOL_DEFINITIONS = [
  {
    name: 'db_schema',
    description:
      'List every readable collection with its fields and document count. Call this first when you are unsure where something lives.',
    parameters: { type: 'object', properties: {}, required: [] },
    run: toolDbSchema
  },
  {
    name: 'list_days',
    description:
      'Overview of all seven weekdays: whether a plan exists, when it was generated, whether it still matches the current config, and its verification verdict. Cheap orientation before a deeper read.',
    parameters: { type: 'object', properties: {}, required: [] },
    run: toolListDays
  },
  {
    name: 'get_diet_config',
    description:
      "The user's full diet setup: calorie and sodium/potassium targets, every meal with its ingredients and weights, per-day ingredient overrides and seasoning splits. Use this for any question about what the user eats or how their plan is configured.",
    parameters: { type: 'object', properties: {}, required: [] },
    run: toolGetDietConfig
  },
  {
    name: 'get_day_plan',
    description:
      "Read one weekday's generated plan in full, plus its verification verdict with recomputed calorie, macro and sodium/potassium totals. Use this whenever the question is about what a specific day's plan actually says.",
    parameters: {
      type: 'object',
      properties: {
        day: {
          type: 'string',
          description: 'Weekday name.',
          enum: DAYS
        }
      },
      required: ['day']
    },
    run: toolGetDayPlan
  },
  {
    name: 'db_query',
    description:
      'Run a read-only MongoDB find against any collection. Use it for anything the dedicated tools do not cover — history, cross-day comparisons, scheduler or WhatsApp state.',
    parameters: {
      type: 'object',
      properties: {
        collection: {
          type: 'string',
          description: 'Collection to read.',
          enum: Object.keys(COLLECTIONS)
        },
        filter: {
          type: 'string',
          description: 'MongoDB query document as a JSON string, e.g. {"day":"MONDAY"}. Omit or pass {} to match everything.'
        },
        projection: {
          type: 'string',
          description: 'Optional JSON string selecting fields, e.g. {"day":1,"ok":1}. Strongly recommended on wide documents.'
        },
        sort: {
          type: 'string',
          description: 'Optional JSON string, e.g. {"updatedAt":-1}.'
        },
        limit: {
          type: 'number',
          description: `Documents to return, 1-${MAX_LIMIT}. Defaults to ${DEFAULT_LIMIT}.`
        }
      },
      required: ['collection']
    },
    run: toolDbQuery
  },
  {
    name: 'db_count',
    description: 'Count documents matching a filter, without returning them.',
    parameters: {
      type: 'object',
      properties: {
        collection: {
          type: 'string',
          description: 'Collection to count in.',
          enum: Object.keys(COLLECTIONS)
        },
        filter: {
          type: 'string',
          description: 'MongoDB query document as a JSON string. Omit to count everything.'
        }
      },
      required: ['collection']
    },
    run: toolDbCount
  }
];

const TOOLS_BY_NAME = new Map(TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));

/** Declarations only — the `run` implementations stay on this side. */
const TOOL_SCHEMAS = TOOL_DEFINITIONS.map(({ name, description, parameters }) => ({
  name,
  description,
  parameters
}));

/**
 * Execute one tool call. A failure is returned as data, not thrown: the model
 * should see "that collection does not exist" and try again, rather than
 * having the whole turn collapse.
 *
 * @param {string} name
 * @param {object} args
 * @returns {Promise<{ ok: boolean, result?: object, error?: string }>}
 */
async function runTool(name, args) {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) {
    return { ok: false, error: `Unknown tool "${name}". Available: ${TOOL_SCHEMAS.map((t) => t.name).join(', ')}.` };
  }
  try {
    return { ok: true, result: await tool.run(args || {}) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

module.exports = {
  DAYS,
  TOOL_SCHEMAS,
  runTool,
  // Exported for tests / reuse.
  sanitize,
  assertSafeFilter,
  REDACTED_FIELDS
};
