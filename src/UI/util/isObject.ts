export function isObject(value: any): value is { [key: string]: any } {
  return typeof value === 'object' && value !== null;
}
