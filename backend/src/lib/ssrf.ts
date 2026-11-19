import dns from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { Agent } from 'undici';
import type { LookupFunction } from 'node:net';
import { env } from '../config/env.js';
import { AppError } from './errors.js';

function normalizedAddress(address: string): string {
  const parsed = ipaddr.parse(address);
  if (parsed.kind() === 'ipv6') {
    const ipv6 = parsed as ipaddr.IPv6;
    if (ipv6.isIPv4MappedAddress()) return ipv6.toIPv4Address().toString();
  }
  return parsed.toString();
}

function assertPublicAddress(address: string): void {
  const normalized = ipaddr.parse(normalizedAddress(address));
  if (normalized.range() !== 'unicast') {
    throw new AppError(400, 'URL_NOT_ALLOWED', 'Watcher can only check public web addresses');
  }
}

export function parsePublicUrl(raw: string): URL {
  if (raw.length > 2048)
    throw new AppError(400, 'URL_NOT_ALLOWED', 'Watcher can only check public web addresses');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError(400, 'URL_NOT_ALLOWED', 'Watcher can only check public web addresses');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new AppError(400, 'URL_NOT_ALLOWED', 'Watcher can only check public web addresses');
  if (url.username || url.password)
    throw new AppError(400, 'URL_NOT_ALLOWED', 'Watcher can only check public web addresses');
  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost')
  ) {
    throw new AppError(400, 'URL_NOT_ALLOWED', 'Watcher can only check public web addresses');
  }
  return url;
}

export async function assertPublicUrl(raw: string): Promise<void> {
  if (env.ALLOW_PRIVATE_TARGETS) return;
  const url = parsePublicUrl(raw);
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length)
    throw new AppError(400, 'URL_NOT_ALLOWED', 'Watcher can only check public web addresses');
  for (const item of addresses) assertPublicAddress(item.address);
}

export function createSafeAgent(): Agent {
  if (env.ALLOW_PRIVATE_TARGETS) return new Agent();
  const lookup: LookupFunction = (hostname, options, callback) => {
    const promise = dns.lookup(hostname, { all: true });
    void promise
      .then((addresses) => {
        try {
          for (const item of addresses) assertPublicAddress(item.address);
          if (typeof options === 'number' || options?.all) {
            callback(
              null,
              addresses.map((item) => ({
                address: normalizedAddress(item.address),
                family: item.family,
              })),
            );
          } else {
            callback(null, normalizedAddress(addresses[0].address), addresses[0].family);
          }
        } catch (error) {
          callback(error as Error, undefined as never);
        }
      })
      .catch((error) => callback(error as NodeJS.ErrnoException, undefined as never));
  };
  return new Agent({ connect: { lookup } });
}
