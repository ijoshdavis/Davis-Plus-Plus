// PIN login: a person's code is both their Supabase password and, via this
// deterministic mapping, their email - so the login screen only ever shows
// one field, while Supabase still issues a real session and RLS still runs
// unchanged. No custom backend, no service_role key.
//
// Weaker than email+password (the whole credential is a guessable-length
// numeric code, rate-limited only by Supabase's defaults) - a deliberate
// tradeoff for a small private family app, not for anything more exposed.
const PIN_EMAIL_DOMAIN = "kinstore.local";

export function emailForPin(pin: string): string {
  return `${pin}@${PIN_EMAIL_DOMAIN}`;
}
