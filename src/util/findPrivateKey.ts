import { readFile } from 'fs/promises';
import logger from '../log';

export async function findPrivateKey(): Promise<Buffer | null> {
  const home = process.platform === 'win32' ? process.env.UserProfile : process.env.HOME;
  if (!home) return null;
  logger.debug(`Looking for private key in ${home}/.ssh/id_rsa`);
  return readFile(`${home}/.ssh/id_rsa`).catch(() => null);
}
