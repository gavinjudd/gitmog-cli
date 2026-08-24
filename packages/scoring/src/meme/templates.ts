import type { MemeTemplate } from "./types.js";

/**
 * Phrasing only. A template declares which atoms it can render and one line per roast
 * mode; it declares no threshold and computes nothing (ADR 0005 D1). `short` is the
 * variant used when a surface budget cannot fit `text` — share cards mostly.
 *
 * Tokens are supplied by the atom that fired, plus `{subject}` and `{opponent}`.
 * A token the atom did not supply is a test failure, not a blank.
 *
 * `motif` is the comedic premise. The engine tracks it across the whole battle, so two
 * templates that share a motif are two phrasings of one idea and cannot both appear
 * unless the budget allows it (ADR 0010 D2).
 */

const MATCHUPS: readonly MemeTemplate[] = [
  {
    id: "mat.tests.receipts",
    slot: "matchup",
    atoms: ["tests_gap"],
    motif: "tests-versus-faith",
    energy: 2,
    voice: "deadpan",
    text: {
      clean: "{subjectTests} tested on one side, {opponentTests} on the other.",
      spicy: "One side brought tests. The other brought confidence.",
      unhinged: "{subjectTests} tested against {opponentTests}. The deploy button is unsupervised.",
    },
    short: {
      clean: "Tests: {subjectTests} against {opponentTests}.",
      spicy: "Tests on one side. Confidence on the other.",
      unhinged: "{subjectTests} tested. {opponentTests} tested.",
    },
  },
  {
    id: "mat.verification.stack",
    slot: "matchup",
    atoms: ["verification_stack"],
    motif: "verification-stack",
    energy: 1,
    voice: "terminal",
    text: {
      clean: "{subjectTests} tested, with {subjectWorkflow} wired into CI.",
      spicy:
        "A verification stack entered the fight: {subjectTests} tested, {subjectWorkflow} automated.",
      unhinged: "{subjectCiCoverage} CI. Nothing lands here on self-belief.",
    },
    short: {
      clean: "{subjectTests} tested, {subjectWorkflow} automated.",
      spicy: "Verification stack: {subjectTests} / {subjectWorkflow}.",
      unhinged: "{subjectCiCoverage} CI. No self-belief deploys.",
    },
  },
  {
    id: "mat.ci.pipeline",
    slot: "matchup",
    atoms: ["ci_gap"],
    motif: "works-on-my-machine",
    energy: 2,
    voice: "terminal",
    text: {
      clean: "CI coverage is {subjectCi} on one side and {opponentCi} on the other.",
      spicy: "One side has CI. The other has a person remembering to check.",
      unhinged: "{subjectCi} automated against {opponentCi}. Works-on-my-machine territory.",
    },
    short: {
      clean: "CI: {subjectCi} against {opponentCi}.",
      spicy: "CI versus somebody remembering.",
      unhinged: "{subjectCi} CI against {opponentCi}.",
    },
  },
  {
    id: "mat.release.versions",
    slot: "matchup",
    atoms: ["release_gap"],
    motif: "versions-versus-intentions",
    energy: 2,
    voice: "deadpan",
    text: {
      clean: "{subject} publishes {subjectReleases}. {opponent} has no release yet.",
      spicy: "Release tags on one side. Intentions on the other.",
      unhinged: "{subjectReleases} against a default branch with dreams.",
    },
    short: {
      clean: "{subjectReleases} against no releases.",
      spicy: "Versions against intentions.",
      unhinged: "{subjectReleases} against a branch.",
    },
  },
  {
    id: "mat.recency.current",
    slot: "matchup",
    atoms: ["recent_activity_gap"],
    motif: "currently-building",
    energy: 2,
    voice: "fight-card",
    text: {
      clean:
        "{subject} pushed {subjectDays} days ago; {opponent} pushed {opponentMonths} months ago.",
      spicy: "One profile is current. The other is an archive with an avatar.",
      unhinged: "{opponent}'s last push is {opponentMonths} months old. Historical footage.",
    },
    short: {
      clean: "{subjectDays} days against {opponentMonths} months.",
      spicy: "Current profile against archive footage.",
      unhinged: "{opponentMonths} months old. Historical footage.",
    },
  },
  {
    id: "mat.maintenance.lights",
    slot: "matchup",
    atoms: ["strong_maintenance"],
    motif: "lights-still-on",
    energy: 1,
    voice: "deadpan",
    text: {
      clean: "Maintenance evidence stays current across {subject}'s substantial projects.",
      spicy: "The lights are still on across {subjectMaintained} projects.",
      unhinged: "{subjectMaintained} projects alive. Someone keeps paying the maintenance bill.",
    },
    short: {
      clean: "Maintained projects on one side.",
      spicy: "{subjectMaintained} projects, lights still on.",
      unhinged: "{subjectMaintained} alive. Maintenance paid.",
    },
  },
  {
    id: "mat.sustained.marathon",
    slot: "matchup",
    atoms: ["sustained_work_gap"],
    motif: "marathon",
    energy: 2,
    voice: "deadpan",
    text: {
      clean: "{subjectSustained} sustained work on one side; short runs on the other.",
      spicy: "Long-running projects against weekend sprints.",
      unhinged: "{subjectSustained} sustained. One profile keeps the project alive.",
    },
    short: {
      clean: "{subjectSustained} sustained work.",
      spicy: "Marathons against weekends.",
      unhinged: "{subjectSustained} sustained. Still alive.",
    },
  },
  {
    id: "mat.external.upstream",
    slot: "matchup",
    atoms: ["external_project_activity"],
    motif: "other-peoples-repos",
    energy: 2,
    voice: "deadpan",
    text: {
      clean:
        "{subject} appears in {subjectExternal} external repositories; {opponent} in {opponentExternal}.",
      spicy: "{subject} works in other people's repositories. {opponent} stays home.",
      unhinged:
        "{subjectExternal} external repos against {opponentExternal}. One profile leaves the account.",
    },
    short: {
      clean: "External repos: {subjectExternal} / {opponentExternal}.",
      spicy: "{subject} goes upstream. {opponent} stays home.",
      unhinged: "{subjectExternal} outside, {opponentExternal} inside.",
    },
  },
  {
    id: "mat.commit.manners",
    slot: "matchup",
    atoms: ["commit_manners_gap"],
    motif: "commit-shorthand",
    energy: 2,
    voice: "terminal",
    text: {
      clean: "{opponentLowEffort} of one side's sampled commit messages are low effort.",
      spicy: "One history uses sentences. The other uses “fix”.",
      unhinged:
        "Median message {opponentMessageLength} characters. The git log is speaking in grunts.",
    },
    short: {
      clean: "{opponentLowEffort} low-effort messages.",
      spicy: "Sentences against “fix”.",
      unhinged: "Median message: {opponentMessageLength} characters.",
    },
  },
  {
    id: "mat.repair.loop",
    slot: "matchup",
    atoms: ["repair_loop_gap"],
    motif: "fix-loop",
    energy: 2,
    voice: "terminal",
    text: {
      clean: "Repair commits occupy {opponentRepairs} of the observed history.",
      spicy: "One side ships once. The other fixes the fix.",
      unhinged: "{opponentRepairs} repairs. fix, fix again, actually fix.",
    },
    short: {
      clean: "{opponentRepairs} repair commits.",
      spicy: "Ships once against fixes twice.",
      unhinged: "{opponentRepairs} repairs. The loop continues.",
    },
  },
  {
    id: "mat.mainbranch.witness",
    slot: "matchup",
    atoms: ["main_branch_behavior"],
    motif: "main-branch",
    energy: 2,
    voice: "brainrot",
    text: {
      clean: "Commit sample: {subjectRepairs} repairs, {subjectLowEffort} shorthand.",
      spicy: "MAIN BRANCH STATUS: NO FOLLOW-UP PATCHES.",
      unhinged: "Pushed {subjectDays} days ago. No repair crew followed.",
    },
    short: {
      clean: "{subjectRepairs} repairs, {subjectLowEffort} shorthand.",
      spicy: "Main branch has no notes.",
      unhinged: "No repair crew followed.",
    },
  },
  {
    id: "mat.oneboss.loadbearing",
    slot: "matchup",
    atoms: ["one_repo_final_boss"],
    motif: "one-repo-carry",
    energy: 2,
    voice: "brainrot",
    text: {
      clean:
        "{subjectDominantShare} of {subject}'s substantial bytes sit in one well-supported repository.",
      spicy: "One repo. Load-bearing. Still in the fight.",
      unhinged: "{subjectDominantShare} in one repository. The whole profile has a single spine.",
    },
    short: {
      clean: "{subjectDominantShare} in one strong repository.",
      spicy: "One repo. Load-bearing.",
      unhinged: "One profile, one spine.",
    },
  },
  {
    id: "mat.identity.card",
    slot: "matchup",
    atoms: ["identity_matchup"],
    motif: "identity-matchup",
    energy: 1,
    voice: "fight-card",
    text: {
      clean: "{subjectMogsona} against {opponentMogsona}, on public GitHub evidence only.",
      spicy: "{subjectMogsona} versus {opponentMogsona}. Both assignments have receipts.",
      unhinged: "{subjectMogsona} walks in. {opponentMogsona} is already in the ring.",
    },
    short: {
      clean: "{subjectMogsona} against {opponentMogsona}.",
      spicy: "{subjectMogsona} versus {opponentMogsona}.",
      unhinged: "{subjectMogsona} versus {opponentMogsona}.",
    },
  },
  {
    id: "mat.identity.class",
    slot: "matchup",
    atoms: ["identity_matchup"],
    motif: "identity-matchup",
    energy: 2,
    voice: "terminal",
    text: {
      clean: "{subjectAuraClass} {subjectMogsona} meets {opponentAuraClass} {opponentMogsona}.",
      spicy:
        "{subjectAuraClass} {subjectMogsona} drawn against {opponentAuraClass} {opponentMogsona}.",
      unhinged:
        "{subjectAuraClass} {subjectMogsona}. {opponentAuraClass} {opponentMogsona}. Seconds out.",
    },
    short: {
      clean: "{subjectMogsona} meets {opponentMogsona}.",
      spicy: "{subjectMogsona} drawn against {opponentMogsona}.",
      unhinged: "{subjectMogsona}. {opponentMogsona}. Seconds out.",
    },
  },
  {
    id: "mat.ship.lore",
    slot: "matchup",
    atoms: ["ship_to_yap_gap"],
    motif: "releases-versus-lore",
    energy: 2,
    voice: "deadpan",
    text: {
      clean: "One side publishes releases. The other publishes documentation about them.",
      spicy: "One side has releases. The other has lore.",
      unhinged: "Releases on one side. Lore on the other. Only one of those installs.",
    },
    short: {
      clean: "One side publishes releases.",
      spicy: "One side has releases. The other has lore.",
      unhinged: "Releases versus lore. Only one installs.",
    },
  },
  {
    id: "mat.activity.mileage",
    slot: "matchup",
    atoms: ["activity_without_shipping"],
    motif: "keyboard-mileage",
    energy: 2,
    voice: "fight-card",
    text: {
      clean:
        "{opponentWeeks} active weeks, {opponentSubstantial} substantial projects to show for it.",
      spicy: "{opponentWeeks} active weeks produced {opponentSubstantial} substantial projects.",
      unhinged:
        "{opponentWeeks} active weeks. The output fits in {opponentSubstantial} repositories.",
    },
    short: {
      clean: "{opponentWeeks} weeks, {opponentSubstantial} projects.",
      spicy: "{opponentWeeks} weeks of mileage, {opponentSubstantial} projects.",
      unhinged: "{opponentWeeks} weeks. {opponentSubstantial} repos.",
    },
  },
  {
    id: "mat.graveyard.permits",
    slot: "matchup",
    atoms: ["repo_graveyard_density"],
    motif: "graveyard",
    energy: 3,
    voice: "brainrot",
    text: {
      clean:
        "{opponentGraveyardShare} of the substantial work has gone a year without maintenance.",
      spicy:
        "{opponentAbandonedCount} projects in the ground. {opponentArchived} archived on purpose.",
      unhinged: "This repo graveyard has zoning permits.",
    },
    short: {
      clean: "Maintenance gap: {opponentGraveyardShare} dormant.",
      spicy: "{opponentAbandonedCount} in the ground.",
      unhinged: "This repo graveyard has zoning permits.",
    },
  },
  {
    id: "mat.onerepo.bloodline",
    slot: "matchup",
    atoms: ["one_repo_carry"],
    motif: "one-repo-carry",
    energy: 3,
    voice: "brainrot",
    text: {
      clean: "{opponentDominantShare} of one side's measured bytes sit in a single repository.",
      spicy: "One repository is carrying the entire bloodline.",
      unhinged: "{opponentDominantShare} in one repo. Delete it and the profile stops existing.",
    },
    short: {
      clean: "{opponentDominantShare} in one repository.",
      spicy: "One repository carries the bloodline.",
      unhinged: "{opponentDominantShare} in one repo. Load-bearing.",
    },
  },
  {
    id: "mat.commit.groupchat",
    slot: "matchup",
    atoms: ["commit_chaos"],
    motif: "commit-shorthand",
    energy: 3,
    voice: "brainrot",
    text: {
      clean: "{opponentLowEffort} of one side's commit messages do not describe the change.",
      spicy: "One git log reads like a group chat. The other reads like a changelog.",
      unhinged:
        "{opponentLowEffort} shorthand, {opponentReverts} reverts. The history is a crime board.",
    },
    short: {
      clean: "{opponentLowEffort} of messages say nothing.",
      spicy: "One git log is a group chat.",
      unhinged: "History noise: {opponentLowEffort} shorthand; {opponentReverts} reverts.",
    },
  },
  {
    id: "mat.substance.ratio",
    slot: "matchup",
    atoms: ["substance_ratio_gap"],
    motif: "substance-ratio",
    energy: 1,
    voice: "terminal",
    text: {
      clean:
        "{subjectSubstanceRatio} of one profile is substantial work against {opponentSubstanceRatio}.",
      spicy: "Substance ratio: {subjectSubstanceRatio} against {opponentSubstanceRatio}.",
      unhinged: "{subjectSubstanceRatio} real against {opponentSubstanceRatio}. Public arithmetic.",
    },
    short: {
      clean: "Substantial work: {subjectSubstanceRatio} / {opponentSubstanceRatio}.",
      spicy: "Substance ratio {subjectSubstanceRatio} to {opponentSubstanceRatio}.",
      unhinged: "{subjectSubstanceRatio} against {opponentSubstanceRatio}.",
    },
  },
  {
    id: "mat.evidence.camera",
    slot: "matchup",
    atoms: ["public_evidence_diff"],
    motif: "coverage-caveat",
    energy: 2,
    voice: "terminal",
    text: {
      clean:
        "Confidence {subjectConfidence} against {opponentConfidence}. These two are not equally evidenced.",
      spicy: "Public evidence diff. Same fight card, different camera quality.",
      unhinged: "{subjectInspected} repositories read against {opponentInspected}. Uneven footage.",
    },
    short: {
      clean: "Confidence {subjectConfidence} to {opponentConfidence}.",
      spicy: "Public evidence diff. Different camera quality.",
      unhinged: "{subjectInspected} repos read against {opponentInspected}.",
    },
  },
  {
    id: "mat.margin.board",
    slot: "matchup",
    atoms: ["verdict_margin"],
    motif: "scoreline",
    energy: 1,
    voice: "fight-card",
    text: {
      clean:
        "{subjectScore} against {opponentScore} on {measuredWeight} measurable scorecard points.",
      spicy: "{subjectScore} to {opponentScore}, measured on {measuredWeight} of 100 points.",
      unhinged: "{subjectScore} against {opponentScore}. Every point has a file path.",
    },
    short: {
      clean: "{subjectScore} against {opponentScore}.",
      spicy: "{subjectScore} to {opponentScore}.",
      unhinged: "Scoreline: {subjectScore}–{opponentScore}.",
    },
  },
];

const FINISHERS: readonly MemeTemplate[] = [
  {
    id: "fin.tests.confidence",
    slot: "finisher",
    atoms: ["tests_gap"],
    motif: "tests-versus-faith",
    energy: 2,
    voice: "deadpan",
    text: {
      clean: "{subject} brought tests. {opponent} brought optimism.",
      spicy: "{subject} brought a test suite. {opponent} brought confidence.",
      unhinged: "{subject} brought a test suite. {opponent} brought vibes and a deploy button.",
    },
    short: {
      clean: "{subject} brought tests.",
      spicy: "{subject} brought tests. {opponent} brought confidence.",
      unhinged: "{subject} brought tests. {opponent} brought vibes.",
    },
  },
  {
    id: "fin.tests.coverage",
    slot: "finisher",
    atoms: ["tests_gap"],
    motif: "test-coverage-numbers",
    energy: 1,
    voice: "terminal",
    text: {
      clean:
        "{subjectTests} of {subject}'s inspected repositories are tested. {opponent} sits at {opponentTests}.",
      spicy:
        "{subject} tests {subjectTests} of the inspected work. {opponent} tests {opponentTests} and hopes.",
      unhinged:
        "{subject}: {subjectTests} tested. {opponent}: {opponentTests} tested and fully at peace.",
    },
    short: {
      clean: "Tested repositories: {subjectTests} against {opponentTests}.",
      spicy: "{subjectTests} tested against {opponentTests}. Not close.",
      unhinged: "{subjectTests} tested. {opponentTests} tested. Goodnight.",
    },
  },
  {
    id: "fin.tests.faith",
    slot: "finisher",
    atoms: ["tests_gap"],
    motif: "faith-based-deploy",
    energy: 3,
    voice: "brainrot",
    text: {
      clean: "{subject} verifies the work. {opponent} is running faith-based development.",
      spicy: "The test suite is faith-based. {subject}'s is not.",
      unhinged: "{opponent} ships on pure belief. {subject} ships on green checkmarks.",
    },
    short: {
      clean: "{subject} verifies. {opponent} believes.",
      spicy: "The test suite is faith-based.",
      unhinged: "{opponent} ships on belief. {subject} ships on green.",
    },
  },
  {
    id: "fin.verification.stack",
    slot: "finisher",
    atoms: ["verification_stack"],
    motif: "verification-stack",
    energy: 1,
    voice: "terminal",
    text: {
      clean:
        "{subject} runs tests under CI across {subjectWorkflow} of the inspected repositories.",
      spicy:
        "{subject} has a verification stack: {subjectTests} tested, {subjectWorkflow} wired to CI.",
      unhinged:
        "{subjectTests} tested and {subjectWorkflow} under CI. Nothing merges unsupervised.",
    },
    short: {
      clean: "Tests under CI on {subjectWorkflow} of the work.",
      spicy: "{subjectTests} tested, {subjectWorkflow} wired to CI.",
      unhinged: "{subjectWorkflow} under CI. Nothing merges unsupervised.",
    },
  },
  {
    id: "fin.ci.trustissues",
    slot: "finisher",
    atoms: ["ci_gap"],
    motif: "ci-robots",
    energy: 2,
    voice: "deadpan",
    text: {
      clean: "{subject} has continuous integration. {opponent} has a manual process.",
      spicy: "{subject} has CI. {opponent} has trust issues with automation.",
      unhinged: "{subject} has CI. {opponent} has a laptop and a dream.",
    },
    short: {
      clean: "{subject} has CI. {opponent} does not.",
      spicy: "{subject} has CI. {opponent} has trust issues.",
      unhinged: "{subject} has CI. {opponent} has a laptop.",
    },
  },
  {
    id: "fin.ci.works",
    slot: "finisher",
    atoms: ["ci_gap"],
    motif: "works-on-my-machine",
    energy: 3,
    voice: "brainrot",
    text: {
      clean:
        "CI covers {subjectCi} of {subject}'s inspected work and {opponentCi} of {opponent}'s.",
      spicy: "{subject} pays the robots. {opponent} runs it locally and calls it green.",
      unhinged:
        "{subject} employs robots. {opponent} employs the phrase \u201Cworks on my machine\u201D.",
    },
    short: {
      clean: "CI coverage: {subjectCi} and {opponentCi}.",
      spicy: "{subject} pays the robots. {opponent} runs it locally.",
      unhinged: "{subject}: robots. {opponent}: works on my machine.",
    },
  },
  {
    id: "fin.yaml.discipline",
    slot: "finisher",
    atoms: ["tooling_without_output"],
    motif: "yaml-discipline",
    energy: 2,
    voice: "deadpan",
    text: {
      clean:
        "{opponentCi} CI coverage across {opponentSubstantial} substantial projects. The pipeline is ahead.",
      spicy: "CI has more discipline than the roadmap.",
      unhinged: "{opponentCi} pipeline coverage. The workflow file is the finished product.",
    },
    short: {
      clean: "{opponentCi} CI, {opponentSubstantial} projects.",
      spicy: "CI has more discipline than the roadmap.",
      unhinged: "The workflow file is the finished product.",
    },
  },
  {
    id: "fin.release.intentions",
    slot: "finisher",
    atoms: ["release_gap"],
    motif: "versions-versus-intentions",
    energy: 2,
    voice: "deadpan",
    text: {
      clean: "{subject} publishes releases. {opponent} publishes commits.",
      spicy: "{subject} ships versions. {opponent} ships intentions.",
      unhinged: "{subject} ships versions. {opponent} ships announcements about versions.",
    },
    short: {
      clean: "{subject} publishes releases.",
      spicy: "{subject} ships versions. {opponent} ships intentions.",
      unhinged: "{subject} ships versions. {opponent} ships plans.",
    },
  },
  {
    id: "fin.release.count",
    slot: "finisher",
    atoms: ["release_gap"],
    motif: "release-count",
    energy: 1,
    voice: "terminal",
    text: {
      clean: "{subject} has {subjectReleases} published. {opponent} has none yet.",
      spicy: "{subject}: {subjectReleases}. {opponent}: zero. The default branch is the product.",
      unhinged: "{subject} shipped {subjectReleases}. {opponent} shipped a default branch.",
    },
    short: {
      clean: "{subject}: {subjectReleases}. {opponent}: none.",
      spicy: "{subject}: {subjectReleases}. {opponent}: zero.",
      unhinged: "{subject}: {subjectReleases}. {opponent}: a branch.",
    },
  },
  {
    id: "fin.release.density",
    slot: "finisher",
    atoms: ["release_density_gap"],
    motif: "release-cadence",
    energy: 2,
    voice: "terminal",
    text: {
      clean:
        "{subjectReleaseCount} releases across {subjectReleaseProjects} projects, {subjectReleaseDensity} per project.",
      spicy:
        "{subjectReleaseCount} releases at {subjectReleaseDensity} a project. Somebody tags things.",
      unhinged: "{subjectReleaseCount} tags across {subjectReleaseProjects} projects. Relentless.",
    },
    short: {
      clean: "{subjectReleaseCount} releases, {subjectReleaseProjects} projects.",
      spicy: "{subjectReleaseCount} releases. Somebody tags things.",
      unhinged: "{subjectReleaseCount} tags. Relentless.",
    },
  },
  {
    id: "fin.ship.lore",
    slot: "finisher",
    atoms: ["ship_to_yap_gap"],
    motif: "releases-versus-lore",
    energy: 2,
    voice: "deadpan",
    text: {
      clean:
        "{subject} published {subjectReleaseCount} releases. {opponent} published {opponentDocs} documentation coverage.",
      spicy: "{subject} has releases. {opponent} has lore.",
      unhinged: "{subjectReleaseCount} releases against {opponentDocs} docs and zero versions.",
    },
    short: {
      clean: "{subjectReleaseCount} releases against {opponentDocs} docs.",
      spicy: "{subject} has releases. {opponent} has lore.",
      unhinged: "{subjectReleaseCount} releases. {opponentDocs} docs. Zero versions.",
    },
  },
  {
    id: "fin.recency.months",
    slot: "finisher",
    atoms: ["recent_activity_gap"],
    motif: "last-push-age",
    energy: 2,
    voice: "terminal",
    text: {
      clean:
        "{subject} pushed {subjectDays} days ago. {opponent}'s last public push was {opponentMonths} months back.",
      spicy:
        "{subject} pushed {subjectDays} days ago. {opponent} has been in stealth for {opponentMonths} months.",
      unhinged:
        "{subject} pushed {subjectDays} days ago. {opponent}'s last push has a mortgage now.",
    },
    short: {
      clean: "{subject}: {subjectDays}d ago. {opponent}: {opponentMonths} months.",
      spicy: "{subject} pushed {subjectDays}d ago. {opponent}: {opponentMonths} months.",
      unhinged: "{opponent}'s last push is {opponentMonths} months old.",
    },
  },
  {
    id: "fin.recency.grindset",
    slot: "finisher",
    atoms: ["recent_activity_gap"],
    motif: "currently-building",
    energy: 1,
    voice: "deadpan",
    text: {
      clean: "One of these two is currently building. It is {subject}.",
      spicy: "{subject} is in the grindset. {opponent} is in the archive.",
      unhinged: "{subject} is shipping this week. {opponent} is a historical document.",
    },
    short: {
      clean: "{subject} is currently building.",
      spicy: "{subject}: grindset. {opponent}: archive.",
      unhinged: "{opponent} is a historical document.",
    },
  },
  {
    id: "fin.activity.mileage",
    slot: "finisher",
    atoms: ["activity_without_shipping"],
    motif: "keyboard-mileage",
    energy: 2,
    voice: "fight-card",
    text: {
      clean:
        "{opponent} was active {opponentWeeks} of {weekWindow} weeks with {opponentSubstantial} substantial projects.",
      spicy:
        "{opponent} stayed active for {opponentWeeks} weeks. {subject} won the shipping round.",
      unhinged: "{opponentWeeks} weeks online. {opponentSubstantial} projects survived contact.",
    },
    short: {
      clean: "{opponent}: {opponentWeeks} weeks, {opponentSubstantial} projects.",
      spicy: "{opponent}: {opponentWeeks} active weeks, fewer shipped projects.",
      unhinged: "{opponentWeeks} weeks online, {opponentSubstantial} projects.",
    },
  },
  {
    id: "fin.abandoned.sidequests",
    slot: "finisher",
    atoms: ["abandoned_project_gap"],
    motif: "graveyard",
    energy: 2,
    voice: "deadpan",
    text: {
      clean:
        "{opponent} has {opponentAbandoned}. {subject} has {subjectReleaseCount} published releases.",
      spicy: "{opponent} has more {opponentAbandoned} than {subject} has unfinished business.",
      unhinged: "{opponent} runs a residency programme for {opponentAbandonedCount} dead projects.",
    },
    short: {
      clean: "{opponent} has {opponentAbandoned}.",
      spicy: "{opponent}: {opponentAbandoned}. {subject}: finished work.",
      unhinged: "{opponentAbandonedCount} dead projects in residence.",
    },
  },
  {
    id: "fin.abandoned.finished",
    slot: "finisher",
    atoms: ["abandoned_project_gap"],
    motif: "graveyard",
    energy: 2,
    voice: "deadpan",
    text: {
      clean: "{subject} finishes projects. {opponent} has {opponentAbandonedCount} still waiting.",
      spicy: "{subject} finishes things. {opponent} starts things. Different sport.",
      unhinged:
        "{subject} finishes. {opponent} collects. {opponentAbandonedCount} side quests, zero credits.",
    },
    short: {
      clean: "{subject} finishes projects.",
      spicy: "{subject} finishes. {opponent} starts.",
      unhinged: "{opponentAbandonedCount} side quests, zero credits.",
    },
  },
  {
    id: "fin.graveyard.zoning",
    slot: "finisher",
    atoms: ["repo_graveyard_density"],
    motif: "graveyard",
    energy: 3,
    voice: "brainrot",
    text: {
      clean:
        "{opponentGraveyardShare} of {opponent}'s substantial projects went a year without maintenance.",
      spicy:
        "{opponentAbandonedCount} buried, {opponentArchived} archived on purpose. Zoning problem.",
      unhinged: "A whole cemetery, and not one headstone says archived.",
    },
    short: {
      clean: "{opponentGraveyardShare} unmaintained for a year.",
      spicy: "{opponentAbandonedCount} buried, {opponentArchived} archived.",
      unhinged: "Not one headstone says archived.",
    },
  },
  {
    id: "fin.substance.pile",
    slot: "finisher",
    atoms: ["repo_count_without_substance"],
    motif: "repo-confetti",
    energy: 2,
    voice: "terminal",
    text: {
      clean:
        "{opponent} has {opponentRepos} public repositories and {opponentSubstantial} substantial ones.",
      spicy: "{opponent} has {opponentRepos} repositories. {opponentSubstantial} of them are real.",
      unhinged:
        "{opponent} operates a repository industrial complex. Output: {opponentSubstantial} projects.",
    },
    short: {
      clean: "{opponent}: {opponentRepos} repos, {opponentSubstantial} substantial.",
      spicy: "{opponent}: {opponentRepos} repos, {opponentSubstantial} real.",
      unhinged: "{opponentRepos} repos. {opponentSubstantial} real. Public arithmetic.",
    },
  },
  {
    id: "fin.languages.committed",
    slot: "finisher",
    atoms: ["polyglot_with_depth"],
    motif: "polyglot",
    energy: 2,
    voice: "deadpan",
    text: {
      clean:
        "{subject} works across {subjectLanguages} languages at project scale. {opponent} specialises in {opponentPrimaryLanguage}.",
      spicy:
        "{subject} is polyglot maxxing. {opponent} is in a committed relationship with {opponentPrimaryLanguage}.",
      unhinged:
        "{subject} ships in {subjectLanguages} languages. {opponent} ships in {opponentPrimaryLanguage}, forever.",
    },
    short: {
      clean: "{subject}: {subjectLanguages} languages. {opponent}: {opponentLanguages}.",
      spicy: "{subject} is polyglot maxxing. {opponent} has {opponentPrimaryLanguage}.",
      unhinged: "{subjectLanguages} languages against {opponentLanguages}.",
    },
  },
  {
    id: "fin.concentration.portfolio",
    slot: "finisher",
    atoms: ["impact_concentration"],
    motif: "property-portfolio",
    energy: 2,
    voice: "brainrot",
    text: {
      clean:
        "{subject} maintains {subjectSubstantial} substantial projects. {opponent} maintains {opponentSubstantial}.",
      spicy: "{subject} runs an open-source property portfolio. {opponent} runs a local clone.",
      unhinged: "{subject} is an open-source landlord. {opponent} is still viewing the listing.",
    },
    short: {
      clean: "{subject}: {subjectSubstantial} projects. {opponent}: {opponentSubstantial}.",
      spicy: "{subject} runs a portfolio. {opponent} runs a clone.",
      unhinged: "{subject}: landlord. {opponent}: viewing the listing.",
    },
  },
  {
    id: "fin.oneRepo.boss",
    slot: "finisher",
    atoms: ["one_repo_final_boss"],
    motif: "one-repo-carry",
    energy: 2,
    voice: "brainrot",
    text: {
      clean:
        "{subject} is a one-repo final boss, and {subjectDominantShare} of the evidence holds up.",
      spicy: "{subject} is a one-repo final boss. Fortunately the one repo is actually good.",
      unhinged: "{subject} has one repo. It is load-bearing. It is winning this by itself.",
    },
    short: {
      clean: "{subject} is a one-repo final boss.",
      spicy: "One repo, and it is actually good.",
      unhinged: "One repo. Load-bearing. Still winning.",
    },
  },
  {
    id: "fin.docs.alibi",
    slot: "finisher",
    atoms: ["docs_without_shipping"],
    motif: "readme-alibi",
    energy: 2,
    voice: "deadpan",
    text: {
      clean: "{subject}'s README documents software. {opponent}'s README documents a plan.",
      spicy: "The README is carrying the whole project.",
      unhinged:
        "{opponent} wrote {opponentDocs} documentation coverage for software that never shipped.",
    },
    short: {
      clean: "{subject} documents software. {opponent} documents a plan.",
      spicy: "The README is carrying the whole project.",
      unhinged: "{opponentDocs} docs. Zero releases.",
    },
  },
  {
    id: "fin.forks.certified",
    slot: "finisher",
    atoms: ["high_fork_ratio"],
    motif: "fork-composition",
    energy: 2,
    voice: "terminal",
    text: {
      clean: "{opponentForkShare} of {opponent}'s public repositories are forks.",
      spicy:
        "{opponent} is forklift certified: {opponentForks} repositories arrived from somewhere else.",
      unhinged:
        "{opponentForkShare} of the profile grid is other people's repositories wearing an avatar.",
    },
    short: {
      clean: "{opponentForkShare} of {opponent}'s repos are forks.",
      spicy: "{opponent} is forklift certified. {opponentForks} forks.",
      unhinged: "{opponentForkShare} forks. Forklift certified.",
    },
  },
  {
    id: "fin.maintenance.lights",
    slot: "finisher",
    atoms: ["strong_maintenance"],
    motif: "lights-still-on",
    energy: 1,
    voice: "deadpan",
    text: {
      clean: "{subject} keeps {subjectMaintained} substantial projects current.",
      spicy:
        "{subject} keeps {subjectMaintained} projects alive at {subjectContinuity} continuity. Adult supervision.",
      unhinged: "{subject} maintains {subjectMaintained} projects. The lights stay on.",
    },
    short: {
      clean: "{subject} keeps {subjectMaintained} projects current.",
      spicy: "{subjectMaintained} projects, {subjectContinuity} still alive.",
      unhinged: "{subject} maintains {subjectMaintained}. {opponent} maintains a list.",
    },
  },
  {
    id: "fin.external.rooms",
    slot: "finisher",
    atoms: ["external_project_activity"],
    motif: "other-peoples-repos",
    energy: 2,
    voice: "deadpan",
    text: {
      clean:
        "{subject} contributed to {subjectExternal} repositories they do not own. {opponent} contributed to {opponentExternal}.",
      spicy: "{subject} works in other people's repositories. {opponent} works in {opponent}'s.",
      unhinged:
        "{subject} turns up in {subjectExternal} external repositories. {opponent} turns up at home.",
    },
    short: {
      clean: "External repos: {subjectExternal} and {opponentExternal}.",
      spicy: "{subject} works in other people's repos.",
      unhinged: "{subjectExternal} external repos. {opponent}: {opponentExternal}.",
    },
  },
  {
    id: "fin.release.avoidance",
    slot: "finisher",
    atoms: ["release_avoidance"],
    motif: "release-avoidance",
    energy: 2,
    voice: "deadpan",
    text: {
      clean:
        "{opponent} has {opponentSubstantial} substantial projects and no published release on any.",
      spicy: "The release tab remains an aspirational feature.",
      unhinged:
        "{opponentSubstantial} projects and not one tag. Version numbers are simply too much commitment.",
    },
    short: {
      clean: "{opponent}: {opponentSubstantial} projects, no releases.",
      spicy: "The release tab is aspirational.",
      unhinged: "{opponentSubstantial} projects. Zero tags.",
    },
  },
  {
    id: "fin.messages.manners",
    slot: "finisher",
    atoms: ["commit_manners_gap"],
    motif: "commit-shorthand",
    energy: 2,
    voice: "terminal",
    text: {
      clean: "{opponentLowEffort} of {opponent}'s public commit messages are one word or less.",
      spicy:
        "{opponent} writes commit messages in shorthand. {opponentLowEffort} of them are \u201Cfix\u201D.",
      unhinged:
        "{opponent}'s median commit message is {opponentMessageLength} characters. That is a keyboard slip.",
    },
    short: {
      clean: "{opponentLowEffort} of messages are one word.",
      spicy: "{opponentLowEffort} of {opponent}'s commits say \u201Cfix\u201D.",
      unhinged: "Median commit message: {opponentMessageLength} characters.",
    },
  },
  {
    id: "fin.commit.crimeboard",
    slot: "finisher",
    atoms: ["commit_chaos"],
    motif: "commit-crime-board",
    energy: 3,
    voice: "brainrot",
    text: {
      clean:
        "{opponentLowEffort} of the sampled messages say nothing, with {opponentReverts} reverts.",
      spicy: "git log is a keyboard falling down a flight of stairs.",
      unhinged:
        "{opponentLowEffort} shorthand. {opponentReverts} reverts. Median message {opponentMessageLength} characters.",
    },
    short: {
      clean: "{opponentLowEffort} say nothing, {opponentReverts} reverts.",
      spicy: "git log is a keyboard falling downstairs.",
      unhinged: "{opponentLowEffort} shorthand, {opponentReverts} reverts.",
    },
  },
  {
    id: "fin.repair.loop",
    slot: "finisher",
    atoms: ["repair_loop_gap"],
    motif: "fix-loop",
    energy: 2,
    voice: "terminal",
    text: {
      clean: "{opponentRepairs} of {opponent}'s observed commits repair an earlier commit.",
      spicy:
        "{opponent} ships, repairs, then repairs the repair. {opponentRepairs} of the history is cleanup.",
      unhinged: "{opponentRepairs} of {opponent}'s commits exist to undo {opponent}.",
    },
    short: {
      clean: "{opponentRepairs} of commits are repairs.",
      spicy: "{opponentRepairs} of the history is cleanup.",
      unhinged: "{opponentRepairs} of commits undo the last one.",
    },
  },
  {
    id: "fin.mainbranch.witness",
    slot: "finisher",
    atoms: ["main_branch_behavior"],
    motif: "main-branch",
    energy: 2,
    voice: "brainrot",
    text: {
      clean:
        "{subject} pushed {subjectDays} days ago with {subjectRepairs} repair commits in the sample.",
      spicy: "Main branch witnessed everything and has no notes.",
      unhinged:
        "{subjectLowEffort} shorthand, {subjectRepairs} repairs. Walks into main, commits, leaves.",
    },
    short: {
      clean: "{subjectDays}d ago, {subjectRepairs} repairs.",
      spicy: "Main branch witnessed everything.",
      unhinged: "Commits into main and leaves. No cleanup.",
    },
  },
  {
    id: "fin.sustained.marathon",
    slot: "finisher",
    atoms: ["sustained_work_gap"],
    motif: "marathon",
    energy: 2,
    voice: "deadpan",
    text: {
      clean: "{subject} keeps projects going past six months. {opponent} has not yet.",
      spicy: "{subject} runs marathons. {opponent} runs weekend sprints and then moves house.",
      unhinged: "{subject} sustains projects for years. {opponent} sustains them until Sunday.",
    },
    short: {
      clean: "{subject} sustains projects past six months.",
      spicy: "{subject} runs marathons. {opponent} runs weekends.",
      unhinged: "{subject}: years. {opponent}: until Sunday.",
    },
  },
  {
    id: "fin.structure.blueprint",
    slot: "finisher",
    atoms: ["structure_gap"],
    motif: "layout",
    energy: 2,
    voice: "deadpan",
    text: {
      clean:
        "{subject}'s repositories score {subjectOrganization} on layout. {opponent}'s score {opponentOrganization}.",
      spicy: "{subject} has a repository. {opponent} has a folder that got out of hand.",
      unhinged:
        "{subject} organises code. {opponent} organises a download directory with a licence.",
    },
    short: {
      clean: "Layout: {subjectOrganization} and {opponentOrganization}.",
      spicy: "{subject} has a repository. {opponent} has a folder.",
      unhinged: "{subjectOrganization} layout against {opponentOrganization}.",
    },
  },
  {
    id: "fin.grindset.weeks",
    slot: "finisher",
    atoms: ["grindset_gap"],
    motif: "active-weeks",
    energy: 2,
    voice: "fight-card",
    text: {
      clean:
        "{subject} was active in {subjectWeeks} of the last {weekWindow} weeks. {opponent} managed {opponentWeeks}.",
      spicy: "{subject} won the ship-to-yap ratio: {subjectWeeks} active weeks to {opponentWeeks}.",
      unhinged: "{subjectWeeks} active weeks against {opponentWeeks}. One of them has a grindset.",
    },
    short: {
      clean: "Active weeks: {subjectWeeks} and {opponentWeeks}.",
      spicy: "Ship-to-yap ratio: {subjectWeeks} to {opponentWeeks}.",
      unhinged: "{subjectWeeks} active weeks. {opponent}: {opponentWeeks}.",
    },
  },
  {
    id: "fin.nuclear.execution",
    slot: "finisher",
    atoms: ["nuclear_gap"],
    motif: "nuclear-margin",
    energy: 3,
    voice: "fight-card",
    text: {
      clean: "A {margin}-point gap. Decided by the evidence, not by the margin of error.",
      spicy: "That was not a battle. That was a receipts audit with a scoreboard.",
      unhinged: "{margin} points. Not a fight. A repossession.",
    },
    short: {
      clean: "{margin}-point gap, decided on evidence.",
      spicy: "Not a battle. A receipts audit.",
      unhinged: "{margin} points. Repossession.",
    },
  },
  {
    id: "fin.nuclear.scoreline",
    slot: "finisher",
    atoms: ["nuclear_gap"],
    motif: "scoreline",
    energy: 2,
    voice: "terminal",
    text: {
      clean: "{subjectScore} against {opponentScore}. The public record is unambiguous.",
      spicy: "{subjectScore}\u2013{opponentScore}. Nuclear repo gap. No notes.",
      unhinged:
        "{subjectScore}\u2013{opponentScore}. {opponent} should tag a release before the rematch.",
    },
    short: {
      clean: "Final score: {subjectScore}\u2013{opponentScore}.",
      spicy: "{subjectScore}\u2013{opponentScore}. Nuclear repo gap.",
      unhinged: "{subjectScore}\u2013{opponentScore}. No notes.",
    },
  },
  {
    id: "fin.coverage.tests",
    slot: "finisher",
    atoms: ["tests_gap"],
    motif: "tests-versus-hope",
    energy: 2,
    voice: "deadpan",
    text: {
      clean: "{subject} brought tests. {opponent} brought a confident main branch.",
      spicy: "{subject} brought tests. {opponent} brought main-branch faith.",
      unhinged: "{subject} cross-examined the code. {opponent} let main witness everything.",
    },
    short: {
      clean: "Tests met main-branch confidence.",
      spicy: "Tests versus main-branch faith.",
      unhinged: "Main witnessed everything.",
    },
  },
  {
    id: "fin.coverage.ci",
    slot: "finisher",
    atoms: ["ci_gap"],
    motif: "automation-versus-manual",
    energy: 2,
    voice: "deadpan",
    text: {
      clean: "{subject} brought a merge gate. {opponent} brought the honor system.",
      spicy: "{subject} checks the merge. {opponent} checks the vibes.",
      unhinged: "{subject} deputized CI. {opponent} left main to defend itself.",
    },
    short: {
      clean: "Merge gate versus honor system.",
      spicy: "CI checked the vibes.",
      unhinged: "Main defended itself.",
    },
  },
  {
    id: "fin.coverage.structure",
    slot: "finisher",
    atoms: ["structure_gap"],
    motif: "structure-versus-sprawl",
    energy: 2,
    voice: "deadpan",
    text: {
      clean: "{subject} brought a floor plan. {opponent} brought more hallways.",
      spicy: "{subject} picked a lane. {opponent} paved the interchange.",
      unhinged: "{subject} mapped the repo. {opponent} annexed another directory.",
    },
    short: {
      clean: "Floor plan versus hallways.",
      spicy: "One paved the interchange.",
      unhinged: "Another directory got annexed.",
    },
  },
  {
    id: "fin.maintenance.mainbranch",
    slot: "finisher",
    atoms: ["strong_maintenance", "sustained_work_gap"],
    motif: "maintains-versus-accumulates",
    energy: 2,
    voice: "deadpan",
    text: {
      clean: "{subject} keeps the substantial projects current.",
      spicy: "The maintenance lights are on for {subject}.",
      unhinged: "MAINTENANCE STATUS: LIGHTS ON FOR {subject}.",
    },
    short: {
      clean: "{subject} keeps projects current.",
      spicy: "Maintenance lights on for {subject}.",
      unhinged: "LIGHTS ON: {subject}.",
    },
  },
  {
    id: "fin.external.landlord",
    slot: "finisher",
    atoms: ["external_project_activity", "impact_concentration"],
    motif: "landlord-with-tenants",
    energy: 3,
    voice: "brainrot",
    text: {
      clean:
        "{subject} contributes across projects and maintains their own. Both signals are public.",
      spicy: "{subject} is an open-source landlord with tenants. {opponent} is subletting.",
      unhinged:
        "{subject} owns property and fixes other people's plumbing. {opponent} owns a bookmark.",
    },
    short: {
      clean: "{subject} contributes widely and maintains their own.",
      spicy: "{subject}: landlord with tenants.",
      unhinged: "{subject} owns property. {opponent} owns a bookmark.",
    },
  },
];

const TIE_FINISHERS: readonly MemeTemplate[] = [
  {
    id: "tie.mutual",
    slot: "finisher",
    atoms: ["photo_finish"],
    motif: "mutual-aura",
    energy: 1,
    voice: "deadpan",
    text: {
      clean:
        "{subjectScore} and {opponentScore}. On public evidence these two are the same engineer.",
      spicy: "{subjectScore}\u2013{opponentScore}. Mutual aura. Nobody gets mogged today.",
      unhinged:
        "{subjectScore}\u2013{opponentScore}. Mutual aura. Deeply unsatisfying for everyone.",
    },
    short: {
      clean: "{subjectScore} and {opponentScore}. Effectively level.",
      spicy: "{subjectScore}\u2013{opponentScore}. Mutual aura.",
      unhinged: "{subjectScore}\u2013{opponentScore}. Mutual aura.",
    },
  },
  {
    id: "tie.photofinish",
    slot: "finisher",
    atoms: ["photo_finish"],
    motif: "photo-finish",
    energy: 1,
    voice: "fight-card",
    text: {
      clean:
        "{margin} points apart. Photo finish, and the public record cannot separate them further.",
      spicy: "{margin} points. Photo finish. Run it back with a deeper scan.",
      unhinged: "{margin} points apart. A photo finish, and both of you should be annoyed.",
    },
    short: {
      clean: "{margin} points apart. Photo finish.",
      spicy: "{margin} points. Photo finish.",
      unhinged: "{margin} points. Nobody won.",
    },
  },
  {
    id: "tie.receipts",
    slot: "finisher",
    atoms: ["photo_finish"],
    motif: "equal-receipts",
    energy: 1,
    voice: "terminal",
    text: {
      clean: "The receipts are close enough that the margin sits inside the noise.",
      spicy: "The receipts are stacked equally. This one goes to a rematch.",
      unhinged: "Two nearly identical piles of receipts. Nobody gets a trophy.",
    },
    short: {
      clean: "The margin sits inside the noise.",
      spicy: "Receipts stacked equally. Rematch.",
      unhinged: "Identical receipts. No trophy.",
    },
  },
  {
    id: "tie.samegym",
    slot: "finisher",
    atoms: ["photo_finish"],
    motif: "same-gym",
    energy: 2,
    voice: "brainrot",
    text: {
      clean: "Different profiles, near-identical public engineering behaviour.",
      spicy: "Same gym, same routine, same numbers. Mutual aura.",
      unhinged: "You two are the same account with different avatars.",
    },
    short: {
      clean: "Near-identical public behaviour.",
      spicy: "Same gym, same numbers.",
      unhinged: "Same account, different avatars.",
    },
  },
  {
    id: "tie.nowinner",
    slot: "finisher",
    atoms: ["photo_finish"],
    motif: "no-winner",
    energy: 2,
    voice: "fight-card",
    text: {
      clean: "No clear winner on public evidence. Both scorecards are below.",
      spicy: "No mog today. Both of you go and ship something.",
      unhinged: "No mog. No aura transfer. Go and ship something.",
    },
    short: {
      clean: "No clear winner on public evidence.",
      spicy: "No mog today. Go ship.",
      unhinged: "No aura transfer. Go ship.",
    },
  },
  {
    id: "tie.margin",
    slot: "finisher",
    atoms: ["photo_finish"],
    motif: "rounding-error",
    energy: 2,
    voice: "terminal",
    text: {
      clean: "A {margin}-point margin is not a verdict. It is a rounding decision.",
      spicy: "{margin} points is not a mog. That is a rounding error with a scoreboard.",
      unhinged: "{margin} points. Do not screenshot this, it proves nothing.",
    },
    short: {
      clean: "{margin} points is not a verdict.",
      spicy: "{margin} points is a rounding error.",
      unhinged: "{margin} points proves nothing.",
    },
  },
  {
    id: "tie.deeper",
    slot: "finisher",
    atoms: ["photo_finish"],
    motif: "needs-source-review",
    energy: 1,
    voice: "deadpan",
    text: {
      clean: "The public score ties; repository details carry the remaining distinction.",
      spicy: "The public score tied. Code structure gets the last word.",
      unhinged: "The scorecard called a draw. The repositories kept arguing.",
    },
    short: {
      clean: "Repository details carry the tiebreaker.",
      spicy: "The tiebreaker is in the source.",
      unhinged: "The public score called it level.",
    },
  },
  {
    id: "tie.respect",
    slot: "finisher",
    atoms: ["photo_finish"],
    motif: "mutual-respect",
    energy: 1,
    voice: "deadpan",
    text: {
      clean: "Two strong public records, {margin} points apart. Mutual respect is correct here.",
      spicy: "{margin} points apart. Mutual aura. Shake hands and go back to main.",
      unhinged: "{margin} points. Mutual aura. Deeply awkward for the group chat.",
    },
    short: {
      clean: "{margin} points apart. Mutual respect.",
      spicy: "Mutual aura. Back to main.",
      unhinged: "Mutual aura. Awkward.",
    },
  },
  {
    id: "tie.rematch",
    slot: "finisher",
    atoms: ["photo_finish"],
    motif: "one-push-flips-it",
    energy: 2,
    voice: "fight-card",
    text: {
      clean: "Close enough that another push from either side changes the result.",
      spicy: "One release from either of you flips this. Run it back next week.",
      unhinged: "One tag. One test file. That is the entire gap. Fix it.",
    },
    short: {
      clean: "Another push changes this result.",
      spicy: "One release flips this.",
      unhinged: "One tag. One test file. That is the gap.",
    },
  },
  {
    id: "tie.evidence",
    slot: "finisher",
    atoms: ["photo_finish"],
    motif: "read-the-rounds",
    energy: 1,
    voice: "terminal",
    text: {
      clean: "{subjectScore} to {opponentScore} on the same measured basis. Read the rounds.",
      spicy:
        "{subjectScore}\u2013{opponentScore}. The rounds below are where the difference lives.",
      unhinged:
        "{subjectScore}\u2013{opponentScore}. The scoreboard is useless. The rounds are not.",
    },
    short: {
      clean: "{subjectScore} to {opponentScore}. See the rounds.",
      spicy: "{subjectScore}\u2013{opponentScore}. Rounds below.",
      unhinged: "{subjectScore}\u2013{opponentScore}. Read the rounds.",
    },
  },
];

const ROUNDS: readonly MemeTemplate[] = [
  {
    id: "rnd.testing.clear",
    slot: "round",
    atoms: ["round_clear_win"],
    categories: ["craft.testing"],
    motif: "round-testing",
    energy: 2,
    voice: "fight-card",
    text: {
      clean: "{subject} takes the testing round by {margin} points.",
      spicy: "{subject} takes TEST AURA by {margin}. The test files are right there.",
      unhinged: "TEST AURA by {margin}. {opponent} brought no tests to a test round.",
    },
  },
  {
    id: "rnd.testing.close",
    slot: "round",
    atoms: ["round_close_win"],
    categories: ["craft.testing"],
    motif: "round-testing",
    energy: 1,
    voice: "fight-card",
    text: {
      clean: "{subject} edges the testing round by {margin}.",
      spicy: "{subject} edges TEST AURA by {margin}. Narrow, but the files decide it.",
      unhinged: "{margin} points of TEST AURA. Won on file paths.",
    },
  },
  {
    id: "rnd.verification.stack",
    slot: "round",
    atoms: ["verification_stack"],
    categories: ["craft.testing"],
    motif: "verification-stack",
    energy: 1,
    voice: "terminal",
    text: {
      clean: "{subjectTests} tested, {subjectWorkflow} of it running under CI.",
      spicy: "{subjectTests} tested and {subjectWorkflow} wired to CI.",
      unhinged: "{subjectTests} tested, {subjectCiCoverage} automated. Verified in public.",
    },
  },
  {
    id: "rnd.frequency.clear",
    slot: "round",
    atoms: ["round_clear_win"],
    categories: ["ship.frequency"],
    motif: "round-frequency",
    energy: 2,
    voice: "fight-card",
    text: {
      clean: "{subject} wins the activity round by {margin} points.",
      spicy: "GRINDSET, {subject}. Won the activity round by {margin} points.",
      unhinged: "GRINDSET by {margin}. {opponent} has been observing from a distance.",
    },
  },
  {
    id: "rnd.frequency.close",
    slot: "round",
    atoms: ["round_close_win"],
    categories: ["ship.frequency"],
    motif: "round-frequency",
    energy: 1,
    voice: "fight-card",
    text: {
      clean: "{subject} takes the activity round by {margin}.",
      spicy: "{subject} edges GRINDSET by {margin}. Narrow activity gap.",
      unhinged: "GRINDSET by {margin}. Barely enough daylight for a winner.",
    },
  },
  {
    id: "rnd.tooling.clear",
    slot: "round",
    atoms: ["round_clear_win"],
    categories: ["craft.tooling"],
    motif: "round-tooling",
    energy: 2,
    voice: "fight-card",
    text: {
      clean: "{subject} wins ship discipline by {margin} points on tooling.",
      spicy: "{subject} owns SHIP DISCIPLINE. {margin}-point tooling gap.",
      unhinged: "SHIP DISCIPLINE, {margin}. {opponent}'s pipeline is a person clicking things.",
    },
  },
  {
    id: "rnd.tooling.close",
    slot: "round",
    atoms: ["round_close_win"],
    categories: ["craft.tooling"],
    motif: "round-tooling",
    energy: 1,
    voice: "fight-card",
    text: {
      clean: "{subject} takes the tooling round by {margin}.",
      spicy: "SHIP DISCIPLINE, {subject} by {margin}. Tooling round stays close.",
      unhinged: "SHIP DISCIPLINE by {margin}. A config-file photo finish.",
    },
  },
  {
    id: "rnd.hygiene.clear",
    slot: "round",
    atoms: ["round_clear_win"],
    categories: ["craft.hygiene"],
    motif: "round-hygiene",
    energy: 2,
    voice: "fight-card",
    text: {
      clean: "{subject} wins repo etiquette by {margin} on documentation and hygiene.",
      spicy: "{subject} owns REPO ETIQUETTE. {margin}-point hygiene gap.",
      unhinged: "REPO ETIQUETTE by {margin}. {opponent}'s onboarding is a shrug.",
    },
  },
  {
    id: "rnd.hygiene.close",
    slot: "round",
    atoms: ["round_close_win"],
    categories: ["craft.hygiene"],
    motif: "round-hygiene",
    energy: 1,
    voice: "fight-card",
    text: {
      clean: "{subject} edges repo etiquette by {margin}.",
      spicy: "REPO ETIQUETTE, {subject} by {margin}. Hygiene margin only.",
      unhinged: "REPO ETIQUETTE by {margin}. The repo paperwork barely separates them.",
    },
  },
  {
    id: "rnd.breadth.clear",
    slot: "round",
    atoms: ["round_clear_win"],
    categories: ["ship.breadth"],
    motif: "round-breadth",
    energy: 2,
    voice: "fight-card",
    text: {
      clean: "{subject} wins the external work round by {margin} points.",
      spicy: "{subject} owns OSS CLOUT by {margin}. Releases and external repositories.",
      unhinged: "OSS CLOUT by {margin}. {opponent} has never left their own account.",
    },
  },
  {
    id: "rnd.breadth.close",
    slot: "round",
    atoms: ["round_close_win"],
    categories: ["ship.breadth"],
    motif: "round-breadth",
    energy: 1,
    voice: "fight-card",
    text: {
      clean: "{subject} takes external work by {margin}.",
      spicy: "{subject} edges OSS CLOUT by {margin}. Narrow public-evidence gap.",
      unhinged: "OSS CLOUT by {margin}. Almost no daylight in the public record.",
    },
  },
  {
    id: "rnd.substance.clear",
    slot: "round",
    atoms: ["round_clear_win"],
    categories: ["ship.substance"],
    motif: "round-substance",
    energy: 2,
    voice: "fight-card",
    text: {
      clean: "{subject} wins output substance by {margin} points.",
      spicy: "{subject} owns SHIP AURA. {margin}-point substance gap.",
      unhinged: "SHIP AURA by {margin}. {opponent} brought a folder of first commits.",
    },
  },
  {
    id: "rnd.substance.close",
    slot: "round",
    atoms: ["round_close_win"],
    categories: ["ship.substance"],
    motif: "round-substance",
    energy: 1,
    voice: "fight-card",
    text: {
      clean: "{subject} edges output substance by {margin}.",
      spicy: "{subject} edges SHIP AURA by {margin}. Substance margin stays narrow.",
      unhinged: "SHIP AURA by {margin}. The project evidence needs a photo finish.",
    },
  },
  {
    id: "rnd.substance.ratio",
    slot: "round",
    atoms: ["substance_ratio_gap"],
    categories: ["ship.substance"],
    motif: "substance-ratio",
    energy: 1,
    voice: "terminal",
    text: {
      clean:
        "{subjectSubstanceRatio} of {subject}'s repositories are substantial against {opponentSubstanceRatio}.",
      spicy: "Substance ratio {subjectSubstanceRatio} against {opponentSubstanceRatio}.",
      unhinged:
        "{subjectSubstanceRatio} real against {opponentSubstanceRatio}. Numbers are public.",
    },
  },
  {
    id: "rnd.substance.carry",
    slot: "round",
    atoms: ["one_repo_carry"],
    categories: ["ship.substance"],
    motif: "one-repo-carry",
    energy: 2,
    voice: "terminal",
    text: {
      clean: "{opponentDominantShare} of {opponent}'s substantial bytes live in one repository.",
      spicy: "{opponentDominantShare} of the evidence is one repository doing the lifting.",
      unhinged: "{opponentDominantShare} in one repo. {opponentSubstantial} substantial in total.",
    },
  },
  {
    id: "rnd.discipline.clear",
    slot: "round",
    atoms: ["round_clear_win"],
    categories: ["ship.discipline"],
    motif: "round-discipline",
    energy: 2,
    voice: "fight-card",
    text: {
      clean: "{subject} wins commit manners by {margin} points.",
      spicy: "{subject} takes COMMIT MANNERS by {margin}. The history uses sentences.",
      unhinged: "COMMIT MANNERS by {margin}. {opponent}'s history is a shrug in git form.",
    },
  },
  {
    id: "rnd.discipline.close",
    slot: "round",
    atoms: ["round_close_win"],
    categories: ["ship.discipline"],
    motif: "round-discipline",
    energy: 1,
    voice: "fight-card",
    text: {
      clean: "{subject} takes commit manners by {margin}.",
      spicy: "{subject} edges COMMIT MANNERS by {margin}. The sample barely separates them.",
      unhinged: "COMMIT MANNERS by {margin}. A one-word margin, properly described.",
    },
  },
  {
    id: "rnd.discipline.mainbranch",
    slot: "round",
    atoms: ["main_branch_behavior"],
    categories: ["ship.discipline"],
    motif: "main-branch",
    energy: 2,
    voice: "brainrot",
    text: {
      clean: "{subjectRepairs} repair commits and {subjectLowEffort} low-effort messages.",
      spicy: "Main branch behaviour: {subjectRepairs} repairs, pushed {subjectDays} days ago.",
      unhinged: "{subjectRepairs} repairs. {subjectLowEffort} shorthand. Immaculate history.",
    },
  },
  {
    id: "rnd.structure.clear",
    slot: "round",
    atoms: ["round_clear_win"],
    categories: ["craft.maintainability"],
    motif: "round-structure",
    energy: 2,
    voice: "fight-card",
    text: {
      clean: "{subject} wins the structure round by {margin} points on file-size behaviour.",
      spicy: "{subject} owns STRUCTURE AURA. {margin}-point file-size gap.",
      unhinged: "STRUCTURE AURA by {margin}. {opponent} keeps one file with everything in it.",
    },
  },
  {
    id: "rnd.structure.close",
    slot: "round",
    atoms: ["round_close_win"],
    categories: ["craft.maintainability"],
    motif: "round-structure",
    energy: 1,
    voice: "fight-card",
    text: {
      clean: "{subject} edges the structure round by {margin}.",
      spicy: "{subject} edges STRUCTURE AURA by {margin}. File-size evidence stays close.",
      unhinged: "STRUCTURE AURA by {margin}. The tree endpoint demands a recount.",
    },
  },
  {
    id: "rnd.hygiene.workspace",
    slot: "round",
    atoms: ["monorepo_operating_system"],
    categories: ["craft.hygiene"],
    motif: "workspace",
    energy: 1,
    voice: "terminal",
    text: {
      clean:
        "{subjectWorkspaces} detected among inspected repositories at {subjectOrganization} layout.",
      spicy: "{subjectWorkspaces}, {subjectOrganization} layout. Runs like a monorepo.",
      unhinged: "{subjectWorkspaces}. {subjectOrganization} layout. Operating-system energy.",
    },
  },
  {
    id: "rnd.hygiene.archive",
    slot: "round",
    atoms: ["archive_discipline"],
    categories: ["craft.hygiene"],
    motif: "archive-honours",
    energy: 1,
    voice: "deadpan",
    text: {
      clean: "{subjectArchived} archived on purpose, {subjectAbandoned} left abandoned.",
      spicy: "{subjectArchived} archived deliberately. {subjectAbandoned} abandoned. Clean books.",
      unhinged: "{subjectArchived} archived. {subjectAbandoned} abandoned. Knows when it is over.",
    },
  },
  {
    id: "rnd.generic.clear",
    slot: "round",
    atoms: ["round_clear_win"],
    motif: "round-generic",
    energy: 2,
    voice: "fight-card",
    text: {
      clean: "{subject} wins this round by {margin} points.",
      spicy: "{subject} takes it by {margin}. Not close.",
      unhinged: "{margin} points. {opponent} was not present for this round.",
    },
  },
  {
    id: "rnd.generic.close",
    slot: "round",
    atoms: ["round_close_win"],
    motif: "round-generic",
    energy: 1,
    voice: "fight-card",
    text: {
      clean: "{subject} takes this round by {margin} points.",
      spicy: "{subject} by {margin}. Tight one.",
      unhinged: "{margin} points. Won on the small stuff.",
    },
  },
  {
    id: "rnd.generic.tie",
    slot: "round",
    atoms: ["round_tie"],
    motif: "round-level",
    energy: 1,
    voice: "deadpan",
    text: {
      clean: "Level on the measured evidence for this category.",
      spicy: "Dead level. Mutual aura in this round.",
      unhinged: "Level. Nobody gets this one.",
    },
  },
  {
    id: "rnd.tie.split",
    slot: "round",
    atoms: ["round_tie"],
    motif: "round-split",
    energy: 1,
    voice: "terminal",
    text: {
      clean: "Both sides scored identically here.",
      spicy: "Identical scores. Split the round.",
      unhinged: "Identical. Take a point each and move on.",
    },
  },
  {
    id: "rnd.testing.tie",
    slot: "round",
    atoms: ["round_tie"],
    categories: ["craft.testing"],
    motif: "round-testing-level",
    energy: 1,
    voice: "deadpan",
    text: {
      clean: "Testing is level between these two.",
      spicy: "TEST AURA is level. Both bring tests, or neither does.",
      unhinged: "TEST AURA: level. Equally tested, equally exposed.",
    },
  },
  {
    id: "rnd.frequency.tie",
    slot: "round",
    atoms: ["round_tie"],
    categories: ["ship.frequency"],
    motif: "round-frequency-level",
    energy: 1,
    voice: "deadpan",
    text: {
      clean: "Activity is level across the observed window.",
      spicy: "GRINDSET is level. Same amount of logging on.",
      unhinged: "GRINDSET: level. Identical active-week counts.",
    },
  },
];

const STRENGTHS: readonly MemeTemplate[] = [
  {
    id: "str.maintenance",
    slot: "strength",
    atoms: ["strong_maintenance"],
    motif: "lights-still-on",
    energy: 1,
    voice: "deadpan",
    text: {
      clean:
        "Keeps {subjectMaintained} substantial projects current at {subjectContinuity} continuity.",
      spicy: "{subjectMaintained} substantial projects still alive. Adult supervision.",
      unhinged: "{subjectMaintained} projects maintained at {subjectContinuity}. Fully occupied.",
    },
  },
  {
    id: "str.external",
    slot: "strength",
    atoms: ["external_project_activity"],
    motif: "other-peoples-repos",
    energy: 1,
    voice: "deadpan",
    text: {
      clean:
        "Contributed to {subjectExternal} repositories they do not own, with {subjectMergedPrs} merged pull requests.",
      spicy:
        "Shows up in {subjectExternal} other people's repositories. {subjectMergedPrs} merged pull requests.",
      unhinged:
        "{subjectExternal} external repositories touched. Genuinely dangerous in someone else's codebase.",
    },
  },
  {
    id: "str.oneRepo",
    slot: "strength",
    atoms: ["one_repo_final_boss"],
    motif: "one-repo-carry",
    energy: 1,
    voice: "deadpan",
    text: {
      clean: "One substantial project, carried properly. Depth over breadth.",
      spicy: "One-repo final boss. {subjectDominantShare} of the evidence, and it holds.",
      unhinged: "One repo. Load-bearing. Genuinely carrying the entire profile.",
    },
  },
  {
    id: "str.sustained",
    slot: "strength",
    atoms: ["sustained_work_gap"],
    motif: "marathon",
    energy: 1,
    voice: "deadpan",
    text: {
      clean: "Projects here survive past six months, and the timeline is public.",
      spicy: "{subjectSustained} of the substantial work survives past six months.",
      unhinged: "Sustains projects for years. The timeline keeps going.",
    },
  },
  {
    id: "str.structure",
    slot: "strength",
    atoms: ["structure_gap"],
    motif: "layout",
    energy: 1,
    voice: "deadpan",
    text: {
      clean:
        "Repository layout scores {subjectOrganization}: source, tests and config live where you would look.",
      spicy: "{subjectOrganization} layout score. You can find things without a map.",
      unhinged: "{subjectOrganization} layout. Someone here has directory opinions.",
    },
  },
  {
    id: "str.workspace",
    slot: "strength",
    atoms: ["monorepo_operating_system"],
    motif: "workspace",
    energy: 2,
    voice: "brainrot",
    text: {
      clean: "{subjectWorkspaces} detected with a maintained {subjectOrganization} layout.",
      spicy: "Operates {subjectWorkspaces} at operating-system scale.",
      unhinged: "{subjectWorkspaces}, {subjectOrganization} layout. Has protocol opinions.",
    },
  },
  {
    id: "str.coverage",
    slot: "strength",
    atoms: ["high_tree_coverage"],
    motif: "full-coverage",
    energy: 1,
    voice: "terminal",
    text: {
      clean:
        "All {subjectInspected} selected repositories were fully readable, so this scorecard is well evidenced.",
      spicy: "All {subjectInspected} selected repositories were readable end to end.",
      unhinged: "{subjectInspected} repositories, fully readable. Total receipt exposure.",
    },
  },
  {
    id: "str.archive",
    slot: "strength",
    atoms: ["archive_discipline"],
    motif: "archive-honours",
    energy: 1,
    voice: "deadpan",
    text: {
      clean: "{subjectArchived} projects deliberately archived. Finishing is a skill.",
      spicy: "{subjectArchived} archived on purpose, {subjectAbandoned} left to rot.",
      unhinged: "{subjectArchived} archived. Knows when something is done.",
    },
  },
  {
    id: "str.grindset",
    slot: "strength",
    atoms: ["grindset_gap"],
    motif: "active-weeks",
    energy: 1,
    voice: "terminal",
    text: {
      clean: "Active in {subjectWeeks} of the last {weekWindow} weeks.",
      spicy: "{subjectWeeks} of {weekWindow} weeks active. The grindset is public.",
      unhinged: "{subjectWeeks} active weeks out of {weekWindow}. Relentless, and all public.",
    },
  },
  {
    id: "str.tests",
    slot: "strength",
    atoms: ["tests_gap"],
    motif: "test-coverage-numbers",
    energy: 1,
    voice: "terminal",
    text: {
      clean: "{subjectTests} of inspected repositories carry meaningful tests.",
      spicy: "{subjectTests} of the inspected work is tested. Test discipline confirmed.",
      unhinged: "{subjectTests} tested. Writes tests voluntarily, for fun, unprompted.",
    },
  },
  {
    id: "str.verification",
    slot: "strength",
    atoms: ["verification_stack"],
    motif: "verification-stack",
    energy: 1,
    voice: "terminal",
    text: {
      clean: "{subjectTests} tested and {subjectWorkflow} of it runs under CI configuration.",
      spicy: "{subjectTests} tested, {subjectWorkflow} automated. A real verification stack.",
      unhinged: "{subjectCiCoverage} under CI. Nothing lands here on vibes alone.",
    },
  },
  {
    id: "str.ci",
    slot: "strength",
    atoms: ["ci_gap"],
    motif: "ci-robots",
    energy: 1,
    voice: "terminal",
    text: {
      clean: "CI is configured across {subjectCi} of inspected repositories.",
      spicy: "{subjectCi} CI coverage. The robots are on payroll here.",
      unhinged: "{subjectCi} CI. Refuses to merge anything a machine has not shouted at.",
    },
  },
  {
    id: "str.releases",
    slot: "strength",
    atoms: ["release_gap"],
    motif: "release-count",
    energy: 1,
    voice: "deadpan",
    text: {
      clean:
        "{subjectReleases} published, so the work reaches people who are not reading the repository.",
      spicy: "{subjectReleases} published. Ships to users, not just to main.",
      unhinged: "{subjectReleases} tagged and out the door. Actually finishes.",
    },
  },
  {
    id: "str.releaseCadence",
    slot: "strength",
    atoms: ["release_density_gap"],
    motif: "release-cadence",
    energy: 1,
    voice: "terminal",
    text: {
      clean:
        "{subjectReleaseCount} releases across {subjectReleaseProjects} projects, {subjectReleaseDensity} each.",
      spicy: "{subjectReleaseCount} releases at {subjectReleaseDensity} a project. Somebody tags.",
      unhinged:
        "{subjectReleaseCount} tags on {subjectReleaseProjects} projects. Machine behaviour.",
    },
  },
  {
    id: "str.mainbranch",
    slot: "strength",
    atoms: ["main_branch_behavior"],
    motif: "main-branch",
    energy: 2,
    voice: "brainrot",
    text: {
      clean:
        "Pushed {subjectDays} days ago with {subjectRepairs} repair commits and {subjectLowEffort} low-effort messages.",
      spicy: "{subjectRepairs} repairs, {subjectLowEffort} shorthand. Main branch has no notes.",
      unhinged: "{subjectRepairs} repairs. Commits land once and stay landed.",
    },
  },
  {
    id: "str.polyglot",
    slot: "strength",
    atoms: ["polyglot_with_depth"],
    motif: "polyglot",
    energy: 1,
    voice: "deadpan",
    text: {
      clean: "Works across {subjectLanguages} languages inside substantial projects.",
      spicy: "{subjectLanguages} languages at project scale. Polyglot maxxing with substance.",
      unhinged: "{subjectLanguages} languages. Refuses to be pinned to one ecosystem.",
    },
  },
  {
    id: "str.concentration",
    slot: "strength",
    atoms: ["impact_concentration"],
    motif: "property-portfolio",
    energy: 1,
    voice: "deadpan",
    text: {
      clean: "{subjectSubstantial} substantial projects owned and maintained.",
      spicy: "{subjectSubstantial} substantial projects, owned and maintained.",
      unhinged: "{subjectSubstantial} real projects. Full open-source property portfolio.",
    },
  },
];

const WEAKNESSES: readonly MemeTemplate[] = [
  {
    id: "wk.abandoned",
    slot: "weakness",
    atoms: ["abandoned_project_gap"],
    motif: "graveyard",
    energy: 1,
    voice: "deadpan",
    text: {
      clean: "{opponentAbandoned} that could use either a commit or an archive.",
      spicy: "{opponentAbandoned} sitting unmaintained. Archive them or revive them.",
      unhinged: "{opponentAbandonedCount} side quests, none completed, none archived. Pick a lane.",
    },
  },
  {
    id: "wk.graveyard",
    slot: "weakness",
    atoms: ["repo_graveyard_density"],
    motif: "graveyard",
    energy: 2,
    voice: "terminal",
    text: {
      clean:
        "{opponentGraveyardShare} of the substantial projects have gone a year without maintenance.",
      spicy:
        "{opponentAbandonedCount} unmaintained against {opponentArchived} deliberately archived.",
      unhinged: "{opponentGraveyardShare} density. The archive button was right there.",
    },
  },
  {
    id: "wk.substance",
    slot: "weakness",
    atoms: ["repo_count_without_substance"],
    motif: "repo-confetti",
    energy: 1,
    voice: "terminal",
    text: {
      clean: "{opponentRepos} public repositories, {opponentSubstantial} of them substantial.",
      spicy:
        "{opponentRepos} repositories, {opponentSubstantial} with real weight. The pile is talking.",
      unhinged:
        "{opponentRepos} repos. {opponentSubstantial} substantial. The rest is repository confetti.",
    },
  },
  {
    id: "wk.docs",
    slot: "weakness",
    atoms: ["docs_without_shipping"],
    motif: "readme-alibi",
    energy: 1,
    voice: "deadpan",
    text: {
      clean: "Strong documentation at {opponentDocs}, but nothing published yet.",
      spicy: "{opponentDocs} documentation coverage and zero releases. The README is ahead.",
      unhinged: "{opponentDocs} docs, zero releases. Documentation-driven development.",
    },
  },
  {
    id: "wk.forks",
    slot: "weakness",
    atoms: ["high_fork_ratio"],
    motif: "fork-composition",
    energy: 1,
    voice: "terminal",
    text: {
      clean:
        "{opponentForkShare} of the public profile is forks rather than original repositories.",
      spicy: "{opponentForks} forks. Forklift certified, original work harder to find.",
      unhinged: "{opponentForkShare} forks. The original work is in there somewhere.",
    },
  },
  {
    id: "wk.releases",
    slot: "weakness",
    atoms: ["release_avoidance"],
    motif: "release-avoidance",
    energy: 1,
    voice: "deadpan",
    text: {
      clean: "{opponentSubstantial} substantial projects and no tagged release on any of them.",
      spicy: "Release avoidant: {opponentSubstantial} real projects, not one version tag.",
      unhinged: "{opponentSubstantial} projects, zero tags. Version numbers are a commitment.",
    },
  },
  {
    id: "wk.messages",
    slot: "weakness",
    atoms: ["commit_manners_gap"],
    motif: "commit-shorthand",
    energy: 1,
    voice: "terminal",
    text: {
      clean: "{opponentLowEffort} of public commit messages are one word or shorter.",
      spicy:
        "{opponentLowEffort} of commit messages are \u201Cfix\u201D or shorter. Future you suffers.",
      unhinged:
        "Median commit message {opponentMessageLength} characters. That is a grunt, not a message.",
    },
  },
  {
    id: "wk.chaos",
    slot: "weakness",
    atoms: ["commit_chaos"],
    motif: "commit-crime-board",
    energy: 2,
    voice: "brainrot",
    text: {
      clean:
        "{opponentLowEffort} of sampled messages say nothing and {opponentReverts} are reverts.",
      spicy: "{opponentLowEffort} shorthand, {opponentReverts} reverts. The log is a group chat.",
      unhinged: "Median message {opponentMessageLength} characters. Chaos, documented in git.",
    },
  },
  {
    id: "wk.repairs",
    slot: "weakness",
    atoms: ["repair_loop_gap"],
    motif: "fix-loop",
    energy: 1,
    voice: "terminal",
    text: {
      clean: "{opponentRepairs} of observed commits repair an earlier commit.",
      spicy: "{opponentRepairs} repair commits. The fix-the-fix loop is real here.",
      unhinged:
        "{opponentRepairs} of commits exist to undo the previous one. fix, fix again, fix2.",
    },
  },
  {
    id: "wk.tests",
    slot: "weakness",
    atoms: ["tests_gap"],
    motif: "faith-based-deploy",
    energy: 1,
    voice: "terminal",
    text: {
      clean: "Only {opponentTests} of inspected repositories carry meaningful tests.",
      spicy: "{opponentTests} of the inspected work is tested. That is faith, not verification.",
      unhinged: "{opponentTests} tested. Deploys on pure self-belief.",
    },
  },
  {
    id: "wk.ci",
    slot: "weakness",
    atoms: ["ci_gap"],
    motif: "works-on-my-machine",
    energy: 1,
    voice: "terminal",
    text: {
      clean: "CI is configured on {opponentCi} of inspected repositories.",
      spicy: "{opponentCi} CI coverage. The pipeline is a person remembering to check.",
      unhinged: "{opponentCi} CI. The build passes because nobody has tried it.",
    },
  },
  {
    id: "wk.yaml",
    slot: "weakness",
    atoms: ["tooling_without_output"],
    motif: "yaml-discipline",
    energy: 1,
    voice: "deadpan",
    text: {
      clean:
        "{opponentCi} CI coverage across {opponentSubstantial} substantial projects. Pipeline ahead of output.",
      spicy:
        "{opponentCi} pipeline coverage, {opponentSubstantial} substantial projects behind it.",
      unhinged: "{opponentCi} CI. The workflow file is the most finished artefact here.",
    },
  },
  {
    id: "wk.recency",
    slot: "weakness",
    atoms: ["recent_activity_gap"],
    motif: "last-push-age",
    energy: 1,
    voice: "terminal",
    text: {
      clean: "Last public push was {opponentDays} days ago.",
      spicy: "{opponentMonths} months since the last public push. Local-only legend, possibly.",
      unhinged: "{opponentDays} days of public silence. The work may exist. GitHub cannot see it.",
    },
  },
  {
    id: "wk.activity",
    slot: "weakness",
    atoms: ["activity_without_shipping"],
    motif: "keyboard-mileage",
    energy: 1,
    voice: "terminal",
    text: {
      clean:
        "Active {opponentWeeks} of {weekWindow} weeks with {opponentSubstantial} substantial projects.",
      spicy: "{opponentWeeks} active weeks, {opponentSubstantial} substantial projects to show.",
      unhinged: "{opponentWeeks} weeks of motion. {opponentSubstantial} projects of output.",
    },
  },
  {
    id: "wk.structure",
    slot: "weakness",
    atoms: ["structure_gap"],
    motif: "layout",
    energy: 1,
    voice: "terminal",
    text: {
      clean:
        "Repository layout scores {opponentOrganization}: source, tests and artefacts are mixed together.",
      spicy: "{opponentOrganization} layout score. Build output and source share a room.",
      unhinged:
        "{opponentOrganization} layout. Committed artefacts, no separation, licensed chaos.",
    },
  },
  {
    id: "wk.polyglot",
    slot: "weakness",
    atoms: ["polyglot_without_depth"],
    motif: "polyglot-tourism",
    energy: 1,
    voice: "deadpan",
    text: {
      clean:
        "{opponentLanguages} languages observed, {opponentDeepLanguages} of them in substantial projects.",
      spicy:
        "{opponentLanguages} languages, {opponentDeepLanguages} with real projects behind them.",
      unhinged: "{opponentLanguages} ecosystems visited. {opponentSustained} projects survived.",
    },
  },
  {
    id: "wk.carry",
    slot: "weakness",
    atoms: ["one_repo_carry"],
    motif: "one-repo-carry",
    energy: 2,
    voice: "terminal",
    text: {
      clean: "{opponentDominantShare} of the measured bytes sit in a single repository.",
      spicy: "{opponentDominantShare} in one repository. That is a single point of aura.",
      unhinged: "{opponentSubstantial} substantial, {opponentDominantShare} in one. Fragile.",
    },
  },
  {
    id: "wk.mismatch",
    slot: "weakness",
    atoms: ["confidence_mismatch"],
    motif: "score-versus-coverage",
    energy: 1,
    voice: "terminal",
    text: {
      clean:
        "Score {opponentScore} at confidence {opponentConfidence}, from {opponentInspected} inspected repositories.",
      spicy: "{opponentScore} on confidence {opponentConfidence}. Strong number, thin evidence.",
      unhinged:
        "{opponentScore} scored, {opponentConfidence} confidence. The sample is doing work.",
    },
  },
  {
    id: "wk.evidence",
    slot: "weakness",
    atoms: ["low_public_evidence"],
    motif: "stealth-mode",
    energy: 1,
    voice: "terminal",
    text: {
      clean: "Only {opponentInspectable}, so this scorecard is thin.",
      spicy: "{opponentInspectable} at confidence {opponentConfidence}. Hard to judge.",
      unhinged: "Confidence {opponentConfidence}. Whatever is being built is not built here.",
    },
  },
];

const LOW_EVIDENCE: readonly MemeTemplate[] = [
  {
    id: "low.stealth",
    slot: "low-evidence",
    atoms: ["low_public_evidence"],
    motif: "stealth-mode",
    energy: 1,
    voice: "terminal",
    text: {
      clean: "Stealth mode: {opponentEligible} eligible repositories, {opponentInspectable}.",
      spicy: "Stealth mode detected: {opponentInspectable}. Not much of a fight.",
      unhinged: "Stealth mode. {opponentInspectable}. Ghost with a keyboard.",
    },
  },
  {
    id: "low.private",
    slot: "low-evidence",
    atoms: ["low_public_evidence"],
    motif: "stealth-mode",
    energy: 1,
    voice: "deadpan",
    text: {
      clean: "The work may be private. Git Mog can only score what GitHub shows publicly.",
      spicy: "Might be shipping privately. Git Mog cannot score what it cannot see.",
      unhinged:
        "Could be shipping constantly inside a private organisation. The public record says nothing.",
    },
  },
  {
    id: "low.confidence",
    slot: "low-evidence",
    atoms: ["low_public_evidence"],
    motif: "stealth-mode",
    energy: 1,
    voice: "terminal",
    text: {
      clean: "Confidence {opponentConfidence}. Treat this score as an estimate, not a verdict.",
      spicy: "Confidence {opponentConfidence}. This is an estimate wearing a scoreboard.",
      unhinged: "Confidence {opponentConfidence}. Barely enough evidence to be rude about.",
    },
  },
  {
    id: "low.notaloss",
    slot: "low-evidence",
    atoms: ["low_public_evidence"],
    motif: "stealth-mode",
    energy: 1,
    voice: "deadpan",
    text: {
      clean: "Thin public evidence is not the same as weak engineering.",
      spicy: "Thin evidence is not a loss. It is a missing scoreboard.",
      unhinged: "No receipts is not the same as no skill. It is just no receipts.",
    },
  },
  {
    id: "low.oneRepo",
    slot: "low-evidence",
    atoms: ["low_public_evidence"],
    motif: "stealth-mode",
    energy: 1,
    voice: "terminal",
    text: {
      clean: "{opponentEligible} eligible repositories give a narrow view of this developer.",
      spicy:
        "{opponentEligible} eligible repositories. Narrow view, low confidence, honest about it.",
      unhinged: "{opponentEligible} eligible repositories. The sample size is doing heavy lifting.",
    },
  },
  {
    id: "low.invite",
    slot: "low-evidence",
    atoms: ["low_public_evidence"],
    motif: "stealth-mode",
    energy: 2,
    voice: "fight-card",
    text: {
      clean: "Push something public and run this again for a stronger result.",
      spicy: "Push something public and run the fade again. The score will move.",
      unhinged: "Make something public. Then come back and be judged properly.",
    },
  },
  {
    id: "low.cap",
    slot: "low-evidence",
    atoms: ["low_public_evidence"],
    motif: "stealth-mode",
    energy: 1,
    voice: "deadpan",
    text: {
      clean: "A low-confidence result is shown, but it is not equivalent to a well-evidenced one.",
      spicy:
        "Low confidence shown on purpose. It does not carry the same weight as a full scorecard.",
      unhinged: "Low confidence, printed loudly, so nobody screenshots this as gospel.",
    },
  },
  {
    id: "low.window",
    slot: "low-evidence",
    atoms: ["low_public_evidence"],
    motif: "stealth-mode",
    energy: 1,
    voice: "terminal",
    text: {
      clean: "Public activity events were thin, so activity metrics carry less weight here.",
      spicy: "Barely any public events. The activity rounds are running on fumes.",
      unhinged: "Almost no public events. The activity score is a guess with manners.",
    },
  },
];

/**
 * Battle notes. These are aggregate statements about the scoreboard rather than
 * restatements of a single atom, so the section adds information instead of echoing
 * the finisher.
 */
const SUMMARIES: readonly MemeTemplate[] = [
  {
    id: "sum.scoreline",
    slot: "summary",
    atoms: ["verdict_margin"],
    motif: "grade-line",
    energy: 1,
    voice: "terminal",
    text: {
      clean: "Final: {subjectScore} ({subjectGrade}) against {opponentScore} ({opponentGrade}).",
      spicy:
        "{subjectScore} {subjectGrade} against {opponentScore} {opponentGrade}. Same scorecard.",
      unhinged:
        "{subjectScore} {subjectGrade} to {opponentScore} {opponentGrade}. Same rubric, different outcome.",
    },
  },
  {
    id: "sum.basis",
    slot: "summary",
    atoms: ["verdict_margin"],
    motif: "measured-basis",
    energy: 1,
    voice: "deadpan",
    text: {
      clean:
        "Scored from {measuredWeight} of the scorecard's 100 points. Unreachable metrics stay outside this score.",
      spicy:
        "{measuredWeight} of 100 scorecard points were measurable. Nothing scored zero for being invisible.",
      unhinged:
        "{measuredWeight} of 100 points measurable. Public GitHub kept the rest off-camera.",
    },
  },
  {
    id: "sum.confidence",
    slot: "summary",
    atoms: ["verdict_margin"],
    motif: "confidence-cap",
    energy: 1,
    voice: "deadpan",
    text: {
      clean:
        "Confidence: {subjectConfidence} against {opponentConfidence}. Public evidence has a hard ceiling.",
      spicy:
        "Confidence {subjectConfidence} to {opponentConfidence}. Public evidence is capped on purpose.",
      unhinged:
        "Confidence {subjectConfidence} to {opponentConfidence}. Public GitHub is a window, not omniscience.",
    },
  },
  {
    id: "sum.margin",
    slot: "summary",
    atoms: ["verdict_margin"],
    motif: "margin-traceable",
    energy: 1,
    voice: "terminal",
    text: {
      clean: "{margin} points separate them on the measured basis.",
      spicy: "{margin} points of separation, all of it traceable to a file or a date.",
      unhinged: "{margin} points. Every one of them has a file path behind it.",
    },
  },
  {
    id: "sum.receipts",
    slot: "summary",
    atoms: ["verdict_margin"],
    motif: "receipts",
    energy: 1,
    voice: "deadpan",
    text: {
      clean: "Every category below links to the public evidence that produced it.",
      spicy: "Open the receipts. Every number links to something public.",
      unhinged: "Receipts are open. Argue with the file paths, not the scoreboard.",
    },
  },
  {
    id: "sum.nuclear",
    slot: "summary",
    atoms: ["nuclear_gap"],
    motif: "nuclear-margin",
    energy: 2,
    voice: "terminal",
    text: {
      clean: "A {margin}-point margin is wide enough that no single metric explains it.",
      spicy: "{margin} points. Not one bad round, the whole scorecard.",
      unhinged: "{margin} points. Structural, not situational.",
    },
  },
  {
    id: "sum.photofinish",
    slot: "summary",
    atoms: ["photo_finish"],
    motif: "rounding-error",
    energy: 1,
    voice: "deadpan",
    text: {
      clean: "At {margin} points apart, the ordering sits inside the scorecard's own resolution.",
      spicy: "{margin} points apart. Do not build a personality on this result.",
      unhinged: "{margin} points. Screenshot it if you like, it proves very little.",
    },
  },
  {
    id: "sum.lowevidence",
    slot: "summary",
    atoms: ["low_public_evidence"],
    motif: "stealth-mode",
    energy: 1,
    voice: "deadpan",
    text: {
      clean:
        "One side is backed by noticeably thinner public evidence, at confidence {opponentConfidence}.",
      spicy:
        "Confidence {opponentConfidence} on one side. That result is an estimate, not a verdict.",
      unhinged: "Confidence {opponentConfidence}. One of these scorecards is running on fumes.",
    },
  },
  {
    id: "sum.evidencediff",
    slot: "summary",
    atoms: ["public_evidence_diff"],
    motif: "camera-quality",
    energy: 1,
    voice: "terminal",
    text: {
      clean:
        "{subjectInspected} repositories were read against {opponentInspected}, at confidence {subjectConfidence} and {opponentConfidence}.",
      spicy:
        "Same fight card, different camera quality: {subjectInspected} repos against {opponentInspected}.",
      unhinged:
        "{subjectConfidence} against {opponentConfidence}. Uneven footage, honest about it.",
    },
  },
  {
    id: "sum.mismatch",
    slot: "summary",
    atoms: ["confidence_mismatch"],
    motif: "score-versus-coverage",
    energy: 1,
    voice: "deadpan",
    text: {
      clean:
        "A score of {opponentScore} at confidence {opponentConfidence} is an estimate, not a ranking.",
      spicy: "{opponentScore} on {opponentConfidence} confidence. Treat that number gently.",
      unhinged: "{opponentScore} scored from {opponentInspected} repositories. Hold it loosely.",
    },
  },
  {
    id: "sum.graveyard",
    slot: "summary",
    atoms: ["repo_graveyard_density"],
    motif: "graveyard",
    energy: 2,
    voice: "terminal",
    text: {
      clean:
        "{opponentAbandonedCount} substantial projects unmaintained for a year, {opponentArchived} archived.",
      spicy: "{opponentGraveyardShare} of the substantial work is unmaintained.",
      unhinged: "{opponentAbandonedCount} in the ground, {opponentArchived} buried properly.",
    },
  },
  {
    id: "sum.substance",
    slot: "summary",
    atoms: ["substance_ratio_gap"],
    motif: "substance-ratio",
    energy: 1,
    voice: "terminal",
    text: {
      clean:
        "{subjectSubstanceRatio} of one profile is substantial work, against {opponentSubstanceRatio}.",
      spicy: "Substance: {subjectSubstanceRatio} to {opponentSubstanceRatio}.",
      unhinged: "{subjectSubstanceRatio} against {opponentSubstanceRatio}. That is the fight.",
    },
  },
];

export const MEME_TEMPLATES: readonly MemeTemplate[] = Object.freeze([
  ...MATCHUPS,
  ...FINISHERS,
  ...TIE_FINISHERS,
  ...ROUNDS,
  ...STRENGTHS,
  ...WEAKNESSES,
  ...LOW_EVIDENCE,
  ...SUMMARIES,
]);

export const TEMPLATE_COUNTS = Object.freeze({
  matchup: MATCHUPS.length,
  finisher: FINISHERS.length,
  tie: TIE_FINISHERS.length,
  round: ROUNDS.length,
  strength: STRENGTHS.length,
  weakness: WEAKNESSES.length,
  lowEvidence: LOW_EVIDENCE.length,
  summary: SUMMARIES.length,
});
