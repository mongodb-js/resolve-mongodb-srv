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
  const srv = `.${srvAddress.replace(regex, '')}`;
  const parent = `.${parentDomain.replace(regex, '')}`;
  return srv.endsWith(parent);
}

async function resolveDnsSrvRecord (dns: NonNullable<Options['dns']>, lookupAddress: string): Promise<string[]> {
  const addresses = await promisify(dns.resolveSrv)(`_mongodb._tcp.${lookupAddress}`);
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
  } catch (err) {
    if (err.code && (err.code !== 'ENODATA' && err.code !== 'ENOTFOUND')) {
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
  const [srvResult, txtResult] = await Promise.all([
    resolveDnsSrvRecord(dns, lookupAddress),
    resolveDnsTxtRecord(dns, lookupAddress)
  ]);

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

  return url.toString().replace('__DUMMY_HOSTNAME__', srvResult.join(','));
}

export = resolveMongodbSrv;
