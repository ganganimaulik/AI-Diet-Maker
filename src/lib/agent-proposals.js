/**
 * The assistant's one way to change anything: drafting a Diet Builder edit
 * for the user to approve.
 *
 * propose_builder_change writes nothing. It checks the draft against the
 * builder the user is looking at (via builder-ops.js), and records it as a
 * pending proposal that the chat route stores on the answer. The user sees
 * the proposal as a card with every before → after value, and only their
 * Apply click puts it into the builder — in the browser, through the same
 * builder-ops.js code, as an ordinary unsaved edit.
 *
 * Used by:
 *   - src/app/api/chat/route.ts (ES import via agent.ts)
 *
 * Keep this file as plain JS so it matches the other shared lib modules.
 */

const { randomUUID } = require('node:crypto');
const { ACTIONS, DAYS, applyBuilderOperations, formatChange } = require('./builder-ops.js');

const PROPOSE_TOOL_NAME = 'propose_builder_change';

/** Drafts one answer may carry before the user has to pick what comes first. */
const MAX_PROPOSALS_PER_TURN = 5;

const MAX_TITLE_CHARS = 120;
const MAX_REASON_CHARS = 600;

/**
 * One flat object for every action, because both providers handle a typed
 * object in an array but neither takes a union of shapes. builder-ops.js
 * refuses fields an action does not use, so a stray one is reported rather
 * than silently applied.
 */
const OPERATION_SCHEMA = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ACTIONS,
      description:
        'update_targets: the calorie target or Na:K range. update_meal / add_meal / remove_meal: a meal itself. add_ingredient / update_ingredient / remove_ingredient: an ingredient of a meal, or of one weekday when day is set.'
    },
    meal: {
      type: 'string',
      description:
        "Meal id from get_diet_config (an exact meal name also works, including one added earlier in the same change). Required for update_meal, remove_meal and add_ingredient; for update_ingredient / remove_ingredient on a day, the meal the ingredient belongs to."
    },
    day: {
      type: 'string',
      enum: DAYS,
      description: "Ingredient actions only: edit that weekday's daily ingredients (dailyVariables) instead of the meal's own list."
    },
    ingredient: {
      type: 'string',
      description: 'update_ingredient / remove_ingredient: the current name of the ingredient, exactly as get_diet_config lists it.'
    },
    name: {
      type: 'string',
      description: 'add_meal / add_ingredient: its name. update_meal / update_ingredient: a new name, only when renaming.'
    },
    weight: {
      type: 'number',
      description: "Fixed amount in grams — the whole day's total, never per meal. Makes the ingredient fixed and clears any AUTO range."
    },
    isAuto: {
      type: 'boolean',
      description: 'true: the plan generator solves the amount (clears the fixed weight). false: back to a fixed amount, so pass weight too.'
    },
    minGrams: { type: 'number', description: 'AUTO lower bound in grams. 0 removes it.' },
    maxGrams: { type: 'number', description: 'AUTO upper bound in grams. 0 removes it.' },
    disabled: {
      type: 'boolean',
      description: 'true leaves the meal or ingredient out of plans without deleting it; false brings it back.'
    },
    personalOnly: { type: 'boolean', description: "Ingredient: true keeps it out of the cook's instructions." },
    split: {
      type: 'string',
      description: 'Ingredient: how to divide it between dishes, e.g. "50% in subji, rest in chicken". An empty string clears it.'
    },
    mealsPerDay: { type: 'number', description: 'Meal: times it is eaten per day, a whole number from 1 to 12.' },
    cookQuantityMode: {
      type: 'string',
      enum: ['daily', 'per-meal'],
      description: "Meal: whether the cook's message shows the whole day's quantities or per-meal portions."
    },
    prepMethod: { type: 'string', description: 'Meal: preparation and cooking instructions.' },
    dailyCalorieTarget: { type: 'number', description: 'update_targets: the daily calorie target in kcal.' },
    idealSodiumPotassiumRatioMin: { type: 'number', description: 'update_targets: lower end of the ideal sodium:potassium ratio, e.g. 0.7.' },
    idealSodiumPotassiumRatioMax: { type: 'number', description: 'update_targets: upper end of the ideal sodium:potassium ratio, e.g. 0.8.' }
  },
  required: ['action']
};

const PROPOSAL_TOOL_SCHEMAS = [
  {
    name: PROPOSE_TOOL_NAME,
    description:
      'Draft a change to the Diet Builder for the user to approve. Calling this changes nothing: the user gets a card listing every before → after value and decides whether to apply it. Make one call per independent change so each can be accepted on its own, and combine operations only when they belong together (e.g. replacing one ingredient with another). Operations run in order, all or nothing. Read get_diet_config first so meal ids and ingredient names match.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Card title: a short imperative summary, e.g. "Cut chicken breast to 400 g".'
        },
        reason: {
          type: 'string',
          description: 'One or two sentences on why, with the expected effect on calories and the Na:K ratio when you know it.'
        },
        operations: {
          type: 'array',
          description: 'The edits, in the order they apply.',
          items: OPERATION_SCHEMA
        }
      },
      required: ['title', 'operations']
    }
  }
];

function readCardText(value, field, maxLength, required) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (required && !text) throw new Error(`${field} is required.`);
  if (text.length > maxLength) throw new Error(`${field} is too long (${text.length} characters, limit ${maxLength}).`);
  return text;
}

/**
 * One turn's drafts. `run` is the propose_builder_change tool; `proposals`
 * collects what it drafted, for the route to store on the answer.
 *
 * Every draft is checked against the same builder — the one on screen when
 * the question was asked — because the user may apply any of them, in any
 * order, or none.
 *
 * @param {object} builder – { global, meals, dailyVariables }
 */
function createProposalDrafts(builder) {
  const proposals = [];

  /** @returns {Promise<{ ok: boolean, result?: object, error?: string }>} */
  async function run(args) {
    try {
      if (proposals.length >= MAX_PROPOSALS_PER_TURN) {
        throw new Error(`This answer already holds ${MAX_PROPOSALS_PER_TURN} drafts. Ask the user which to do first.`);
      }
      const title = readCardText(args.title, 'title', MAX_TITLE_CHARS, true);
      const reason = readCardText(args.reason, 'reason', MAX_REASON_CHARS, false);
      const { operations, changes } = applyBuilderOperations(builder, args.operations);

      const proposal = { id: randomUUID(), title, reason, operations, changes, status: 'pending', decidedAt: null };
      proposals.push(proposal);
      return {
        ok: true,
        result: {
          proposalId: proposal.id,
          status: 'awaiting_user_approval',
          changes: changes.map(formatChange),
          note:
            'The user now sees this as a card with Apply and Reject buttons. Nothing has changed yet: say briefly what you drafted and why, without restating every value, and never describe it as done.'
        }
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  return { proposals, run };
}

module.exports = {
  PROPOSE_TOOL_NAME,
  PROPOSAL_TOOL_SCHEMAS,
  createProposalDrafts
};
