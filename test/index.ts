import resolveMongodbSrv from '..';
import dns from 'dns';
import osDns from 'os-dns-native';
import assert from 'assert';

describe('resolveMongodbSrv', () => {
  context('with a fake resolver', () => {
    let srvError: Error | null;
    let srvResult: any[];
    let txtError: Error | null;
    let txtResult: string[][];
    let srvQueries: string[];
    let txtQueries: string[];

    const dns = {
      resolveSrv (hostname: string, cb: any): void {
        srvQueries.push(hostname);
        process.nextTick(cb, srvError, srvResult);
      },
      resolveTxt (hostname: string, cb: any): void {
        txtQueries.push(hostname);
        process.nextTick(cb, txtError, txtResult);
      }
    };

    beforeEach(() => {
      srvError = null;
      srvResult = [];
      srvQueries = [];
      txtError = null;
      txtResult = [];
      txtQueries = [];
    });

    it('resolves URLs properly', async () => {
      srvResult = [
        { name: 'asdf.example.com', port: 27017 },
        { name: 'meow.example.com', port: 27017 }
      ];
      assert.strictEqual(
        await resolveMongodbSrv('mongodb+srv://server.example.com', { dns }),
        'mongodb://asdf.example.com,meow.example.com/?tls=true');
    });

    it('keeps mongodb:// URLs intact', async () => {
      assert.strictEqual(
        await resolveMongodbSrv('mongodb://somewhere.example.com', { dns }),
        'mongodb://somewhere.example.com');
    });

    it('rejects non-mongodb schemes', async () => {
      assert.rejects(resolveMongodbSrv('http://somewhere.example.com', { dns }));
    });

    it('rejects mongodb+srv with port', async () => {
      assert.rejects(resolveMongodbSrv('mongodb+srv://somewhere.example.com:27017', { dns }));
    });

    it('rejects when the SRV lookup rejects', async () => {
      srvError = new Error();
      assert.rejects(resolveMongodbSrv('mongodb+srv://server.example.com', { dns }));
    });

    it('rejects when the SRV lookup returns no results', async () => {
      srvResult = [];
      assert.rejects(resolveMongodbSrv('mongodb+srv://server.example.com', { dns }));
    });

    it('rejects when the SRV lookup returns foreign hostnames', async () => {
      srvResult = [{ name: 'server.example.org', port: 27017 }];
      assert.rejects(resolveMongodbSrv('mongodb+srv://server.example.com', { dns }));
    });

    it('respects SRV-provided ports', async () => {
      srvResult = [{ name: 'asdf.example.com', port: 27018 }];
      assert.strictEqual(
        await resolveMongodbSrv('mongodb+srv://server.example.com', { dns }),
        'mongodb://asdf.example.com:27018/?tls=true');
    });

    it('rejects when the TXT lookup rejects with a fatal error', async () => {
      srvResult = [{ name: 'asdf.example.com', port: 27017 }];
      txtError = Object.assign(new Error(), { code: 'ENOENT' });
      assert.rejects(resolveMongodbSrv('mongodb+srv://server.example.com', { dns }));
    });

    it('does not reject when the TXT lookup results in ENOTFOUND', async () => {
      srvResult = [{ name: 'asdf.example.com', port: 27017 }];
      txtError = Object.assign(new Error(), { code: 'ENOTFOUND' });
      assert.strictEqual(
        await resolveMongodbSrv('mongodb+srv://server.example.com', { dns }),
        'mongodb://asdf.example.com/?tls=true');
    });

    it('does not reject when the TXT lookup results in a generic error', async () => {
      srvResult = [{ name: 'asdf.example.com', port: 27017 }];
      txtError = new Error();
      assert.strictEqual(
        await resolveMongodbSrv('mongodb+srv://server.example.com', { dns }),
        'mongodb://asdf.example.com/?tls=true');
    });

    it('rejects when the TXT lookup returns more than one result', async () => {
      srvResult = [{ name: 'asdf.example.com', port: 27017 }];
      txtResult = [['a'], ['b']];
      assert.rejects(resolveMongodbSrv('mongodb+srv://server.example.com', { dns }));
    });

    it('rejects when the TXT lookup returns invalid connection string options', async () => {
      srvResult = [{ name: 'asdf.example.com', port: 27017 }];
      txtResult = [['a=b']];
      assert.rejects(resolveMongodbSrv('mongodb+srv://server.example.com', { dns }));
    });

    it('accepts TXT lookup authSource', async () => {
      srvResult = [{ name: 'asdf.example.com', port: 27017 }];
      txtResult = [['authSource=admin']];
      assert.strictEqual(
        await resolveMongodbSrv('mongodb+srv://server.example.com', { dns }),
        'mongodb://asdf.example.com/?authSource=admin&tls=true');
    });

    it('rejects empty TXT lookup authSource', async () => {
      srvResult = [{ name: 'asdf.example.com', port: 27017 }];
      txtResult = [['authSource=']];
      assert.rejects(resolveMongodbSrv('mongodb+srv://server.example.com', { dns }));
    });

    it('prioritizes URL-provided over TXT lookup authSource', async () => {
      srvResult = [{ name: 'asdf.example.com', port: 27017 }];
      txtResult = [['authSource=admin']];
      assert.strictEqual(
        await resolveMongodbSrv('mongodb+srv://server.example.com/?authSource=test', { dns }),
        'mongodb://asdf.example.com/?authSource=test&tls=true');
    });

    it('accepts TXT lookup replicaSet', async () => {
      srvResult = [{ name: 'asdf.example.com', port: 27017 }];
      txtResult = [['replicaSet=foo']];
      assert.strictEqual(
        await resolveMongodbSrv('mongodb+srv://server.example.com', { dns }),
        'mongodb://asdf.example.com/?replicaSet=foo&tls=true');
    });

    it('rejects empty TXT lookup replicaSet', async () => {
      srvResult = [{ name: 'asdf.example.com', port: 27017 }];
      txtResult = [['replicaSet=']];
      assert.rejects(resolveMongodbSrv('mongodb+srv://server.example.com', { dns }));
    });

    it('prioritizes URL-provided over TXT lookup replicaSet', async () => {
      srvResult = [{ name: 'asdf.example.com', port: 27017 }];
      txtResult = [['replicaSet=foo']];
      assert.strictEqual(
        await resolveMongodbSrv('mongodb+srv://server.example.com/?replicaSet=bar', { dns }),
        'mongodb://asdf.example.com/?replicaSet=bar&tls=true');
    });

    it('prioritizes URL-provided tls over srv implication', async () => {
      srvResult = [{ name: 'asdf.example.com', port: 27017 }];
      assert.strictEqual(
        await resolveMongodbSrv('mongodb+srv://server.example.com/?tls=false', { dns }),
        'mongodb://asdf.example.com/?tls=false');
    });
  });

  for (const [name, dnsProvider] of [
    ['default', undefined],
    ['Node.js', dns],
    ['OS-provided', osDns]
  ]) {
    context(`integration with ${name} DNS API`, function () {
      this.timeout(30_000);

      it('works', async () => {
        const str = await resolveMongodbSrv('mongodb+srv://user:password@cluster0.ucdwm.mongodb.net/', dnsProvider);
        assert([
          'mongodb://user:password@cluster0-shard-00-00.ucdwm.mongodb.net,cluster0-shard-00-01.ucdwm.mongodb.net,cluster0-shard-00-02.ucdwm.mongodb.net/?authSource=admin&replicaSet=atlas-jt9dqp-shard-0&tls=true',
          'mongodb://user:password@cluster0-shard-00-00.ucdwm.mongodb.net,cluster0-shard-00-02.ucdwm.mongodb.net,cluster0-shard-00-01.ucdwm.mongodb.net/?authSource=admin&replicaSet=atlas-jt9dqp-shard-0&tls=true',
          'mongodb://user:password@cluster0-shard-00-01.ucdwm.mongodb.net,cluster0-shard-00-00.ucdwm.mongodb.net,cluster0-shard-00-02.ucdwm.mongodb.net/?authSource=admin&replicaSet=atlas-jt9dqp-shard-0&tls=true',
          'mongodb://user:password@cluster0-shard-00-01.ucdwm.mongodb.net,cluster0-shard-00-02.ucdwm.mongodb.net,cluster0-shard-00-00.ucdwm.mongodb.net/?authSource=admin&replicaSet=atlas-jt9dqp-shard-0&tls=true',
          'mongodb://user:password@cluster0-shard-00-02.ucdwm.mongodb.net,cluster0-shard-00-00.ucdwm.mongodb.net,cluster0-shard-00-01.ucdwm.mongodb.net/?authSource=admin&replicaSet=atlas-jt9dqp-shard-0&tls=true',
          'mongodb://user:password@cluster0-shard-00-02.ucdwm.mongodb.net,cluster0-shard-00-01.ucdwm.mongodb.net,cluster0-shard-00-00.ucdwm.mongodb.net/?authSource=admin&replicaSet=atlas-jt9dqp-shard-0&tls=true'
        ].includes(str), `Unexpected result: ${str}`);
      });
    });
  }
});
