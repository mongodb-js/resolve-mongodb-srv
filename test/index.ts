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
      await assert.rejects(resolveMongodbSrv('http://somewhere.example.com', { dns }));
    });

    it('rejects mongodb+srv with port', async () => {
      await assert.rejects(resolveMongodbSrv('mongodb+srv://somewhere.example.com:27017', { dns }));
    });

    it('rejects when the SRV lookup rejects', async () => {
      srvError = new Error();
      await assert.rejects(resolveMongodbSrv('mongodb+srv://server.example.com', { dns }));
    });

    it('rejects when the SRV lookup returns no results', async () => {
      srvResult = [];
      await assert.rejects(resolveMongodbSrv('mongodb+srv://server.example.com', { dns }));
    });

    it('rejects when the SRV lookup returns foreign hostnames', async () => {
      srvResult = [{ name: 'server.example.org', port: 27017 }];
      await assert.rejects(resolveMongodbSrv('mongodb+srv://server.example.com', { dns }));
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
      await assert.rejects(resolveMongodbSrv('mongodb+srv://server.example.com', { dns }));
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
      await assert.rejects(resolveMongodbSrv('mongodb+srv://server.example.com', { dns }));
    });

    it('rejects when the TXT lookup returns invalid connection string options', async () => {
      srvResult = [{ name: 'asdf.example.com', port: 27017 }];
      txtResult = [['a=b']];
      await assert.rejects(resolveMongodbSrv('mongodb+srv://server.example.com', { dns }));
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
      await assert.rejects(resolveMongodbSrv('mongodb+srv://server.example.com', { dns }));
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
      await assert.rejects(resolveMongodbSrv('mongodb+srv://server.example.com', { dns }));
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

    it('accepts TXT lookup loadBalanced', async () => {
      srvResult = [{ name: 'asdf.example.com', port: 27017 }];
      txtResult = [['loadBalanced=true']];
      assert.strictEqual(
        await resolveMongodbSrv('mongodb+srv://server.example.com', { dns }),
        'mongodb://asdf.example.com/?loadBalanced=true&tls=true');
    });

    it('rejects empty TXT lookup loadBalanced', async () => {
      srvResult = [{ name: 'asdf.example.com', port: 27017 }];
      txtResult = [['loadBalanced=']];
      await assert.rejects(resolveMongodbSrv('mongodb+srv://server.example.com', { dns }));
    });

    it('rejects non true/false TXT lookup loadBalanced', async () => {
      srvResult = [{ name: 'asdf.example.com', port: 27017 }];
      txtResult = [['loadBalanced=bla']];
      await assert.rejects(resolveMongodbSrv('mongodb+srv://server.example.com', { dns }));
    });

    it('prioritizes URL-provided over TXT lookup loadBalanced', async () => {
      srvResult = [{ name: 'asdf.example.com', port: 27017 }];
      txtResult = [['loadBalanced=false']];
      assert.strictEqual(
        await resolveMongodbSrv('mongodb+srv://server.example.com/?loadBalanced=true', { dns }),
        'mongodb://asdf.example.com/?loadBalanced=true&tls=true');
    });

    it('allows specifying a custom SRV service name', async () => {
      srvResult = [{ name: 'asdf.example.com', port: 27017 }];
      txtResult = [['loadBalanced=false']];
      assert.strictEqual(
        await resolveMongodbSrv('mongodb+srv://server.example.com/?loadBalanced=true&srvServiceName=custom', { dns }),
        'mongodb://asdf.example.com/?loadBalanced=true&tls=true');
      assert.deepStrictEqual(srvQueries, ['_custom._tcp.server.example.com']);
    });

    it('defaults to _mongodb._tcp as a SRV service name', async () => {
      srvResult = [{ name: 'asdf.example.com', port: 27017 }];
      txtResult = [['loadBalanced=false']];
      assert.strictEqual(
        await resolveMongodbSrv('mongodb+srv://server.example.com/?loadBalanced=true', { dns }),
        'mongodb://asdf.example.com/?loadBalanced=true&tls=true');
      assert.deepStrictEqual(srvQueries, ['_mongodb._tcp.server.example.com']);
    });

    it('allows limiting the SRV result to a specific number of hosts', async () => {
      srvResult = ['host1', 'host2', 'host3'].map(name => ({ name: `${name}.example.com`, port: 27017 }));
      txtResult = [];
      assert.strictEqual(
        await resolveMongodbSrv('mongodb+srv://server.example.com/?srvMaxHosts=0', { dns }),
        'mongodb://host1.example.com,host2.example.com,host3.example.com/?tls=true');
      assert.strictEqual(
        await resolveMongodbSrv('mongodb+srv://server.example.com/?srvMaxHosts=3', { dns }),
        'mongodb://host1.example.com,host2.example.com,host3.example.com/?tls=true');
      assert.strictEqual(
        await resolveMongodbSrv('mongodb+srv://server.example.com/?srvMaxHosts=6', { dns }),
        'mongodb://host1.example.com,host2.example.com,host3.example.com/?tls=true');
      assert.match(
        await resolveMongodbSrv('mongodb+srv://server.example.com/?srvMaxHosts=1', { dns }),
        /^mongodb:\/\/host[1-3]\.example\.com\/\?tls=true$/);
    });

    it('rejects SRV records without additional subdomain when parent domain has fewer than 3 parts', async () => {
      txtResult = [];
      srvResult = [{ name: 'example.com', port: 27017 }];
      await assert.rejects(resolveMongodbSrv('mongodb+srv://example.com', { dns }));
    });

    it('not strip first subdomain when parent domain has fewer than 3 part to prevent TLD-only matching', async () => {
      txtResult = [];
      srvResult = [{ name: 'asdf.malicious.com', port: 27017 }];
      await assert.rejects(resolveMongodbSrv('mongodb+srv://example.com', { dns }));
    });

    it('allow trailing dot in SRV lookup', async () => {
      txtResult = [];
      srvResult = [
        { name: 'asdf.example.com', port: 27017 },
        { name: 'meow.example.com', port: 27017 }
      ];
      assert.strictEqual(
        await resolveMongodbSrv('mongodb+srv://server.example.com.', { dns }),
        'mongodb://asdf.example.com,meow.example.com/?tls=true');

      srvResult = [
        { name: 'asdf.example.com.', port: 27017 },
        { name: 'meow.example.com', port: 27017 }
      ];
      assert.strictEqual(
        await resolveMongodbSrv('mongodb+srv://server.example.com', { dns }),
        'mongodb://asdf.example.com.,meow.example.com/?tls=true');
      assert.strictEqual(
        await resolveMongodbSrv('mongodb+srv://server.example.com.', { dns }),
        'mongodb://asdf.example.com.,meow.example.com/?tls=true');
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
        const str = await resolveMongodbSrv('mongodb+srv://user:password@cluster0.ucdwm.mongodb.net/', { dns: dnsProvider } as any);
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
