export async function mapInBatches<T, R>(
  items: readonly T[],
  batchSize: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error('mapInBatches requires a positive integer batchSize');
  }

  const results: R[] = [];
  for (let start = 0; start < items.length; start += batchSize) {
    const batch = items.slice(start, start + batchSize);
    const batchResults = await Promise.all(
      batch.map((item, batchIndex) => mapper(item, start + batchIndex)),
    );
    results.push(...batchResults);
  }
  return results;
}
