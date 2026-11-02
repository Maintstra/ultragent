---
name: ultragent
description: Delegate a well-scoped coding task to ultragent (runs locally on the user's Claude API credits with a USD cap), then review its work. Use when the user asks to hand off, delegate or "use ultragent / my API credits" for a task.
argument-hint: "[task description]"
allowed-tools: Bash(ultragent *), Bash(git diff *), Bash(git status *)
---

# Delegate a task to ultragent

You are the manager. ultragent is the worker: a local, budget-capped coding agent that runs on the user's API credits. You write the brief, start the run, wait, then review the result.

If `$ARGUMENTS` is given, treat it as the task description. Otherwise use the task the user described in the conversation, and ask if it is unclear.

## Steps

1. **Check the key.** Run `ultragent check`. If it fails because no API key is set, tell the user to run `ultragent init` in their own terminal, then stop and wait. If the `ultragent` command is not found, tell the user to install it once with `npm install -g github:Maintstra/ultragent`. Never ask for the key in chat and never write it anywhere (no files, no commands, no environment variables).

2. **Write a brief.** Create `.ultragent/briefs/<yyyymmdd-hhmm>-<slug>.md` in the current repo (`<slug>` is a short kebab-case name for the task). The brief must contain these sections:
   - **Goal**: what should be true when the work is done.
   - **Files involved**: the files and directories to read or change.
   - **Out of scope**: what must not be touched.
   - **How to verify**: the exact test and typecheck commands to run.
   - **Constraints**: style, dependencies, compatibility, anything else to respect.

   Keep each task small. Split big work into several briefs and run them one after another.

3. **Run it.** Run:
   `ultragent run <brief> --cwd . --budget <N> --report .ultragent/reports/<same-name>.md`
   Use the same file name as the brief for the report. `N` is the USD cap and defaults to 1. Raise it only if the user agrees.

4. **Review.** When the run finishes, read the report, run `git diff` and `git status`, and run the project's tests. Review the change like a careful reviewer: does it meet the goal, stay in scope, and pass verification? Fix small issues yourself or send a follow-up brief for larger ones. Report back to the user with the outcome and the cost (it is in the report and in `~/.ultragent/costs.csv`).

5. **No publishing.** Never push, publish or deploy on ultragent's behalf without the user's explicit approval.

6. **Housekeeping.** Mention to the user that `.ultragent/` (briefs and reports) can be added to `.gitignore`.
