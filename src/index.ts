import { promisify } from 'util';
import { URL, URLSearchParams } from 'whatwg-url';

class MongoParseError extends Error {}

type Address = { name: string; port: number };
type Options = {
  dns?: {
    resolveSrv(hostname: string, cb: (err: Error | undefined | null, addresses: Address[] | undefined) => void): void;
    resolveTxt(hostname: string, cb: (err: Error | undefined | null, addresses: string[][] | undefined) => void): void;
  };
};

const ALLOWED_TXT_OPTIONS: Readonly<string[]> = ['authSource', 'replicaSet', 'loadBalanced'];

function matchesParentDomain (srvAddress: string, parentDomain: string): boolean {
  const regex = /^.*?\./;
  const srv = `.${(srvAddress.endsWith('.') ? srvAddress.slice(0, -1) : srvAddress).replace(regex, '')}`;
  const parent = `.${(parentDomain.endsWith('.') ? parentDomain.slice(0, -1) : parentDomain).replace(regex, '')}`;
  return srv.endsWith(parent);
}

async function resolveDnsSrvRecord (dns: NonNullable<Options['dns']>, lookupAddress: string, srvServiceName: string): Promise<string[]> {
  const addresses = await promisify(dns.resolveSrv)(`_${srvServiceName}._tcp.${lookupAddress}`);
  if (!addresses?.length) {
    throw new MongoParseError('No addresses found at host');
  }

  for (const { name } of addresses) {
    if (!matchesParentDomain(name, lookupAddress)) {
      throw new MongoParseError('Server record does not share hostname with parent URI');
    }
  }

  return addresses.map(r => r.name + ((r.port ?? 27017) === 27017 ? '' : `:${r.port}`));
}

async function resolveDnsTxtRecord (dns: NonNullable<Options['dns']>, lookupAddress: string): Promise<URLSearchParams> {
  let records: string[][] | undefined;
  try {
    records = await promisify(dns.resolveTxt)(lookupAddress);
  } catch (err: any) {
    if (err?.code && (err.code !== 'ENODATA' && err.code !== 'ENOTFOUND')) {
      throw err;
    }
  }

  let txtRecord: string;
  if (records && records.length > 1) {
    throw new MongoParseError('Multiple text records not allowed');
  } else {
    txtRecord = records?.[0]?.join('') ?? '';
  }

  const txtRecordOptions = new URLSearchParams(txtRecord);
  const txtRecordOptionKeys = [...txtRecordOptions.keys()];
  if (txtRecordOptionKeys.some(key => !ALLOWED_TXT_OPTIONS.includes(key))) {
    throw new MongoParseError(`Text record must only set ${ALLOWED_TXT_OPTIONS.join(', ')}`);
  }

  const source = txtRecordOptions.get('authSource') ?? undefined;
  const replicaSet = txtRecordOptions.get('replicaSet') ?? undefined;
  const loadBalanced = txtRecordOptions.get('loadBalanced') ?? undefined;

  if (source === '' || replicaSet === '' || loadBalanced === '') {
    throw new MongoParseError('Cannot have empty URI params in DNS TXT Record');
  }

  if (loadBalanced !== undefined && loadBalanced !== 'true' && loadBalanced !== 'false') {
    throw new MongoParseError(`DNS TXT Record contains invalid value ${loadBalanced} for loadBalanced option (allowed: true, false)`);
  }

  return txtRecordOptions;
}

async function resolveMongodbSrv (input: string, options?: Options): Promise<string> {
  const dns = options?.dns ?? require('dns');

  if (input.startsWith('mongodb://')) {
    return input;
  }
  if (!input.startsWith('mongodb+srv://')) {
    throw new MongoParseError('Unknown URL scheme');
  }

  const url = new URL(input);
  if (url.port) {
    throw new Error('mongodb+srv:// URL cannot have port number');
  }

  const lookupAddress = url.hostname;
  const srvServiceName = url.searchParams.get('srvServiceName') || 'mongodb';
  const srvMaxHosts = +(url.searchParams.get('srvMaxHosts') || '0');

  const [srvResult, txtResult] = await Promise.all([
    resolveDnsSrvRecord(dns, lookupAddress, srvServiceName),
    resolveDnsTxtRecord(dns, lookupAddress)
  ]);

  if (srvMaxHosts && srvMaxHosts < srvResult.length) {
    // Replace srvResult with shuffled + limited srvResult
    srvResult.splice(0, srvResult.length, ...shuffle(srvResult, srvMaxHosts));
  }

  url.protocol = 'mongodb:';
  url.hostname = '__DUMMY_HOSTNAME__';
  if (!url.pathname) {
    url.pathname = '/';
  }
  for (const [key, value] of txtResult) {
    if (!url.searchParams.has(key)) {
      url.searchParams.set(key, value);
    }
  }
  if (!url.searchParams.has('tls') && !url.searchParams.has('ssl')) {
    url.searchParams.set('tls', 'true');
  }
  url.searchParams.delete('srvServiceName');
  url.searchParams.delete('srvMaxHosts');

  return url.toString().replace('__DUMMY_HOSTNAME__', srvResult.join(','));
}

/**
 * Fisher–Yates Shuffle
 * (shamelessly copied from https://github.com/mongodb/node-mongodb-native/blob/1f8b539cd3d60dd9f36baa22fd287241b5c65380/src/utils.ts#L1423-L1451)
 *
 * Reference: https://bost.ocks.org/mike/shuffle/
 * @param sequence - items to be shuffled
 * @param limit - Defaults to `0`. If nonzero shuffle will slice the randomized array e.g, `.slice(0, limit)` otherwise will return the entire randomized array.
 */
function shuffle<T> (sequence: Iterable<T>, limit = 0): Array<T> {
  const items = Array.from(sequence); // shallow copy in order to never shuffle the input

  limit = Math.min(limit, items.length);

  let remainingItemsToShuffle = items.length;
  const lowerBound = limit % items.length === 0 ? 1 : items.length - limit;
  while (remainingItemsToShuffle > lowerBound) {
    // Pick a remaining element
    const randomIndex = Math.floor(Math.random() * remainingItemsToShuffle);
    remainingItemsToShuffle -= 1;

    // And swap it with the current element
    const swapHold = items[remainingItemsToShuffle];
    items[remainingItemsToShuffle] = items[randomIndex];
    items[randomIndex] = swapHold;
  }

  return limit % items.length === 0 ? items : items.slice(lowerBound);
}

export = resolveMongodbSrv;
