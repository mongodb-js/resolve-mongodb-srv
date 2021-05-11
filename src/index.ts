import { URL, URLSearchParams } from 'whatwg-url';

class MongoParseError extends Error {}

type Options = {
  dns?: {
    resolveSrv(hostname: string, cb: (err: Error | undefined, addresses: { name: string, port: number }[] | undefined) => void): void;
    resolveTxt(hostname: string, cb: (err: Error | undefined, addresses: string[][] | undefined) => void): void;
  };
};

function matchesParentDomain (srvAddress: string, parentDomain: string): boolean {
  const regex = /^.*?\./;
  const srv = `.${srvAddress.replace(regex, '')}`;
  const parent = `.${parentDomain.replace(regex, '')}`;
  return srv.endsWith(parent);
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
    (async () => {
      const addresses = await new Promise<{name: string, port: number}[]>((resolve, reject) => {
        dns.resolveSrv(`_mongodb._tcp.${lookupAddress}`,
          (err: Error | null, addresses: { name: string, port: number }[]) => {
            if (err) return reject(err);
            return resolve(addresses);
          });
      });
      if (addresses.length === 0) {
        throw new MongoParseError('No addresses found at host');
      }

      for (const { name } of addresses) {
        if (!matchesParentDomain(name, lookupAddress)) {
          throw new MongoParseError('Server record does not share hostname with parent URI');
        }
      }

      return addresses.map(r => r.name + ((r.port ?? 27017) === 27017 ? '' : `:${r.port}`));
    })(),
    (async () => {
      const txtRecord = await new Promise<string>((resolve, reject) => {
        dns.resolveTxt(lookupAddress, (err: (Error & { code: string }) | null, record: string[][]) => {
          if (err) {
            if (err.code && (err.code !== 'ENODATA' && err.code !== 'ENOTFOUND')) {
              reject(err);
            } else {
              resolve('');
            }
          } else {
            if (record.length > 1) {
              reject(new MongoParseError('Multiple text records not allowed'));
            } else {
              resolve(record[0]?.join('') ?? '');
            }
          }
        });
      });

      const txtRecordOptions = new URLSearchParams(txtRecord);
      const txtRecordOptionKeys = [...txtRecordOptions.keys()];
      if (txtRecordOptionKeys.some(key => key !== 'authSource' && key !== 'replicaSet')) {
        throw new MongoParseError('Text record must only set `authSource` or `replicaSet`');
      }

      const source = txtRecordOptions.get('authSource') ?? undefined;
      const replicaSet = txtRecordOptions.get('replicaSet') ?? undefined;

      if (source === '' || replicaSet === '') {
        throw new MongoParseError('Cannot have empty URI params in DNS TXT Record');
      }

      return txtRecordOptions;
    })()
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
