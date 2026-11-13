import { NextResponse } from 'next/server';
import { dbConnect } from '@/lib/db';
import { isAuthenticated } from '@/lib/auth';
import {
  LibraryError,
  loadIngredientLibrary,
  createIngredientEntry,
  updateIngredientEntry,
  deleteIngredientEntry
} from '@/lib/ingredient-store';

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

function failure(error: unknown, action: string) {
  if (error instanceof LibraryError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(`Error ${action} the ingredient library:`, error);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

/**
 * GET /api/ingredients — the whole library, in reference-table order.
 * Seeds the built-in defaults the first time it is read.
 */
export async function GET() {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    await dbConnect();
    return NextResponse.json({ entries: await loadIngredientLibrary() }, NO_STORE);
  } catch (error) {
    return failure(error, 'loading');
  }
}

/** POST /api/ingredients { name, aliases, kcal, protein, carbs, fat, sodium, potassium, note } */
export async function POST(req: Request) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const body = await req.json().catch(() => null);
    await dbConnect();
    const entry = await createIngredientEntry(body);
    return NextResponse.json({ entry }, { status: 201, ...NO_STORE });
  } catch (error) {
    return failure(error, 'adding to');
  }
}

/** PUT /api/ingredients { id, ...fields } — replaces that row's names and figures. */
export async function PUT(req: Request) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const body = await req.json().catch(() => null) as { id?: unknown } | null;
    if (!body || typeof body.id !== 'string' || !body.id) {
      return NextResponse.json({ error: 'An ingredient id is required.' }, { status: 400 });
    }
    await dbConnect();
    const entry = await updateIngredientEntry(body.id, body);
    return NextResponse.json({ entry }, NO_STORE);
  } catch (error) {
    return failure(error, 'updating');
  }
}

/** DELETE /api/ingredients?id=… */
export async function DELETE(req: Request) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const id = new URL(req.url).searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'An ingredient id is required.' }, { status: 400 });
    }
    await dbConnect();
    const deleted = await deleteIngredientEntry(id);
    return NextResponse.json({ success: true, deleted }, NO_STORE);
  } catch (error) {
    return failure(error, 'deleting from');
  }
}
