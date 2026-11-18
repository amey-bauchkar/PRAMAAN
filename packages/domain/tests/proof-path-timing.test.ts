import { describe, it, expect } from 'vitest';
import { recourseTiming, ProofAction, DriveRuleContext, DEFENCE_SCHEDULING_DAYS } from '../src/proof-path.js';

const now = '2026-11-17T00:00:00.000Z';
const inDays = (d: number) => new Date(Date.parse(now) + d * 86_400_000).toISOString();
const drive = (id: string, days: number): DriveRuleContext => ({ driveId: id, title: id, startsAt: inDays(days), ruleVersion: {} as any });
const action = (proof: 'L1' | 'L2' | 'L3', ids: string[]): ProofAction => ({ skillId: 'docker', name: 'Docker', targetLevel: 1, targetProof: proof, unlocksDriveIds: ids, unlocksCount: ids.length });

describe('Deadline-aware recourse', () => {
  const effort = [
    { skillId: 'docker', targetProof: 'L1' as const, estHours: 4 },
    { skillId: 'docker', targetProof: 'L2' as const, estHours: 6 },
    { skillId: 'docker', targetProof: 'L3' as const, estHours: 4 },
    { skillId: 'sql', targetProof: 'L1' as const, estHours: 40 },
  ];

  it('sums only the tasks for that skill up to the target proof', () => {
    const [t] = recourseTiming([action('L2', ['a'])], [drive('a', 30)], effort, { now });
    expect(t.estHours).toBe(10);
    expect(t.daysNeeded).toBe(5);
  });

  it('adds mentor scheduling time for a defended (L3) proof', () => {
    const [t] = recourseTiming([action('L3', ['a'])], [drive('a', 30)], effort, { now });
    expect(t.daysNeeded).toBe(7 + DEFENCE_SCHEDULING_DAYS);
  });

  it('labels each unlocked drive as in time, tight or only for later drives', () => {
    const [t] = recourseTiming([action('L2', ['far', 'close', 'past'])], [drive('far', 20), drive('close', 6), drive('past', 2)], effort, { now });
    expect(t.drives.map(d => d.horizon)).toEqual(['in_time', 'tight', 'next_drives']);
    expect(t.summary).toMatch(/in time for 2 of 3 drives/);
  });

  it('says plainly when the proof is too late for every drive it unlocks', () => {
    const [t] = recourseTiming([action('L1', ['a'])], [drive('a', 1)], effort, { hoursPerDay: 1, now });
    expect(t.drives[0].horizon).toBe('next_drives');
    expect(t.summary).toMatch(/too late for this drive/);
  });
});
