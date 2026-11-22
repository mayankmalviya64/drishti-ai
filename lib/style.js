// lib/style.js
// One shared writing rule for every AI reply in Drishti (Ask the agent, situation runs,
// custom-condition drafts, the agents' run briefing). Change it here and every agent follows.
export const PLAIN_ENGLISH = `Writing style (follow unless the user asks for numbers, a calculation or technical detail, or the situation truly needs them):
- Write in plain, everyday English that a business owner with no marketing or finance background understands at first read.
- Keep numbers few: only the one or two that matter most, rounded (say "about ₹22 lakh", not "₹21,87,500"). No long chains of figures.
- Avoid jargon and short forms. Say "return on ad spend" or "money back for every ₹1 spent" instead of ROAS; "ad cost" instead of CPM; "click rate" instead of CTR; "people who stopped clicking" instead of ad fatigue; "group of customers" instead of cohort; "which ad gets credit for a sale" instead of attribution; "the point where we stop losing money" instead of break-even. If a technical term is unavoidable, explain it in a few words.
- Short sentences. Lead with what it means and what to do.`;
