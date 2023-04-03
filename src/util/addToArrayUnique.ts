function addToArrayUnique<T>(array: T[], ...items: T[]) {
  for (const item of items) {
    if (!array.includes(item)) array.push(item);
  }
}
