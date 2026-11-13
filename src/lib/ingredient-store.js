/**
 * Database access for the ingredient library (the IngredientEntry collection).
 *
 * Used by:
 *   - src/app/api/ingredients/route.ts and every route that compiles a prompt,
 *     verifies a plan or hashes the config
 *   - whatsapp-worker.js (CommonJS require)
 *
 * Keep this file as plain JS so it works in both contexts without a build
 * step. The pure half — matching, formatting, validation — is in
 * ingredient-library.js, which the browser can import too.
 */

const { IngredientEntry } = require('./models.js');
const {
  DEFAULT_INGREDIENT_LIBRARY,
  normalizeName,
  validateLibraryEntry
} = require('./ingredient-library.js');

/** A stored document as the plain row the rest of the app works with. */
function toEntry(doc) {
  return {
    id: String(doc._id),
    name: doc.name,
    aliases: Array.from(doc.aliases || []),
    kcal: doc.kcal || 0,
    protein: doc.protein || 0,
    carbs: doc.carbs || 0,
    fat: doc.fat || 0,
    sodium: doc.sodium || 0,
    potassium: doc.potassium || 0,
    note: doc.note || ''
  };
}

function isDuplicateKeyError(error) {
  return !!error && (error.code === 11000 || (Array.isArray(error.writeErrors) && error.writeErrors.every((e) => e.code === 11000)));
}

function readAll() {
  return IngredientEntry.find({}).sort({ order: 1, createdAt: 1 }).lean();
}

/**
 * The whole library in reference-table order, as plain rows.
 *
 * An empty collection is seeded with the built-in rows on its first read (from
 * the app or the worker, whichever gets there first). Deleting every row
 * therefore brings the defaults back.
 *
 * @returns {Promise<import('./ingredient-library.js').LibraryEntry[]>}
 */
async function loadIngredientLibrary() {
  let docs = await readAll();
  if (docs.length === 0) {
    try {
      // Wait for the unique key index, so a simultaneous seed cannot double up.
      await IngredientEntry.init();
      await IngredientEntry.insertMany(
        DEFAULT_INGREDIENT_LIBRARY.map((entry, index) => ({
          ...entry,
          key: normalizeName(entry.name),
          order: index
        })),
        { ordered: false }
      );
    } catch (error) {
      // Another process seeded at the same moment; the unique key kept one copy.
      if (!isDuplicateKeyError(error)) throw error;
    }
    docs = await readAll();
  }
  return docs.map(toEntry);
}

class LibraryError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'LibraryError';
    this.status = status;
  }
}

/** Mongoose throws a CastError for a malformed id; treat that as "not found". */
function findById(id) {
  return IngredientEntry.findById(String(id || '')).catch(() => null);
}

/**
 * Add a row at the end of the table.
 * @returns {Promise<import('./ingredient-library.js').LibraryEntry>}
 */
async function createIngredientEntry(input) {
  const library = await loadIngredientLibrary();
  const checked = validateLibraryEntry(input, library);
  if (!checked.ok) throw new LibraryError(checked.error);

  const last = await IngredientEntry.findOne({}).sort({ order: -1 }).lean();
  try {
    const doc = await IngredientEntry.create({
      ...checked.entry,
      key: normalizeName(checked.entry.name),
      order: last ? (last.order || 0) + 1 : 0
    });
    return toEntry(doc);
  } catch (error) {
    if (isDuplicateKeyError(error)) throw new LibraryError(`"${checked.entry.name}" is already in the library.`, 409);
    throw error;
  }
}

/**
 * Replace a row's names and figures, keeping its place in the table.
 * @returns {Promise<import('./ingredient-library.js').LibraryEntry>}
 */
async function updateIngredientEntry(id, input) {
  const existing = await findById(id);
  if (!existing) throw new LibraryError('That ingredient is no longer in the library.', 404);

  const library = await loadIngredientLibrary();
  const checked = validateLibraryEntry(input, library.filter((entry) => entry.id !== String(existing._id)));
  if (!checked.ok) throw new LibraryError(checked.error);

  existing.set({ ...checked.entry, key: normalizeName(checked.entry.name) });
  try {
    await existing.save();
  } catch (error) {
    if (isDuplicateKeyError(error)) throw new LibraryError(`"${checked.entry.name}" is already in the library.`, 409);
    throw error;
  }
  return toEntry(existing);
}

/** Remove a row. Resolves false when it was already gone. */
async function deleteIngredientEntry(id) {
  const existing = await findById(id);
  if (!existing) return false;
  await existing.deleteOne();
  return true;
}

module.exports = {
  LibraryError,
  loadIngredientLibrary,
  createIngredientEntry,
  updateIngredientEntry,
  deleteIngredientEntry
};
