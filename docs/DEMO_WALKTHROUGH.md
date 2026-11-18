# Demo walkthrough

A walkthrough of the offline demo, about six minutes. Start it with `npm run demo` and open http://localhost:3000.

1. **Rahul (student):** home shows "Get SQL to L2 → unlocks 2 more drives". Link LeetCode (`rahul-deshmukh-demo`) to see Observed vs Verified.
2. **Mock Drive → Backend Developer:** 30 aptitude questions, 2 machine-test problems (JavaScript + SQL, hidden tests), 3 interview questions, then the report. Passing the SQL problem makes SQL *Verified · L2 Assessed* and the drive eligible.
3. **Skill Proof Check → Defend this code:** Live Mutation Probe on his own `pricing.js`: the anchor is hash-verified, he predicts behaviour, then changes the code under hidden tests to earn *L3 Defended*.
4. **Profile → Issue credential → Public verification page** (Open Badges 3.0, Ed25519-signed). **Generate resume** prints from verified proof.
5. **My Drives:** each failed check in plain words, switchable to हिन्दी or मराठी. The Proof Path says how many hours each proof takes and whether that is in time for each drive's date.
6. **Eligibility Pass** (once a drive is eligible): the college signs the facts and the student shares "CGPA ≥ 7.5: met" instead of the CGPA. Any recruiter checks it at `/verify-pass` with a one-time request. Replays, other devices and altered passes are rejected.
7. **Placement officer:** Cohort dashboard (heatmap, 6 KPIs with formulas, SQL workshop 60% → 25%), Demand Scout scan, Readiness Radar, company email → slot proposal → approve, appeals.
8. **Rules what-if → Find a fairer alternative:** on *Software Engineer Trainee*, set the 10th and 12th minimums to 75 and preview. Gender and category are flagged and 7 students are eligible. The repair search tries 57 small changes, never removing a required skill, and offers "10th 65%, 12th 60%" (24 eligible, total gap below 0.80 cut by more than half). "Use this" loads it with a rationale. The demo data shifts school marks by category on purpose (labelled synthetic).
9. **Recruiter:** search "SQL ≥ L2", open an Evidence Card, request a shortlist (an officer approves it in AI Proposals).
10. **University:** per-college aggregates only.
