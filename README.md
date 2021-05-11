# resolve-mongodb-srv

Resolve mongodb+srv:// URLs to mongodb:// URLs

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

## LICENSE

Apache-2.0
