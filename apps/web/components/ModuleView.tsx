'use client';

import React from 'react';
import { WorkspaceKey } from '@/lib/workspaces';
import { Profile } from './student/Profile';
import { Import } from './student/Import';
import { Proofs } from './student/Proofs';
import { Targets } from './student/Targets';
import { MockDrive } from './student/MockDrive';
import { LearningPath } from './student/LearningPath';
import { MyDrives } from './student/MyDrives';
import { Privacy } from './student/Privacy';
import { Passes } from './student/Passes';
import { MyOffers } from './student/MyOffers';
import { TrustLedger } from './tpo/TrustLedger';
import { Cohort } from './tpo/Cohort';
import { Demand } from './tpo/Demand';
import { Readiness } from './tpo/Readiness';
import { MockSetup } from './tpo/MockSetup';
import { Outreach } from './tpo/Outreach';
import { Drives } from './tpo/Drives';
import { Rules } from './tpo/Rules';
import { Applications } from './tpo/Applications';
import { Proposals } from './tpo/Proposals';
import { Fairness } from './tpo/Fairness';
import { Accreditation } from './tpo/Accreditation';
import { Roles } from './tpo/Roles';
import { Reviews } from './tpo/Reviews';
import { Search } from './recruiter/Search';
import { Pipeline } from './recruiter/Pipeline';
import { Outcomes } from './university/Outcomes';
import { Witness } from './university/Witness';

const VIEWS: Record<string, Record<string, React.ComponentType>> = {
  student: { profile: Profile, import: Import, proofs: Proofs, targets: Targets, 'mock-drive': MockDrive, 'learning-path': LearningPath, drives: MyDrives, passes: Passes, offers: MyOffers, privacy: Privacy },
  tpo: { ledger: TrustLedger, cohort: Cohort, demand: Demand, readiness: Readiness, 'mock-setup': MockSetup, outreach: Outreach, drives: Drives, rules: Rules, applications: Applications, proposals: Proposals, fairness: Fairness, accreditation: Accreditation, roles: Roles, reviews: Reviews },
  recruiter: { search: Search, pipeline: Pipeline },
  university: { outcomes: Outcomes, witness: Witness },
};

export function ModuleView({ workspace, module }: { workspace: WorkspaceKey; module: string }) {
  const View = VIEWS[workspace]?.[module];
  return View ? <View /> : null;
}
