export const jobs = [
  { accountScope: 'synthetic-company', platformJobId: 'mock-growth', displayName: '海外社媒运营', source: 'LOCAL_FIXTURE' as const },
  { accountScope: 'synthetic-company', platformJobId: 'mock-content', displayName: '内容策划', source: 'LOCAL_FIXTURE' as const }
];
export const defaultJd = '海外社媒运营\n增长项目';
export const syntheticCandidates = Array.from({ length: 10 }, (_, i) => ({
  candidateId: `mock-c${i + 1}`, name: i < 2 ? '合成同名候选人' : `合成人选 ${i + 1}`,
  cardText: i < 3 ? '具备海外社媒运营经验，参与增长项目。' : '参与内容编辑与项目协作，详细业务范围未提供。',
  resumeText: i < 2 ? '负责海外社媒运营。主导增长项目并复盘转化路径。' : '曾参与海外社媒运营，增长职责的具体范围未提供。',
  sourceQuality: 'COMPLETE' as const
}));
