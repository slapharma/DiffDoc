/**
 * Local high-risk-pattern flagging — runs on every changed chunk before (and
 * independently of) the AI layer. Per the build plan: numbers, dates, and
 * negations are the patterns where a small wording change carries outsized
 * risk (dosing 20mg -> 40mg, "should" -> "must not", shifted expiry dates).
 */
export type FlagReason = "number" | "date" | "negation";

const NUMBER_RE = /\d/;

const MONTH = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;

// Month names only count as dates next to digits ("12 May", "May 2026") so a
// bare modal "may" never flags.
const DATE_RE = new RegExp(
  [
    String.raw`\b\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b`, // 12/05/2026, 2026-05-12
    String.raw`\b\d{1,2}(?:st|nd|rd|th)?\s+${MONTH}\b`, // 12 May, 3rd March
    String.raw`\b${MONTH}\.?\s+\d{1,4}\b`, // May 12, May 2026
  ].join("|"),
  "gi",
);

const NEGATION_RE =
  /\b(?:not|no|never|none|neither|nor|cannot|can't|won't|don't|doesn't|isn't|aren't|mustn't|shouldn't|shall not|must not|without|except|unless|exclude[ds]?|prohibit(?:ed|s)?|forbidden|contraindicated)\b/i;

/** Human-readable labels for the register UI. */
export const FLAG_LABELS: Record<FlagReason, string> = {
  number: "Numerical change",
  date: "Date change",
  negation: "Negation / polarity",
};

export function detectFlags(text: string): FlagReason[] {
  const reasons: FlagReason[] = [];
  // Note: DATE_RE has the g flag, which makes .test() stateful — compare the
  // replace result instead.
  const withoutDates = text.replace(DATE_RE, " ");
  if (withoutDates !== text) reasons.push("date");
  if (NUMBER_RE.test(withoutDates)) reasons.push("number");
  if (NEGATION_RE.test(text)) reasons.push("negation");
  return reasons;
}
