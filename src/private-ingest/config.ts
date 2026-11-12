import { z } from 'zod';
import type { PinnedSubjects } from '../ingest/oidc-allowlist.js';
import { PrivateIngestError } from './reason.js';

const key = z.string().regex(/^[a-z][a-z0-9-]{0,63}(?![\s\S])/u);
const slug = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*(?![\s\S])/u);
const text = z
  .string()
  .min(1)
  .max(512)
  .refine((s) =>
    [...s].every((character) => character.charCodeAt(0) > 32 && character.charCodeAt(0) !== 127),
  );
const source = z
  .object({
    key,
    githubRepo: slug,
    release: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('tag'), tag: text }).strict(),
      z.object({ kind: z.literal('latest') }).strict(),
    ]),
    asset: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}(?![\s\S])/u),
    credentialRef: key,
    operatorConfirmed: z.literal(true),
    subjects: z.array(text).min(1).max(32),
    workflowRefs: z.array(text).min(1).max(32),
  })
  .strict();
const schema = z
  .object({
    version: z.literal(1),
    issuer: z.literal('https://token.actions.githubusercontent.com'),
    sources: z.array(source).min(1).max(100),
    credentials: z
      .array(z.object({ ref: key, repositories: z.array(slug).min(1).max(100) }).strict())
      .min(1)
      .max(100),
    // Exact approved hostnames only. This is operator policy, not a vendor guarantee.
    downloadHosts: z
      .array(z.string().regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?![\s\S])/u))
      .min(1)
      .max(8),
  })
  .strict();
export type PrivateConfig = z.infer<typeof schema>;
export type PrivateSource = PrivateConfig['sources'][number];

export function parsePrivateConfig(raw: unknown): PrivateConfig {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new PrivateIngestError('configuration_invalid');
  const config = parsed.data;
  const refs = new Map(config.credentials.map((c) => [c.ref, c.repositories]));
  const keys = new Set(config.sources.map((s) => s.key));
  if (refs.size !== config.credentials.length || keys.size !== config.sources.length) {
    throw new PrivateIngestError('configuration_invalid');
  }
  for (const s of config.sources) {
    const allowed = refs.get(s.credentialRef);
    if (
      !allowed?.includes(s.githubRepo) ||
      !s.subjects.every((p) => p.startsWith(`repo:${s.githubRepo}:`)) ||
      !s.workflowRefs.every((p) => p.startsWith(`${s.githubRepo}/`))
    ) {
      throw new PrivateIngestError('configuration_invalid');
    }
  }
  return config;
}

export function privatePins(config: PrivateConfig): PinnedSubjects {
  return {
    issuer: config.issuer,
    repos: Object.fromEntries(
      config.sources.map((s) => [
        s.key,
        {
          githubRepo: s.githubRepo,
          subjects: s.subjects,
          workflowRefs: s.workflowRefs,
          operatorConfirmed: true,
        },
      ]),
    ),
  };
}
