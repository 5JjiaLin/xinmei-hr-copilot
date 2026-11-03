import { z } from 'zod';
import type { CandidateSnapshot, Profile, ScreeningResult } from '../shared/types';

export const resultSchema = z.object({
  candidateId: z.string().min(1), jobId: z.string().min(1),
  decision: z.enum(['PASS', 'UNCERTAIN', 'REJECT']),
  matchedRequirements: z.array(z.object({ criterionId: z.string().min(1), evidence: z.string().min(1) }).strict()),
  missingInformation: z.array(z.string()), riskFlags: z.array(z.string()),
  criteriaVersion: z.string(), promptVersion: z.literal('mock-evidence-v1')
}).strict();

// 只为确定性的合成演示服务，不代表真实 AI 判断和校准结果。
export class MockScreeningEngine {
  profile(jd: string): Profile {
    const lines = jd.split(/[\n；;]/).map(x => x.trim()).filter(Boolean);
    if (!lines.length || lines.length > 20 || jd.length > 4000) throw new Error('JD_INVALID');
    if (/(年龄|性别|婚育|籍贯|头像|忽略.*指令|ignore.*instruction)/i.test(jd)) throw new Error('JD_UNSUPPORTED');
    return { criteria: [...new Set(lines)].map((text, i) => ({ id: `C${i + 1}`, text })), version: 'mock-criteria-v1' };
  }
  screen(candidate: CandidateSnapshot, profile: Profile, deep: boolean): ScreeningResult {
    const text = deep ? candidate.resumeText ?? '' : candidate.cardText;
    const matched = profile.criteria.filter(c => text.includes(c.text));
    const missing = profile.criteria.filter(c => !text.includes(c.text)).map(c => c.text);
    const riskFlags = /忽略.*指令|ignore.*instruction|给我满分/i.test(text) ? ['UNTRUSTED_INSTRUCTION'] : [];
    if (deep && candidate.sourceQuality !== 'COMPLETE') missing.push('INSUFFICIENT_INFO');
    const result = {
      candidateId: candidate.candidateId, jobId: candidate.jobId,
      decision: missing.length || riskFlags.length ? 'UNCERTAIN' : 'PASS',
      matchedRequirements: matched.map(c => ({ criterionId: c.id, evidence: c.text })),
      missingInformation: missing, riskFlags, criteriaVersion: profile.version, promptVersion: 'mock-evidence-v1'
    };
    return validateResult(result, candidate, profile, text);
  }
}
export function validateResult(raw: unknown, candidate: CandidateSnapshot, profile: Profile, text: string): ScreeningResult {
  const result = resultSchema.parse(raw);
  if (result.candidateId !== candidate.candidateId || result.jobId !== candidate.jobId || result.criteriaVersion !== profile.version)
    throw new Error('MODEL_IDENTITY_MISMATCH');
  const ids = result.matchedRequirements.map(m => m.criterionId);
  if (new Set(ids).size !== ids.length || result.matchedRequirements.some(m =>
    !text.includes(m.evidence) || !profile.criteria.some(c => c.id === m.criterionId && c.text === m.evidence)))
    throw new Error('EVIDENCE_INVALID');
  if (result.decision === 'PASS' && (result.missingInformation.length || result.riskFlags.length || profile.criteria.some(c => !ids.includes(c.id))))
    throw new Error('EVIDENCE_INCOMPLETE');
  return result;
}
