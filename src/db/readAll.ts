export async function readAll<T>(query: (from: number, to: number) => any): Promise<T[]> {
  const rows: T[] = [];
  let previous: string | undefined;
  for (let from = 0; from < 1000000; ) {
    const { data, error } = await query(from, from + 499);
    if (error) throw error;
    const page = (data ?? []) as T[];
    if (!page.length) return rows;
    const signature = JSON.stringify(page);
    if (signature === previous) throw Error('Database pagination did not advance');
    previous = signature;
    rows.push(...page);
    from += page.length;
    if (page.length < 500) {
      const probe = await query(from, from);
      if (probe.error) throw probe.error;
      if (!probe.data?.length) return rows;
    }
  }
  throw Error('Database pagination capacity exceeded');
}
