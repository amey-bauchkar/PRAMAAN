# AI-Era Skill Verification and Interview Integrity (2024–2026), focus: fresh-graduate software skills

Evidence-grade legend used throughout:
- **[PEER]** = peer-reviewed journal/conference (or ACM/Cell published)
- **[PREPRINT]** = arXiv/preprint, not confirmed peer-reviewed
- **[PRIMARY-CO]** = company's own official statement/blog
- **[VENDOR]** = assessment/proctoring/anti-cheat vendor data or marketing (commercial interest in the finding)
- **[NEWS]** = journalism
- **[SECONDARY]** = prep sites, Medium, aggregators, blogs (weakest; treat as unverified)

---

## Q1. How are companies and vendors responding to candidates using ChatGPT/Copilot/Claude, cheating tools (Interview Coder, Cluely), and deepfake candidates? What prevalence data exists?

### Takeaway
All quantified prevalence data comes from vendors that sell detection, and it counts *suspected* (probability-flagged) cheating, not confirmed cheating. Still, the signals agree: roughly 35–48% of monitored technical screens are flagged, juniors and lower-salary candidates are flagged most, and dedicated "invisible overlay" tools are the main vector. Employers have split into two camps. One returns to in-person or high-supervision rounds; the other (Meta, Canva, Karat, HackerRank) builds "AI-allowed" formats that observe how candidates use AI. India has its own problem of impersonation and proxy fraud at mass-hiring scale (Infosys).

### Cited Findings
**Tools**
- Interview Coder was built by Columbia students Roy Lee and Neel Shanmugam, who were suspended in 2025. It became Cluely, a desktop overlay app, and by June 2025 Cluely's website had removed all references to cheating on job interviews — [Wikipedia: Cluely](https://en.wikipedia.org/wiki/Cluely); [Wikipedia: Roy Lee](https://en.wikipedia.org/wiki/Roy_Lee_(entrepreneur)) [SECONDARY]
- Other named tools include Final Round AI, Leetcode Wizard (screen OCR for coding tests) and ChatGPT/Gemini voice mode — [Fabric report](https://fabrichq.ai/blogs/state-of-ai-interview-cheating-in-2026-insights-from-19-368-interviews) [VENDOR]

**Prevalence (all vendor-sourced)**
- Fabric analysed 19,368 AI-run interviews on its platform from July 2025 to January 2026. 38.5% of candidates were flagged (cheating probability >40%), rising to 48% for technical roles vs 12% for sales. Junior candidates (0–5 yrs) were flagged at roughly twice the senior rate, and lower salary bands were flagged more. By vector: 45% dedicated tools (Cluely/Interview Coder), 34% LLM voice mode, 18% tab-switch or second screen, 3% live human help. 61.1% of flagged candidates would still have passed a 7.0/10 score threshold. Among repeat candidates, 30% were flagged every time. Fabric reports flagged rates rising about 3x from July to September 2025 — [Fabric](https://fabrichq.ai/blogs/state-of-ai-interview-cheating-in-2026-insights-from-19-368-interviews) [VENDOR]
  - Caveats: flags are not human-confirmed; no false-positive rate or ground truth is disclosed; the 85% detection-accuracy claim is unvalidated. Salaries are given in INR, so the sample is *likely* India-heavy, but the page never says so (my inference).
- CodeSignal data, as relayed by aggregators: cheating or fraud attempts on proctored technical tests rose from 16% (2024) to 35% (2025) — [EliteBrains stats page](https://www.elitebrains.com/blog/candidate-fraud-statistics); [Metamindz comparison](https://www.metamindz.co.uk/post/karat-hackerrank-codesignal-ai-interview-cheating-2026) [SECONDARY citing VENDOR]. I did not retrieve the CodeSignal primary report.
- A HirePro (Indian assessment vendor) study reported that 30–50% of candidates cheat in entry-level job assessments. It also claimed that combining video, audio and image proctoring misses only 2% of cheating — [Careers360](https://news.careers360.com/30-to-50-percent-candidates-cheat-during-entry-level-job-assessments-says-hirepro-study) [NEWS relaying VENDOR]
- Gartner (press release, 31 Jul 2025): 6% of 3,000 surveyed candidates (2Q25) *admitted* to interview fraud. Gartner predicts that by 2028 one in four candidate profiles worldwide will be fake (a forecast, not a measurement). Only 26% of applicants trust AI to evaluate them fairly — [Gartner press release](https://www.gartner.com/en/newsroom/press-releases/2025-07-31-gartner-survey-shows-just-26-percent-of-job-applicants-trust-ai-will-fairly-evaluate-them); [Personnel Today](https://www.personneltoday.com/hr/by-2028-one-in-four-candidate-profiles-will-be-fake/) [NEWS/analyst]
- The 6% self-admitted figure versus the 35–48% vendor-flagged figures is a large gap. Self-report under-counts, while probability flags may over-count. No independent, peer-reviewed prevalence study was found.

**Deepfake / identity fraud**
- CNBC (Apr 2025): tech CEOs report fake job seekers flooding remote roles. In one case a candidate used an AI-altered stock photo plus a stolen US identity and passed background checks and four video interviews — [CNBC](https://www.cnbc.com/2025/04/08/fake-job-seekers-use-ai-to-interview-for-remote-jobs-tech-ceos-say.html) [NEWS]
- NYSBA notes that state-sponsored actors use deepfakes and synthetic identities to scale hiring fraud — [NYSBA](https://nysba.org/addressing-the-threat-of-fake-job-candidates/) [professional body]

**India-specific**
- Infosys deferred online and in-person assessments for over 20,000 applicants after detecting impersonation and evaluation malpractice. Fresh dates will follow once revised verification protocols are in place. Infosys says campus intake targets are unaffected (about 20k freshers onboarded in FY26) — [BW People](https://www.bwpeople.in/article/infosys-pauses-hiring-tests-amid-cheating-probe-610167); [VARINDIA](https://www.varindia.com/news/infosys-halts-hiring-tests-after-widespread-cheating) [NEWS]
- Reported proxy-interview market of Rs 30,000–40,000 per interview for TCS/Infosys/Wipro vendor roles, with an emerging deepfake face-overlay variant — [Springverify blog](https://in.springverify.com/blog/proxy-interviews-identity-fraud-remote-hiring/) [VENDOR, unverified]

**Employer responses**
- Google, Cisco and McKinsey are increasingly bringing candidates in for in-person interviews (WSJ, as cited) — [Built In](https://builtin.com/articles/ai-job-interview-cheating-debate) [SECONDARY citing NEWS]. Reports that Pichai endorsed returning to in-person rounds come only from secondary sources — [SoftwareSeni](https://www.softwareseni.com/how-ai-tools-broke-technical-interviews-the-mechanics-and-scale-of-interview-cheating/) [SECONDARY]
- Canva (June 2025): "we now expect Backend, Machine Learning and Frontend engineering candidates to use AI tools like Copilot, Cursor, and Claude." The new round replaces the CS Fundamentals screen. Canva's rationale: AI trivially solves classic questions, and real engineering involves more code reading and comprehension than writing — [Canva Engineering Blog](https://www.canva.dev/blog/engineering/yes-you-can-use-ai-in-our-interviews/) [PRIMARY-CO]
- Meta: an AI-enabled coding round (assistant inside the coding environment) replaces one of two coding rounds, reportedly rolling out from October 2025. Business Insider (July 2025) reported that Meta confirmed it was testing this — [Hello Interview](https://www.hellointerview.com/blog/meta-ai-enabled-coding); [Medium/Fahim ul Haq](https://medium.com/@fahimulhaq/meta-just-transformed-their-coding-interviews-with-ai-heres-what-developers-must-know-363b50dceda4) [SECONDARY]
- Google is reportedly piloting an invite-only AI-assisted coding interview for junior and mid-level SWE roles on select US teams — [Medium](https://medium.com/@emilyhustlenyc/can-you-use-ai-in-a-coding-interview-google-says-yes-amazon-says-youre-disqualified-88e7dd5abda9) [SECONDARY, unverified]. This conflicts with reports of Google adding in-person rounds; both may hold for different roles.
- Anthropic's "Guidance on Candidates' AI Usage" (updated 10 Jul 2025, as relayed): draft applications yourself, then refine with Claude; do take-homes without Claude unless told otherwise; no AI in live interviews unless indicated; AI for prep is encouraged; Claude does not make hiring decisions — [copilotinterview summary](https://copilotinterview.com/blog/does-anthropic-allow-ai-in-interviews); [HR Heretics](https://hrheretics.substack.com/p/anthropics-interview-rules) [SECONDARY]. Sources disagree on the timeline of the earlier blanket ban.

### Inferences
- Prevalence is highest exactly in the campus-placement segment (junior, lower-salary, technical, remote, mass-scale), so a campus product faces worse integrity conditions than the averages above.
- The industry is moving from detecting AI use toward assessing the parts AI cannot do for you: reading code, judgement, ownership. This supports a comprehension- and ownership-centred verification design.
- Identity fraud (proxy/deepfake) and AI assistance are separate threats. A comprehension test alone does not stop a skilled proxy, so identity binding remains a necessary, separate layer.

### Gaps
- No independent or peer-reviewed prevalence measurement; CodeSignal's primary report not retrieved.
- No primary WSJ/Wired/Bloomberg articles retrieved; Meta/Google policy details rest on secondary sources.
- No TCS-specific integrity data found; North Korean IT-worker scheme details not retrieved.

---

## Q2. What do vendors do (proctoring, lockdown, AI-use detection, keystroke analysis, AI-allowed assessments, pair programming, walkthroughs, modification tasks)? Which providers, and with what results?

### Takeaway
Vendors layer telemetry (paste events, tab or IDE exit, typing dynamics, gaze), similarity models and human review. More and more, they also offer sanctioned in-IDE AI assistants whose transcripts are graded. Every vendor's accuracy claim is self-reported. The vendors themselves advise against auto-rejecting on flags, and no platform claims to fully solve the problem.

### Cited Findings
- CodeSignal: a proprietary "Suspicion Score" combining solution similarity, telemetry and copy-paste activity — [Metamindz](https://www.metamindz.co.uk/post/karat-hackerrank-codesignal-ai-interview-cheating-2026) [SECONDARY]
- HackerRank: detects external pastes, coding patterns and tab-switching. Sources conflict on its plagiarism model's accuracy: "93% accuracy" vs "85% precision" — [HerоHunt](https://www.herohunt.ai/blog/detecting-ai-interview-cheating-2026/); [Metamindz](https://www.metamindz.co.uk/post/karat-hackerrank-codesignal-ai-interview-cheating-2026) [SECONDARY]
- HackerRank AI-assisted interviews (reported launch July 2025): interviewers can watch the candidate's exchanges with the built-in assistant live, and the conversation is captured in the interview report — [HackerRank](https://www.hackerrank.com/writing/ai-coding-interviews-what-recruiters-should-know) [VENDOR]
- Karat: human-led, recorded interviews. An integrity flag requires interviewer documentation plus a second Interview Engineer re-watching the session. A "NextGen" interview launched December 2025 embeds an AI assistant to evaluate how candidates work with AI; external AI remains banned — [Metamindz](https://www.metamindz.co.uk/post/karat-hackerrank-codesignal-ai-interview-cheating-2026) [SECONDARY]. No primary Karat source retrieved.
- CoderPad: alerts on external pastes and on leaving the IDE. It reportedly hosts Meta's AI-enabled round (unconfirmed by Meta) — [HackerEarth buyer's guide](https://www.hackerearth.com/blog/top-coding-interview-platforms-2026); [Hello Interview](https://www.hellointerview.com/blog/meta-ai-enabled-coding) [SECONDARY]
- HackerRank, CodeSignal and Codility all publish guidance that integrity labels should prompt a conversation, not an automatic rejection — [Metamindz](https://www.metamindz.co.uk/post/karat-hackerrank-codesignal-ai-interview-cheating-2026) [SECONDARY summary of VENDOR guidance]
- Comparison verdict: CodeSignal's proctoring "does not close it", and Karat's live format makes cheating harder but not impossible — [Metamindz](https://www.metamindz.co.uk/post/karat-hackerrank-codesignal-ai-interview-cheating-2026) [SECONDARY]
- Fabric (AI interviewer) claims 20+ signals: gaze, response timing, keystroke dynamics, language patterns — [Fabric](https://fabrichq.ai/blogs/state-of-ai-interview-cheating-in-2026-insights-from-19-368-interviews) [VENDOR]
- Practitioner pattern for take-homes: a 20–30 min live walkthrough in which the candidate explains a decision and then makes a small live change to their own submission, done within a few days of submission. The argument is that "nothing in the submission itself proves authorship" — [InterviewerSignal](https://interviewersignal.com/blog/how-to-verify-take-home-assignment-authorship); [ScreenComply](https://screencomply.ai/resources/blog/post/how-to-tell-if-a-take-home-case-study-was-done-with-ai) [SECONDARY/VENDOR]
- Canva's AI-required round uses open-ended product problems (e.g. an aircraft takeoff/landing control system) that a single prompt cannot solve. Per secondary reports, candidates are scored on reviewing, debugging and owning AI output — [Canva](https://www.canva.dev/blog/engineering/yes-you-can-use-ai-in-our-interviews/) [PRIMARY-CO]; [Nyrion](https://nyrion.ai/companies/canva) [SECONDARY]
- Byteboard: no 2024–2026 information retrieved.

### Inferences
- The live-modification-of-your-own-take-home technique already exists as informal practitioner advice. It is unstandardised: done ad hoc by a human interviewer, with no hidden tests, no prediction step and no scoring rubric.
- "AI-allowed" rounds (Meta, Canva, Karat NextGen, HackerRank) evaluate AI collaboration, not unaided understanding. That leaves room for a method that isolates whether the candidate understands *their own* artifact.

### Gaps
- No independent evaluation of any vendor's detection accuracy or false-positive rate.
- No primary Karat or CodeSignal publications retrieved; HackerRank Developer Skills Report and CoderPad State of Tech Hiring figures not retrieved.

---

## Q3. How reliable are AI-generated-code detectors? Evidence on false positives and bias; guidance against penalising on detector scores.

### Takeaway
Peer-reviewed and preprint evidence consistently shows AI-text and AI-code detectors are unreliable. They produce high false-positive and false-negative rates on code, collapse to labelling everything AI, and break under paraphrase. They are also documented to be biased against non-native English writers, which is directly relevant to Indian candidates. Universities (Vanderbilt, Northwestern, Yale and others) have disabled Turnitin's AI detector, and vendors themselves say flags should not auto-reject.

### Cited Findings
- [PEER] Liang et al., *Patterns* (Cell) 2023: GPT detectors misclassified a high share of non-native-authored TOEFL essays as AI while having near-zero misclassification on native college essays. The cause: low-perplexity, simpler word choice gets read as machine-like. The authors "strongly caution against the use of GPT detectors in evaluative or educational settings, particularly when assessing the work of non-native English speakers" — [Patterns](https://www.cell.com/patterns/fulltext/S2666-3899(23)00130-7); [arXiv 2304.02819](https://arxiv.org/pdf/2304.02819)
- [PREPRINT; likely published at ICSE-SEET 2024, verify] "Assessing AI Detectors in Identifying AI-Generated Code: Implications for Education": detectors showed high false-negative *and* false-positive rates on code and lacked reliability — [arXiv 2401.03676](https://arxiv.org/html/2401.03676)
- [PREPRINT] Two dedicated code detectors reached 0.50 accuracy but F1 = 0.00 because they labelled nearly every sample as AI-generated. Accuracy can mask this collapse; general-purpose LLM judges did better — [arXiv 2610.01664](https://arxiv.org/pdf/2610.01664)
- [PREPRINT] A longitudinal study of student vs LLM code in intro programming cites a comparison of eight public detectors. They were less accurate for code, non-English text and paraphrased responses, and false positives fell unevenly across human groups — [arXiv 2610.00863](https://arxiv.org/html/2610.00863v1)
- [PEER — Int. J. Educ. Integrity 2023] Weber-Wulff et al.: text-detector false-positive rates ranged from 0% to 50% across tools, which were "neither accurate nor reliable" — [arXiv 2306.15666](https://arxiv.org/pdf/2306.15666)
- [PREPRINT] On 10,000 student-writing samples, a detector produced 2,753 false positives. The failures were systematic, not random, and worsened under domain or generator shift — [arXiv 2603.23146](https://arxiv.org/html/2603.23146)
- [PREPRINT] Perplexity-based detection of LLM code does not generalise across languages and settings ("One size does not fit all") — [arXiv 2412.16525](https://arxiv.org/pdf/2412.16525); adversarially modified LLM code evades detectors, which motivated adversarial training — [arXiv 2507.13123](https://arxiv.org/pdf/2507.13123)
- [PRIMARY-institution] Vanderbilt disabled Turnitin's AI detector in Aug 2023. Even at Turnitin's claimed 1% false-positive rate, about 750 of Vanderbilt's 75,000 papers a year would be wrongly flagged, and Turnitin gave no detail on how detection works — [Vanderbilt](https://www.vanderbilt.edu/brightspace/2023/08/16/guidance-on-ai-detection-and-why-were-disabling-turnitins-ai-detector/)
- Northwestern and Yale also disabled the detector, and several institutions do not rely solely on detection to adjudicate misconduct — [GradPilot tracker](https://gradpilot.com/news/colleges-that-disabled-ai-detectors); [Pillitteri](https://pasqualepillitteri.it/en/news/14726/ai-detector-scores-banned-evidence-universities) [SECONDARY]
- Hiring vendors' own guidance says flags should start a conversation, not trigger an auto-reject — [Metamindz](https://www.metamindz.co.uk/post/karat-hackerrank-codesignal-ai-interview-cheating-2026) [SECONDARY]

**Authorship attribution and stylometry (related but different)**
- [PEER, ACM 2025] LLM-AuthorBench (32,000 C programs from 8 LLMs): attributing *which LLM* wrote a piece of code is feasible with Transformer encoders and classical classifiers — [ACM 10.1145/3733799.3762964](https://dl.acm.org/doi/10.1145/3733799.3762964); [arXiv 2506.17323](https://arxiv.org/abs/2506.17323)
- [PREPRINT] Structural patterns allow high-accuracy attribution of LLM-generated JavaScript — [arXiv 2510.10493](https://arxiv.org/pdf/2510.10493); supervised models detect undisclosed AI-agent PRs on GitHub — [arXiv 2601.17406](https://arxiv.org/html/2601.17406v1)
- [PREPRINT] Plagiarism detection fails in competitive programming. Stylometry against a student's *own prior style* is proposed only as a supplementary, transparent signal — [arXiv 2505.08244](https://arxiv.org/pdf/2505.08244)
- [PEER, J. Learning Analytics] Keystroke and clickstream data may help detect contract cheating (transcription vs authentic composition) in *writing*. No equivalent code study was found — [JLA](https://learning-analytics.info/index.php/JLA/article/download/6332/7312)

### Inferences
- A campus product that penalises on detector scores would face high, systematically biased false positives on an Indian, largely non-native-English cohort, plus legal and fairness risk. Detector output should at most route candidates to a verification step, never decide an outcome.
- Attribution works on lab benchmarks (which LLM wrote this), but that does not answer the hiring question (does this person understand it). Behavioural evidence of understanding is a better-defended basis.

### Gaps
- No peer-reviewed study of AI-code detectors specifically on Indian or non-native student *code* (the bias evidence is for prose).
- No published keystroke-dynamics validation for programming-interview integrity; vendor keystroke claims are unvalidated.

---

## Q4. Research literature: code comprehension testing, questions about learners' own code, oral defence/viva, explain-in-plain-English, mutation testing as assessment, question generation from a candidate's own code

### Takeaway
There is a solid computing-education research line, "Questions about Learners' Code" (QLCs). It shows many students who submit working code cannot answer questions about it ("fragile knowledge"). Newer 2024–2026 work uses LLMs to generate personalised comprehension questions and viva questions from student code, and to run scalable voice-AI orals. Mutation analysis is established as a probe of *LLM* code reasoning, but I found no work using mutation-and-prediction tasks to assess *humans* on their own code.

### Cited Findings
- [PREPRINT; appears to be an ITiCSE 2023 paper, verify] Lehtinen et al., "Automated Questions About Learners' Own Code Help to Detect Fragile Knowledge": program analysis explores execution paths to generate comprehension questions about each student's own code. About 15% of students answered such questions incorrectly on early items, and earlier work (Jask) found about a third of students struggled to explain their own code — [arXiv 2306.16267](https://arxiv.org/html/2306.16267)
- [PREPRINT 2024] "Let's Ask AI About Their Programs": QLCs generated from LLM-written solutions and posed back to LLMs revealed the models' fallibility at comprehension questions — [arXiv 2404.11734](https://arxiv.org/pdf/2404.11734)
- [PEER, ACM 2025] "Testing Code Comprehension using GenAI": a tool auto-generates personalised comprehension questions from students' code. Most students said it improved understanding and surfaced misconceptions — [ACM 10.1145/3754508.3754532](https://dl.acm.org/doi/10.1145/3754508.3754532)
- [PEER, Springer 2026] "From Code to Questions": automated unit testing combined with AI-generated follow-up questions about the student's code. 15/16 (94%) of students felt the questions adequately tested understanding (small n) — [Springer](https://link.springer.com/article/10.1007/s44230-026-00150-9)
- [PREPRINT 2024] TAMIGO: an LLM helps TAs generate viva questions and model answers from student assignments, grade viva responses and give code feedback in an advanced course — [arXiv 2407.16805](https://arxiv.org/html/2407.16805)
- [PREPRINT 2026] Ipeirotis: oral exams are costly (about 30 instructor+TA hours for 36 students, untenable at 100+). A voice-AI system runs personalised orals graded by an LLM panel — [arXiv 2603.18221](https://arxiv.org/pdf/2603.18221)
- [PEER, Frontiers in AI 2026] A pedagogy model for LLM-assisted programming proposes orals where students present, explain and *predict the output of* their code — [Frontiers](https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2026.1945247/full)
- [PRIMARY-institution] UWE Bristol: a first-year programming module added a mandatory short code viva worth 30% to counter GenAI code students cannot explain — [UWE](https://digitallearning.uwe.ac.uk/ai-proofing-assessment-through-code-vivas/); instructor guidance on oral code explanations — [Hemann](https://hemann.pl/teaching/vivas/)
- [PRODUCT] "Code Viva" generates student-specific written questions from submitted code and scores the answers — [Code Viva](https://code-viva.netlify.app/) [VENDOR-ish, no evaluation]
- **Mutation as a comprehension probe (LLM-focused):**
  - [PREPRINT 2026] A behaviour-changing mutation is injected and the test checks whether an LLM's code summary updates. Summary accuracy was only 49.3% — [arXiv 2602.17838](https://arxiv.org/abs/2602.17838)
  - [PREPRINT 2026] LLM test generation under code evolution: models often miss semantically significant changes — [arXiv 2603.23443](https://arxiv.org/html/2603.23443v1)
  - [PREPRINT 2025] Mutation-generated programs with different outputs test whether LLMs reason about execution or memorised patterns — [arXiv 2504.05518](https://arxiv.org/pdf/2504.05518); LLM "scientific debugging" to kill mutants — [arXiv 2503.08182](https://arxiv.org/pdf/2503.08182)
- Explain-in-Plain-English (EiPE) with LLM grading: my searches found no 2024–2026 paper (see Gaps).

### Inferences
- The QLC literature provides peer-reviewed grounding that "can you answer questions about your own code" separates real from fragile knowledge, even before AI. It is a defensible foundation for a campus product.
- Mutation-based "predict what changes" tasks are validated as a way to separate execution reasoning from pattern-matching in LLMs. Applying the same idea to humans on their own artifacts, and showing that LLMs find it hard, is an underexplored research gap.

### Gaps
- EiPE + LLM-autograding papers (e.g., from SIGCSE/ITiCSE 2024–2025) not retrieved. The literature is believed to exist but is not verified here.
- No SIGCSE/ITiCSE venue sweep was done; published-venue status of several arXiv papers needs confirmation.
- No study found of mutation testing used to assess *human* comprehension, and none of question generation from a full multi-file *repository* (vs a single assignment file).

---

## Q5. Is anyone verifying skill by having candidates predict the behaviour of, then modify, their OWN code under hidden tests (the "Live Mutation Probe")? Closest prior art.

### Takeaway
I found no published system or vendor that combines (a) the candidate's own repository as source, (b) system-generated mutations or change requests, (c) a *prediction* step before running, and (d) hidden tests that score the modification. The closest prior art covers pieces of it: QLCs and GenAI comprehension questions on one's own code, "predict output" orals, LLM viva generation (TAMIGO), mutation probes of LLM reasoning, and the informal practitioner habit of "make a live change to your take-home."

### Cited Findings (closest prior art, ranked by closeness)
1. Questions generated from a learner's own code, including execution-path-based questions — [arXiv 2306.16267](https://arxiv.org/html/2306.16267) [PREPRINT/likely PEER]; GenAI version — [ACM 3754508.3754532](https://dl.acm.org/doi/10.1145/3754508.3754532) [PEER]; unit tests plus AI follow-ups on own code — [Springer 2026](https://link.springer.com/article/10.1007/s44230-026-00150-9) [PEER]. *Missing: modification under hidden tests, repository scope, hiring context.*
2. Oral "explain and predict output" of one's own solution — [Frontiers 2026](https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2026.1945247/full) [PEER]; code vivas — [UWE](https://digitallearning.uwe.ac.uk/ai-proofing-assessment-through-code-vivas/). *Missing: automated mutations, hidden tests.*
3. LLM-generated viva questions from a student's assignment — [TAMIGO](https://arxiv.org/html/2407.16805) [PREPRINT]; voice-AI orals at scale — [arXiv 2603.18221](https://arxiv.org/pdf/2603.18221) [PREPRINT]. *Missing: an executable modification task.*
4. Live extension of one's own take-home as an authorship check — [InterviewerSignal](https://interviewersignal.com/blog/how-to-verify-take-home-assignment-authorship); [ScreenComply](https://screencomply.ai/resources/blog/post/how-to-tell-if-a-take-home-case-study-was-done-with-ai) [SECONDARY]. *Missing: standardisation, prediction step, hidden tests, scoring.*
5. Mutation analysis to probe whether a reasoner tracks behavioural change — [arXiv 2602.17838](https://arxiv.org/abs/2602.17838); [arXiv 2504.05518](https://arxiv.org/pdf/2504.05518) [PREPRINT]. *Applied to LLMs, not humans.*
6. Hobby open-source projects in which an AI asks questions about code the user wrote (practice tool, no validation) — [aryasoni98/AI-Interview](https://github.com/aryasoni98/AI-Interview)
7. Canva's rationale that the job is mostly code *reading and comprehension* and owning AI output — [Canva](https://www.canva.dev/blog/engineering/yes-you-can-use-ai-in-our-interviews/) [PRIMARY-CO]

### Inferences
- The defensible novelty claim is the *combination*: the candidate's own multi-file repo, auto-generated semantic mutations or change requests, a pre-execution prediction (a calibration signal), a timed modification scored by hidden tests, and an LLM-generated follow-up "why". Each part has precedent; I found none that integrates them, and none in hiring or campus placement.
- The prediction step is the strongest anti-AI element. Evidence from [arXiv 2602.17838](https://arxiv.org/abs/2602.17838) shows LLMs themselves struggle to track mutated behaviour, though a candidate with an overlay tool could still query an LLM, so it needs pairing with time limits and live context.
- Risk: a candidate who used AI to write the repo but then studied it can pass. The probe verifies *current understanding and ownership*, not *original authorship*, and should be framed that way honestly.

### Gaps
- No patent search was done; patents on "repository-derived interview questions" may exist.
- Commercial products launched in 2026 (e.g., AI interviewers that ingest a GitHub profile) may not be indexed. My searches did not find any doing executable mutation probes, but absence of evidence is not proof.

---

## Q6. Skill decay / re-verification ("skill half-life") and credential expiry practices

### Takeaway
The often-quoted "2.5-year half-life of technical skills" (attributed to IBM/HBR, with WEF saying about 4 years, about 2 for AI) is a heuristic repeated mainly by L&D and career blogs. I could not verify it at a primary source, and it is not a measured constant. Gartner's recommendation to keep verifying after hire supports time-bound credentials, but I gathered no hard evidence on certification expiry periods.

### Cited Findings
- 2.5-year technical skill half-life attributed to IBM; IBM reportedly describes 2.5–5 years across tech/HR fields, with "perishable" tool-specific skills under 2.5 years — [The Interview Guys](https://blog.theinterviewguys.com/your-resume-has-a-half-life-now-why-the-skill-that-got-you-hired/); [Abekus](https://abekus.ai/blog/half-life-of-skills-2026/) [SECONDARY]
- WEF quoted: skill half-life about 4 years, closer to 2 years in digital/AI fields — [Medium](https://medium.com/@jackluucoding/the-skill-half-life-why-understanding-it-will-keep-ai-from-taking-our-jobs-df6c148224ef) [SECONDARY]
- L&D vendor framing of the half-life concept — [Docebo](https://www.docebo.com/learning-network/blog/the-half-life-of-a-career-is-short-and-getting-shorter/); [360Learning](https://360learning.com/blog/half-life-skills/) [VENDOR]
- Gartner recommends verifying identity at assessment and extending fraud detection after placement (monitoring, anomaly alerts) — [Staffing Hub summary](https://staffinghub.com/hiring/candidate-verification-ai-resume-fraud-staffing-firms-2026/) [SECONDARY citing analyst]

### Inferences
- Time-stamped, decaying skill credentials (re-probe after N months, or when the candidate's repo changes) have a plausible rationale. The quantitative half-life figure should be cited as an industry heuristic, not as evidence.

### Gaps
- No primary IBM/WEF/HBR document retrieved.
- AWS/Microsoft/Google Cloud certification validity and recertification rules were not searched. These are commonly time-limited (often cited as about 2–3 years), but that is unverified here and should not be stated without checking.
- No peer-reviewed study of programming skill decay in new graduates found.

---

## Q7. Team projects: attributing individual contribution in group repositories

### Takeaway
Computing-education research uses git logs, `git blame` code ownership, chat data and peer evaluation, and since 2025 LLM summaries of each member's commits. Git metrics correlate with peer ratings but measure activity, not meaningful contribution. The literature recommends triangulation with human judgement. None of these methods checks that a contributor *understands* the code attributed to them.

### Cited Findings
- [PEER, ACM TOCE 2023] Combining GitHub, chat and peer-evaluation data to assess individual contributions; team project assessment is "notoriously difficult and typically based on subjective metrics" — [ACM 10.1145/3593592](https://dl.acm.org/doi/10.1145/3593592)
- [PEER, c. 2020] Buffardi: git logs plus Kanban user stories across 10 student teams; strong positive correlation between repo contributions and peer evaluations — [ResearchGate](https://www.researchgate.net/publication/339510728_Assessing_Individual_Contributions_to_Software_Engineering_Projects_with_Git_Logs_and_User_Stories)
- [PREPRINT 2020] What GitHub logs can show about student teamwork — [arXiv 2008.11262](https://arxiv.org/pdf/2008.11262)
- [PEER, c. 2018] Git-driven grading framed as a fair-division problem, web app used by 30+ students — [ResearchGate](https://www.researchgate.net/publication/329023727_Measuring_Team_Members'_Contributions_in_Software_Engineering_Projects_using_Git-driven_Technology)
- [PREPRINT 2025] TRACE: repo history, communication and behavioural signals; code ownership via `git blame`. The authors caution that these are "quantifiable proxies for student effort that do not necessarily indicate meaningful contribution" — [arXiv 2510.03998](https://arxiv.org/html/2510.03998v3)
- [PREPRINT 2025] LLM contribution summarisation using PyDriller to isolate each member's changes — [arXiv 2505.17710](https://arxiv.org/pdf/2505.17710); [PEER, ACM 2026] LLMs for assessing student contributions in group development, including cross-checking self-reports against git — [ACM 10.1145/3786228.3786254](https://dl.acm.org/doi/10.1145/3786228.3786254)
- Gender influence on student team online communication (a bias consideration for communication-based attribution) — [arXiv 2502.14653](https://arxiv.org/pdf/2502.14653)

### Inferences
- `git blame` and commit attribution are trivially gamed (pair-commits, squash merges, a teammate or AI writing code that another person commits). A natural extension is to scope the mutation probe to the files and functions each member claims or is attributed by blame. That would turn attribution from an *activity* signal into an *understanding* signal. I found no prior art doing this.

### Gaps
- No study found that validates git-based attribution against ground truth in the LLM-assistant era (AI-authored commits muddy authorship further).
- No India-specific study of group project attribution in engineering colleges found.
