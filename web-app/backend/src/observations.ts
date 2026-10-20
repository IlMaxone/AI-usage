// A successful OCR replacement becomes the new base. Older manual corrections
// remain in the audit trail, but must not silently mask the replacement.
export function currentObservations<T extends { uploadId: string; createdAt: Date }>(
  observations: T[], snapshots: Array<{ uploadId: string; createdAt?: Date }>,
): T[] {
  const dates = new Map(snapshots.map((snapshot) => [snapshot.uploadId, snapshot.createdAt]));
  return observations.filter((observation) => {
    const date = dates.get(observation.uploadId);
    return !date || new Date(observation.createdAt) >= new Date(date);
  });
}
