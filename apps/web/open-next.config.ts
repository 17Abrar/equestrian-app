import { defineCloudflareConfig } from '@opennextjs/cloudflare';

/**
 * OpenNext adapter config for Cloudflare Workers.
 *
 * Defaults are sensible for our stack — we're not using ISR or on-demand
 * revalidation yet, so no override on `incrementalCache` or `tagCache` is
 * needed. If you later add `revalidate` to pages, wire a KV namespace here
 * and switch `incrementalCache` to `kvIncrementalCache`.
 */
export default defineCloudflareConfig({});
