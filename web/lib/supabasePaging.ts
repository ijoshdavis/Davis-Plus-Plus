// Supabase's PostgREST caps every response at 1,000 rows server-side
// regardless of a client-requested .limit() - confirmed directly against
// this project (content-range: 0-999/*). Page through with .range()
// instead, ordered by a unique column so pages don't skip/duplicate rows.
export const DEFAULT_PAGE_SIZE = 1000;

export async function fetchAllPages<T>(
  pageSize: number,
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await query(from, from + pageSize - 1);
    if (error) {
      console.error(error);
      break;
    }
    all.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return all;
}
