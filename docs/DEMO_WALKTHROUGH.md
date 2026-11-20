# Demo walkthrough

## The five-minute tour: receipts, not claims

The login page has a **Five-minute tour** with a Go button for each step.

1. **Public ledger.** Open the placement ledger page (no sign-in) and press **Check this ledger in my browser**. Your browser rebuilds the log from published fingerprints and checks the log operator's signature and the university's witness signature. To check with code that shares nothing with the website, run `npm run verify:ledger -- http://localhost:4000 <college id>` (the college id is in the ledger page address).
2. **Recruiter signs an offer.** Neha Kapoor, Pipeline, **Signed offers**: find Rahul Bhosale (rows are alphabetical, so scroll to the R's), enter a CTC and press **Sign and send offer**. The key stays in this browser.
3. **Student accepts.** The shortlisted student, **My Offers**: **Accept and sign**, then **Check this receipt in my browser**.
4. **University witnesses.** Dr. Sunita Kale, **Ledger Witness**: **Witness newest state**.
5. **Try to cheat.** Placement officer, **Trust Ledger**: **Change one salary in the database** (caught by the recruiter signature), then **Put it back**, then **Rewrite history and sign it again** (the log's own checks pass, and the university witness catches it), then **Put it back**.
6. **Replay a decision.** Rahul, **My Drives**: **Show the proof behind this decision**, then **Replay this decision**.

The demo starts with new logs each time it runs, and each run gives its logs their own identity, so a browser that remembers an earlier run starts fresh instead of reporting a rewrite. **Forget what this browser remembers** on the public page clears the remembered state by hand.

## The longer walkthrough

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
