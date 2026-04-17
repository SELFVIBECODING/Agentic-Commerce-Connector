export async function runPlaceholder(args: readonly string[]): Promise<void> {
  const cmd = args.join(" ");
  process.stdout.write(
    `acc ${cmd} — not implemented yet (deferred to a later phase).\n` +
      `For now, see 'acc help' for what's available.\n`,
  );
}
