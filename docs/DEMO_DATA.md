# VPPCOE sample data (for demos)

A complete, clearly fictional college so every screen has something real-looking to show. Nothing here is a real person.

## What is loaded
- University of Mumbai (parent) and VPPCOE with departments CSE (60 students), IT (40), ENTC (40).
- 12 staff (officer, coordinators, mentors, recruiters) and 140 students. All emails end in `.example`, so no mail can reach a real person.
- 7 companies and drives, 95 applications, 148 mock attempts, rounds, rooms and interview questions.
- The college row is marked `config.sample_data = true`.

## Commands
```bash
npm run sample:vppcoe   # generate and load the sample college (safe to re-run; never deletes departments)
npm run sample:logins   # create sign-ins for 8 sample people; passwords go to .local/demo-logins.md (git-ignored)
```

## Logins
See `.local/demo-logins.md` (student, mentor, coordinator, officer, admin, recruiters).

## GitHub pairings for the Project Interview Kit
| Candidate (sample) | GitHub profile | Resume |
|---|---|---|
| Aarav Deshpande | amey-bauchkar | docs/demo/resume-aarav-deshpande.txt |
| Varun Mehta | Tomeseto | docs/demo/resume-varun-mehta.txt |
| Ishita Joshi | janhavii70 | docs/demo/resume-ishita-joshi.txt |

Recruiters only see students who applied to a drive, so use the Backend Developer drive.
Set `GITHUB_TOKEN` in `.env`, or sign in with GitHub as the recruiter, otherwise GitHub's 60 requests/hour limit cuts scans short.

## Known limits
- Ishita and Varun hold past offers, so they are not eligible for new drives.
- History tables are append-only by design, so the sample data cannot be purged with a script.
