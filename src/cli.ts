import resolveSRVRecord from './';

(async () => {
  process.stdout.write(await resolveSRVRecord(`${process.argv[2]}`) + '\n');
})().catch(err => process.nextTick(() => { throw err; }));
