import { startServer } from './server';

const env = process.env;
const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

const { close, port } = await startServer({
  port: num(env.PORT, 3000),
  host: env.HOST ?? '0.0.0.0',
  staticDir: env.STATIC_DIR ?? null,
  dataDir: env.DATA_DIR ?? null,
  version: env.HG_VERSION ?? 'dev',
  timing: {
    botDelay: num(env.HG_BOT_DELAY, 900),
    trickPause: num(env.HG_TRICK_PAUSE, 1500),
    handSummary: num(env.HG_HAND_SUMMARY, 9000),
    second: num(env.HG_SECOND_MS, 1000),
  },
});
console.log(`Hearts Gang server listening on :${port}`);

let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    if (stopping) return;
    stopping = true;
    console.log(`${sig}: saving tables and shutting down`);
    await close();
    process.exit(0);
  });
}
