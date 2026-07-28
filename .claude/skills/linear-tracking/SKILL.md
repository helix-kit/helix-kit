---
name: linear-tracking
description: >-
  How to keep the Helix Linear tracker current for ANY work in this repo. Use at
  the START of every task — before writing code, running builds, or investigating
  — to confirm tracking exists and find or open the issue you're about to work on,
  and AFTER every accomplishment (a feature done, a bug fixed, a step verified, a
  blocker found, a decision made, scope changed) to update status and append an
  activity-log comment. Triggers whenever you begin, progress, finish, or abandon
  any Helix work: firmware, linux/device, web, android, cloud, tooling, docs, or
  anything under experimental/. Covers: the team/project/epic/label model, the
  find-before-create rule, the status lifecycle, and the per-issue activity log.
  Read and act on this BEFORE starting work, not after.
---

# Keeping the Helix Linear tracker up to date

**Linear is the source of truth for Helix progress.** All Helix work is tracked in
Linear (the `linear` MCP server) so nothing is half-done-and-forgotten. Every unit
of work maps to an issue; every accomplishment leaves a trail. This is not
optional bookkeeping — do it as part of the work, in the same turn.

If the `mcp__linear__*` tools are not loaded, load them first with
`ToolSearch` (e.g. `select:mcp__linear__list_issues,mcp__linear__save_issue,mcp__linear__save_comment,mcp__linear__list_projects,mcp__linear__get_issue`).

## The five rules

1. **Preflight before you touch anything.** At the start of a task, confirm tracking
   is live and locate (or create) the issue you're about to work on. Never start
   real work with no issue open for it.
2. **Find before you create.** Search existing issues first. If the work extends or
   continues something already tracked, update that issue — do not open a duplicate.
3. **One issue per unit of work, filed under the right epic.** New work = a sub-issue
   under the matching epic (JAI-5…JAI-30), carrying the epic's subsystem label.
4. **Status reflects reality, always.** Move the issue to `In Progress` when you start,
   `In Review` when it's up for review, `Done` only when verified end-to-end. Reflect
   blockers and cancellations too.
5. **Every change gets an activity-log comment.** On any status change or meaningful
   progress, add a comment to the issue saying what you did, what changed, how it was
   verified, and what's next. Linear's auto-history is not enough — write the narrative.

---

## The tracking model (memorize this)

- **Team:** `Jainhardik120` (key `JAI`).
- **Project:** `Helix` (id `78051107-b9cd-4b08-b574-ce8722472dc4`).
- **Epics** are parent issues labeled `epic`; concrete work are **sub-issues** with
  `parentId` set to the epic. Completed work is `Done`, live work `In Progress`,
  pending work `Backlog`/`Todo`.
- **Subsystem labels** (put the matching one on every sub-issue): `embedded-esp32`,
  `embedded-arduino`, `linux-device`, `linux-platform-os`, `device-ui`, `web`,
  `android`, `cloud`, `tooling`, `protocol`, `experimental`, `docs`.
- **Cross-cutting labels:** `epic` (parents only), `deploy-blocker` (security/robustness
  gates for production — also file under the **Pre-deploy blockers** epic and
  `relatedTo` the home epic).

### Epic map — pick the parent for new sub-issues

| Epic | Area |
| --- | --- |
| JAI-5 | ESP32 protocol core & transports |
| JAI-6 | ESP32 platform services (file, db, events, OTA, provisioning) |
| JAI-7 | ESP32 build / flash / QEMU tooling |
| JAI-8 | ESP32 console bridge |
| JAI-9 | Device UI (LVGL) + display seam |
| JAI-10 | Arduino / AVR firmware |
| JAI-11 | Linux device runtime (helixd + Go/Python SDKs) |
| JAI-12 | Device data plane & P2P / WebRTC transport |
| JAI-13 | Helix Linux platform OS |
| JAI-14 | Web app (Next.js console, marketing, docs, blog) |
| JAI-15 | @helix/backend core (auth, tRPC, storage, PKI, releases/OTA, events) |
| JAI-16 | Cloud appliance & AMI |
| JAI-17 | Custom firmware build service |
| JAI-18 | Load testing & scaling |
| JAI-19 | CI/CD & deploy pipeline |
| JAI-20 | Android SDK & app |
| JAI-21 | Protocol contract codegen |
| JAI-22 | helix CLI & lint gate |
| JAI-23 | Radxa edge video & NPU inference |
| JAI-24 | x86 / GPU cross-platform inference pipeline |
| JAI-25 | Chat bot (Slack / Teams) |
| JAI-26 | Networking & display experiments (P2P, bandwidth, port-forward, remote shell, kiosk) |
| JAI-27 | Documentation |
| JAI-28 | Pre-deploy blockers |
| JAI-29 | On-device LLM fine-tuning |
| JAI-30 | Build-time page gating experiment |

If the work genuinely fits no epic, create a **new epic** (labeled `epic` + subsystem,
in the `Helix` project) before adding its sub-issues — don't hang orphans off the
project root. If a new subsystem appears, create its label too.

---

## Preflight — do this BEFORE starting any work

1. **Confirm tracking is live.** `list_projects` (or `list_issues` with `project: "Helix"`).
   Expect the `Helix` project and the epics above. If the project or epics are missing,
   tracking hasn't been set up — **stop and set it up** per the `linear-tracking` memory
   before proceeding, or escalate to the user. Never start untracked.
2. **Find the issue for this work.** Search first:
   `list_issues` with `project: "Helix"` and a `query` on keywords, and/or filter by the
   subsystem `label`. Also check the relevant epic's sub-issues. Read candidates with
   `get_issue` before deciding.
3. **Decide: update or create.**
   - Continues / fixes / extends an existing issue → use it (go to *Updating*).
   - Genuinely new → create it (go to *New work*).
4. **Move it to `In Progress`** and drop a starting comment (what you're about to do).
   Only then start the actual work.

## New work — creating an issue

`save_issue` with: `team: "Jainhardik120"`, `project: "Helix"`, `parentId: <epic>`, the
subsystem `labels`, a clear `title`, and a `description` that states the goal and
references the concrete files/paths (`path:line`) involved. Set `state` to `In Progress`
if you're starting now, else `Backlog`/`Todo`. Set `priority` for blockers/urgent work
(1=Urgent, 2=High). For security gates, add `deploy-blocker`, parent it to JAI-28, and
`relatedTo` the home epic.

## Updating an existing issue

- Change `state` to match reality (`In Progress` / `In Review` / `Done` / `Canceled`).
- If scope grew, edit the `description`; if it grew a lot, split out a new sub-issue and
  `relatedTo`/`blockedBy` it rather than overloading one card.
- **Always add the activity-log comment** (next section). Do not change status silently.

## The activity log — comment on every meaningful change

Use `save_comment` with `issueId: "JAI-N"`. Add a comment when you: finish a step, flip a
status, hit or clear a blocker, make a design decision, change scope, or record a
verification result. Keep it factual and skimmable:

```
**<what happened>** — e.g. "Wired ota_sink to the OTA partition."
- Changed: <files / behavior> (path:line where useful)
- Verified: <how — qemu-test / e2e / lint / manual>, result
- Next: <the remaining step, or "none — closing">
```

One comment per accomplishment beats one giant end-of-task dump. When you set an issue to
`Done`, the closing comment must state how it was verified end-to-end (per the repo's
"verify behavior before you polish" rule) — don't mark `Done` on unverified code.

---

## Cadence

- **Start of task:** preflight (find/create issue → `In Progress` → starting comment).
- **After each accomplishment:** update status if it changed + activity-log comment.
- **On blocker:** comment the obstacle and options; if it gates production, apply
  `deploy-blocker` and file under JAI-28. Surface it to the user too (don't just log it).
- **End of task:** final status (`Done` only if verified) + closing comment.

## The dashboard & views

The **📊 Helix Tracking Dashboard** document (in the `Helix` project) is the human-readable
overview — snapshot counts, in-progress/in-review lists, blockers, per-subsystem progress,
epic completion, and recent activity. Its numbers are a point-in-time snapshot, so when a
change materially shifts the picture (a batch of issues closed, a new epic, a blocker
cleared), refresh the affected lines with `save_document` (find it via `list_documents` /
`get_document`). Don't rewrite the whole doc every task — update what moved.

Interactive, always-live **saved Views** (Active work, Deploy blockers, By subsystem,
Recently completed, Backlog, Experiments) live in the Linear UI and can't be created via
the API — the recipes are listed at the bottom of the dashboard doc. If the user asks for a
new view, add its recipe there rather than trying to create it programmatically.

## Don't

- Don't start substantive work with no issue open for it.
- Don't create a second issue for something already tracked — search first.
- Don't flip a status without an accompanying comment.
- Don't mark `Done` on unverified work.
- Don't hang sub-issues off the project with no epic parent.
- Don't touch the JAI-1…JAI-4 default Linear onboarding cards — they aren't Helix work.
