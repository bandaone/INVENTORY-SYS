import * as Sentry from "@sentry/nextjs";

const configuredSampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE);

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || "",
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  tracesSampleRate: Number.isFinite(configuredSampleRate) && configuredSampleRate >= 0 && configuredSampleRate <= 1
    ? configuredSampleRate
    : process.env.NODE_ENV === 'production' ? 0.1 : 1,
  sendDefaultPii: false,
  debug: false,
});
