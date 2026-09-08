# resolve-mongodb-srv

Resolve `mongodb+srv://` URLs to `mongodb://` URLs as specified in the
[Initial DNS Seedlist Discovery Specification](https://github.com/mongodb/specifications/blob/master/source/initial-dns-seedlist-discovery/initial-dns-seedlist-discovery.rst).

```js
import resolveMongodbSrv from 'resolve-mongodb-srv';

await resolveMongodbSrv('mongodb+srv://user:password@somecluster.mongodb.net/db');
// Returns: mongodb://user:password@host1,host2,host3/db
```

The `resolveMongodbSrv` function takes an optional second argument, where the
used `dns` implementation can be passed in:

```js
import dns from 'dns';
import resolveMongodbSrv from 'resolve-mongodb-srv';

await resolveMongodbSrv('hostname', { dns });
```

When only one step of the resolution is needed (for example the driver-mirroring
DNS TXT-record parsing), the DNS helpers are available as public exports on the
module:

```js
import resolveMongodbSrv from 'resolve-mongodb-srv';

// Parse a hostname's DNS TXT record into a URLSearchParams containing the
// driver-sanctioned connection options (authSource, replicaSet, loadBalanced),
// mirroring the driver's own TXT validation.
const params = await resolveMongodbSrv.resolveDnsTxtRecord(dns, 'cluster0.example.com');

// Resolve the SRV records for a service and hostname.
const addresses = await resolveMongodbSrv.resolveDnsSrvRecord(dns, 'cluster0.example.com', 'mongodb');
```

Both helpers throw `resolveMongodbSrv.MongoParseError` on invalid input.

## LICENSE

Apache-2.0
