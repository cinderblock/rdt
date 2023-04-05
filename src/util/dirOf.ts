export function dirOf(path: string) {
  return path.replace(/\/?[^\/]+$/, '');
}
