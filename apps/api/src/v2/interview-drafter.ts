import { FailoverLlm, parseJsonObject } from './llm.js';

export interface DraftQuestion { topic: string; question: string; keyPoints: { point: string; keywords: string[] }[] }

const SYSTEM = 'You write campus-placement interview questions for a college placement office. Reply with only JSON: {"questions":[{"topic":"...","question":"...","keyPoints":[{"point":"...","keywords":["..."]}]}]}. One question per requested topic, in the same order. Each question must ask the student to explain something from their own work or reasoning, not trivia. Give 3 key points per question (short statements of what a good answer covers) and 3 to 6 lowercase keywords per key point. Never include personal data.';

/** Checks model output strictly. Returns null unless every question has the expected shape. */
export function validateDrafts(raw: any, topics: string[]): DraftQuestion[] | null {
  const qs = raw?.questions;
  if (!Array.isArray(qs) || qs.length !== topics.length) return null;
  const out: DraftQuestion[] = [];
  for (let i = 0; i < qs.length; i++) {
    const q = qs[i];
    if (typeof q?.question !== 'string' || q.question.trim().length < 20 || q.question.length > 600) return null;
    if (!Array.isArray(q.keyPoints) || q.keyPoints.length < 2 || q.keyPoints.length > 5) return null;
    const kps = q.keyPoints.map((k: any) => ({
      point: typeof k?.point === 'string' ? k.point.trim().slice(0, 200) : '',
      keywords: Array.isArray(k?.keywords) ? k.keywords.filter((w: unknown) => typeof w === 'string' && w.trim()).map((w: string) => w.trim().toLowerCase().slice(0, 40)).slice(0, 8) : [],
    }));
    if (kps.some((k: any) => k.point.length < 5 || k.keywords.length === 0)) return null;
    out.push({ topic: topics[i], question: q.question.trim(), keyPoints: kps });
  }
  return out;
}

/** Asks the model for drafts. The result is only ever stored as a draft that a person must approve. */
export async function draftWithModel(llm: FailoverLlm, role: string, topics: string[]): Promise<DraftQuestion[] | null> {
  const text = await llm.complete(SYSTEM, `Role: ${role}\nTopics, one question each: ${topics.join(', ')}`, { json: true, maxTokens: 1800 });
  return validateDrafts(parseJsonObject(text), topics);
}
