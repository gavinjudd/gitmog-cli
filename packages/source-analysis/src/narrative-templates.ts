import type { RoastMode } from "@gitmog/scoring";

import type { AllowedThemeId } from "./types.js";

export type ModeVariants = Readonly<Record<RoastMode, readonly string[]>>;

export interface NarrativeTemplateFamily {
  readonly matchup: ModeVariants;
  readonly leftRead: ModeVariants;
  readonly rightRead: ModeVariants;
  readonly finisher: ModeVariants;
}

const variants = (
  clean: readonly [string, string],
  spicy: readonly [string, string, string],
  unhinged: readonly [string, string],
): ModeVariants => Object.freeze({ clean, spicy, unhinged });

const insertHook = (template: string, hook: string): string =>
  template
    .replace("{Hook}", `${hook.charAt(0).toUpperCase()}${hook.slice(1)}`)
    .replace("{hook}", hook);

const profileVariants = (
  leftHooks: ModeVariants,
  rightHooks: ModeVariants,
): Pick<NarrativeTemplateFamily, "leftRead" | "rightRead"> => ({
  leftRead: {
    clean: [
      "@{handle} — {identity}. {Hook}; {angle}.",
      "@{handle} — {identity}. {Hook}. Code signature {angle}.",
    ].map((template, index) =>
      insertHook(template, leftHooks.clean[index] ?? "the fingerprint stays clear"),
    ),
    spicy: [
      "@{handle} — {identity}. {Hook}.",
      "@{handle}: {identity}. {Hook}.",
      "{Hook}. @{handle} — {identity}.",
    ].map((template, index) =>
      insertHook(template, leftHooks.spicy[index] ?? "the signal keeps its edge"),
    ),
    unhinged: ["@{handle} — {identity}. {Hook}.", "{Hook}. @{handle} manifests {identity}."].map(
      (template, index) =>
        insertHook(template, leftHooks.unhinged[index] ?? "the code keeps escalating"),
    ),
  },
  rightRead: {
    clean: [
      "@{handle} — {identity}. {Hook}; {angle}.",
      "@{handle} — {identity}. {Hook}. Code signature {angle}.",
    ].map((template, index) =>
      insertHook(template, rightHooks.clean[index] ?? "the contrast stays legible"),
    ),
    spicy: [
      "@{handle} — {identity}. {Hook}.",
      "@{handle}: {identity}. {Hook}.",
      "{Hook}. @{handle} — {identity}.",
    ].map((template, index) =>
      insertHook(template, rightHooks.spicy[index] ?? "the contrast stays specific"),
    ),
    unhinged: ["@{handle} — {identity}. {Hook}.", "{Hook}. @{handle} manifests {identity}."].map(
      (template, index) =>
        insertHook(template, rightHooks.unhinged[index] ?? "the second signal joins the pile"),
    ),
  },
});

const family = (
  matchup: ModeVariants,
  finisher: ModeVariants,
  leftHooks: ModeVariants,
  rightHooks: ModeVariants,
): NarrativeTemplateFamily =>
  Object.freeze({
    matchup,
    finisher,
    ...profileVariants(leftHooks, rightHooks),
  });

/** Deliberately bounded authored corpus: nine evidence families, seven variants per slot. */
export const NARRATIVE_TEMPLATE_CORPUS: Readonly<Record<AllowedThemeId, NarrativeTemplateFamily>> =
  Object.freeze({
    "architecture-clash": family(
      variants(
        [
          "@{first} keeps the operation in view; @{second} routes it through deliberate seams.",
          "The visible split between @{first} and @{second} is concrete flow versus reusable layers.",
        ],
        [
          "@{first} puts the move on the page; @{second} gives the move a forwarding address.",
          "The call stack stays street-level for @{first} and acquires zoning laws under @{second}.",
          "@{first} ships visible control flow; @{second} makes indirection file a change request.",
        ],
        [
          "@{first} brought a function. @{second} brought the function's management structure.",
          "@{first} touches the behavior directly; @{second} reaches it through an interface maze.",
        ],
      ),
      variants(
        [
          "@{first} keeps the move visible; @{second} keeps the seams replaceable.",
          "One call path stays local; the other earns a forwarding address.",
        ],
        [
          "@{first} has the street address; @{second} has mail forwarding for the call stack.",
          "@{first} brought the move; @{second} brought every future version of the move.",
          "The shortest path belongs to @{first}; the interchange map belongs to @{second}.",
        ],
        [
          "@{first} kicked down the call site; @{second} installed an elevator between statements.",
          "@{first} shipped one visible call path; @{second} hired three abstractions to carry it.",
        ],
      ),
      variants(
        ["the concrete path stays inspectable", "the local move carries the argument"],
        [
          "the call site keeps the plot visible",
          "indirection has to catch up on foot",
          "the behavior keeps a street address",
        ],
        ["the function refuses middle management", "the call stack can see daylight"],
      ),
      variants(
        ["the seams stay explicit", "the layering carries the flexibility"],
        [
          "every hop has a reason and a forwarding address",
          "the abstraction budget is fully employed",
          "the layers keep future changes off the concrete path",
        ],
        ["the function has an org chart", "the indirection built its own transit system"],
      ),
    ),
    "defense-clash": family(
      variants(
        [
          "@{first} leans on trusted assumptions; @{second} makes boundaries prove their case.",
          "The source contrast is permissive flow for @{first} and explicit checks for @{second}.",
        ],
        [
          "@{first} gives the payload momentum; @{second} gives it a background check.",
          "@{first} bets on the happy path while @{second} itemizes every possible detour.",
          "The boundary is a welcome mat for @{first} and a checklist for @{second}.",
        ],
        [
          "@{first} handed the payload a key; @{second} made it present three forms of identification.",
          "@{first} trusts the input's vibe. @{second} cross-examines every field.",
        ],
      ),
      variants(
        [
          "@{first} preserves flow; @{second} preserves the boundary contract.",
          "Assumption and verification meet at the same payload, both visible in code.",
        ],
        [
          "@{first} lets the payload merge; @{second} asks for the test results first.",
          "The happy path runs express under @{first}; @{second} audits every exit.",
          "@{first} offers trust on arrival; @{second} checks the guest list.",
        ],
        [
          "@{first} opened the gate; @{second} turned the schema into a deposition.",
          "The payload waved at @{first} and was immediately subpoenaed by @{second}.",
        ],
      ),
      variants(
        ["the assumptions stay visible", "the flow avoids defensive detours"],
        [
          "the happy path has right of way",
          "input checks stay light",
          "trust keeps the control flow moving",
        ],
        ["the input got a master key", "the edge cases were told to behave"],
      ),
      variants(
        ["the contracts are stated before use", "the checks turn ambiguity into a branch"],
        [
          "every field arrives with paperwork",
          "the error paths stand at attention",
          "validation appears at each boundary",
        ],
        ["the schema conducts the interrogation", "the guards formed a committee"],
      ),
    ),
    "density-clash": family(
      variants(
        [
          "@{first} compresses the idea locally; @{second} spreads it across explicit scaffolding.",
          "The visible density runs from @{first}'s compact core to @{second}'s ceremonial structure.",
        ],
        [
          "@{first} keeps the implementation pocket-sized; @{second} inventories every dependency.",
          "@{first} keeps the module tight; @{second} gives each concern a named room.",
          "Local compression meets a full scaffolding manifest in @{first} versus @{second}.",
        ],
        [
          "@{first} fit the behavior in a coat pocket; @{second} filed construction drawings.",
          "@{first} brought a pocketknife. @{second} arrived with a ribbon-cutting schedule.",
        ],
      ),
      variants(
        [
          "@{first} spends fewer lines; @{second} spends more names on structure.",
          "Compact expression and explicit scaffolding leave different, measurable footprints.",
        ],
        [
          "@{first} kept control flow local; @{second} tagged every layer and dependency.",
          "@{first} keeps the move pocket-sized; @{second} gives it a floor plan.",
          "The line budget favors @{first}; the structure budget belongs to @{second}.",
        ],
        [
          "@{first} folded the module into a pocketknife; @{second} built the workshop.",
          "The code left @{first} in one piece and reached @{second} as a municipal project.",
        ],
      ),
      variants(
        ["the local expression carries more weight", "the footprint stays intentionally small"],
        [
          "the implementation travels light",
          "the line count wastes no motion",
          "the compact core keeps its elbows in",
        ],
        ["the whole move fits under one breakpoint", "the module is hiding in plain sight"],
      ),
      variants(
        ["the scaffolding makes each role explicit", "the repeated structure carries the ceremony"],
        [
          "every concern gets a labeled shelf",
          "the wrappers arrive fully documented",
          "the structure checks luggage by category",
        ],
        ["the call path booked a venue", "the boilerplate has opening credits"],
      ),
    ),
    "domain-clash": family(
      variants(
        [
          "@{first} orchestrates application flow; @{second} works closer to protocols, data, or algorithms.",
          "The source samples divide between @{first}'s product wiring and @{second}'s underlying mechanics.",
        ],
        [
          "@{first} keeps the product moving; @{second} checks what the machinery is doing per byte.",
          "The stack changes altitude between @{first}'s orchestration and @{second}'s mechanical depth.",
          "@{first} connects user-facing flow; @{second} handles the protocol, pipeline, or algorithm underneath.",
        ],
        [
          "@{first} runs the show upstairs; @{second} is in the engine room negotiating with the machinery.",
          "The call stack hired @{first} as road manager and @{second} as bit accountant.",
        ],
      ),
      variants(
        [
          "@{first} owns the orchestration seam; @{second} owns the implementation mechanics below it.",
          "Product wiring and low-level depth share the stack without becoming the same style.",
        ],
        [
          "@{first} routes the experience; @{second} traces the machinery carrying it.",
          "The product map sits with @{first}; the protocol notebook sits with @{second}.",
          "@{first} connects the flow; @{second} measures the engine room.",
        ],
        [
          "@{first} schedules the tour; @{second} disassembles the bus between stops.",
          "The feature reached @{first}; the bytes were already in a meeting with @{second}.",
        ],
      ),
      variants(
        [
          "the service boundaries carry the implementation",
          "the application flow remains the center of gravity",
        ],
        [
          "the product plumbing keeps pressure",
          "the integrations stay in formation",
          "the user-facing path keeps moving",
        ],
        ["the service graph has a dispatcher", "the product pipes learned choreography"],
      ),
      variants(
        [
          "the visible work sits closer to primitives",
          "the protocol or algorithm carries the core",
        ],
        [
          "the byte-level fingerprint is unusually specific",
          "the machinery gets first-class attention",
          "the low-level path refuses to be background detail",
        ],
        ["the allocator got a calendar invite", "the protocol stack started answering back"],
      ),
    ),
    "mirror-match": family(
      variants(
        [
          "@{left} and @{right} use the same toolbox with different grips.",
          "Same code neighborhood; @{left} and @{right} leave different tracks.",
        ],
        [
          "@{left} and @{right} share a toolbox, but the wear marks land on different handles.",
          "The style map overlaps; @{left} and @{right} reveal the split in how they grip it.",
          "This mirror match has matching axes and mismatched fingerprints.",
        ],
        [
          "@{left} found the mirror. @{right} left different fingerprints all over it.",
          "Same code habitat, different tracks in the floorboards.",
        ],
      ),
      variants(
        [
          "@{left} and @{right} rhyme without becoming duplicates.",
          "Same tools, different wear marks for @{left} and @{right}.",
        ],
        [
          "Same toolbox, different calluses: @{left} and @{right} grip it differently.",
          "Same coding style; @{left} and @{right} take different implementation routes.",
          "Matching coordinates, different pressure marks for @{left} and @{right}.",
        ],
        [
          "The mirror survived. The fingerprints did not match.",
          "Same habitat; two distinct sets of tracks and one very nervous debugger.",
        ],
      ),
      variants(
        [
          "the familiar style keeps its own cadence",
          "the overlap still leaves a specific signature",
        ],
        [
          "the shared tools pick up a different rhythm",
          "the matching axes still come from different implementation habits",
          "the familiar moves leave distinct wear",
        ],
        [
          "the mirror copied the posture, not the fingerprints",
          "the same playbook opened to another page",
        ],
      ),
      variants(
        [
          "the shared pattern resolves into another emphasis",
          "the similar reading keeps separate receipts",
        ],
        [
          "the same toolbox gets a different grip",
          "the overlap breaks at the implementation details",
          "the matched style carries another cadence",
        ],
        [
          "the reflection developed its own handwriting",
          "the duplicate key opened a different drawer",
        ],
      ),
    ),
    "chimera-clash": family(
      variants(
        [
          "@{hybrid} switches tools; @{specialist} keeps one blade sharp.",
          "Range meets focus: @{hybrid} changes tools while @{specialist} owns one.",
        ],
        [
          "@{hybrid} brought a full rack of code instincts; @{specialist} sharpened one into a point.",
          "@{hybrid} brings range; @{specialist} plants one unmistakable center of gravity.",
          "@{hybrid} changes tools without losing the thread; @{specialist} makes one tool sing.",
        ],
        [
          "@{hybrid} is several code creatures cooperating. @{specialist} is one creature with tenure.",
          "@{hybrid} formed a coalition. @{specialist} declared a single-party state.",
        ],
      ),
      variants(
        [
          "@{hybrid} brings range; @{specialist} brings focus. Both signatures hold.",
          "@{left} and @{right} keep hybrid range and specialist focus distinct.",
        ],
        [
          "@{hybrid} carries the full tool roll; @{specialist} keeps one blade surgically sharp.",
          "@{hybrid} owns breadth; @{specialist} leaves one unmistakable fingerprint.",
          "@{hybrid} covers the map while @{specialist} owns a very specific address.",
        ],
        [
          "@{hybrid} formed a style coalition; @{specialist} declared a single-party state.",
          "The chimera packed three instincts. The specialist packed one and a megaphone.",
        ],
      ),
      variants(
        ["the blended signals remain coherent", "the range stays broad rather than vague"],
        [
          "the tool changes still share a fingerprint",
          "the hybrid read earns every extra head",
          "the blend keeps a recognizable fingerprint across tools",
        ],
        ["the style coalition is somehow stable", "the chimera filed receipts for every head"],
      ),
      variants(
        ["the specialist signal stays concentrated", "the dominant signal group remains clear"],
        [
          "the center of gravity refuses to move",
          "the specialty keeps a laser-straight signature",
          "the specialist signature stays ruthlessly concentrated",
        ],
        ["the specialty has its own gravity well", "the signature arrived with a flag and anthem"],
      ),
    ),
    "hybrid-match": family(
      variants(
        [
          "@{left} and @{right} mix several code instincts in different proportions.",
          "Two code chimeras meet with different tools taking the lead.",
        ],
        [
          "@{left} and @{right} each brought several code instincts; the recipes refuse to match.",
          "This is hybrid versus hybrid, with different tools taking the lead.",
          "Both style maps have multiple centers; the mixtures stay distinguishable.",
        ],
        [
          "Two code chimeras entered. Their heads immediately started comparing toolchains.",
          "The scanner found two coalitions and absolutely no shared cabinet assignments.",
        ],
      ),
      variants(
        [
          "Both tool rolls are full; the packing order gives them away.",
          "Same range, different lead instrument for @{left} and @{right}.",
        ],
        [
          "@{left} mixes the palette one way; @{right} rebalances the lead instruments.",
          "Both brought the full tool roll, and neither packed it in the same order.",
          "The hybrid label matches; the lead tools do not.",
        ],
        [
          "@{left}'s style coalition challenged @{right}'s to a toolchain custody battle.",
          "@{left} and @{right}: matching chimeras, incompatible seating charts.",
        ],
      ),
      variants(
        ["the hybrid blend keeps a distinct balance", "the tool roll shares the workload cleanly"],
        [
          "the mixture has its own lead signal",
          "the tool roll stays broad without losing order",
          "the blend keeps a recognizable cadence",
        ],
        ["the coalition survives another deploy", "the chimera's heads reached quorum"],
      ),
      variants(
        [
          "the second blend weights different signals",
          "the shared identity resolves into another mix",
        ],
        [
          "the recipe changes without losing confidence",
          "a different signal group takes the microphone",
          "the breadth lands with another center of gravity",
        ],
        ["the second coalition brought bylaws", "the other chimera elected a different head"],
      ),
    ),
    "coverage-gap": family(
      variants(
        [
          "@{broad} opens the map; @{narrow} owns one clear street.",
          "@{broad} brought several files; @{narrow} brought one clear window.",
        ],
        [
          "@{broad} opens the map; @{narrow} keeps one sharp window.",
          "@{broad} spans more files; @{narrow} keeps the claim tight.",
          "@{broad} offers range; @{narrow} delivers one sharp keyhole read.",
        ],
        [
          "@{broad} brought the archive box. @{narrow} brought one excellent exhibit.",
          "@{broad} brought the panorama. @{narrow} aimed one ruthless peephole.",
        ],
      ),
      variants(
        [
          "@{broad} has the wide shot; @{narrow} has the close-up.",
          "More files for @{broad}; one sharp frame for @{narrow}.",
        ],
        [
          "@{broad} has the binder; @{narrow} has the highlighted page.",
          "More files widen @{broad}'s read without turning @{narrow}'s evidence into zero.",
          "The panorama belongs to @{broad}; the close-up belongs to @{narrow}.",
        ],
        [
          "@{broad} submitted the box set. @{narrow} submitted the scene that matters.",
          "The evidence table has four legs under @{broad} and one very sturdy leg under @{narrow}.",
        ],
      ),
      variants(
        [
          "the broader sample supports more of the style map",
          "the repository spread raises confidence explicitly",
        ],
        [
          "the map covers more terrain",
          "the multi-file view earns its wider claim",
          "the wider map has room to triangulate",
        ],
        ["the evidence brought backup evidence", "the sample set has panoramic mode"],
      ),
      variants(
        [
          "the narrower claim stays inside its evidence",
          "the limited view lowers confidence without inventing a penalty",
        ],
        [
          "the keyhole view still catches a real signal",
          "the keyhole knows its jurisdiction",
          "the close-up stays sharp and appropriately modest",
        ],
        [
          "the single exhibit refuses to overtestify",
          "the keyhole delivered a surprisingly clean fingerprint",
        ],
      ),
    ),
    "limited-evidence": family(
      variants(
        [
          "One file each entered the ring; neither gets to invent a codebase.",
          "Small source window, real code tells, no imaginary architecture.",
        ],
        [
          "The window is small; the read stays specific and honest.",
          "Limited evidence gets a precise claim here, not a made-up extreme.",
          "The close-up refuses to cosplay as a panorama.",
        ],
        [
          "One flashlight beam showed up and stayed in its lane.",
          "Tiny evidence window, zero imaginary architecture astronauts hiding off-screen.",
        ],
      ),
      variants(
        [
          "One file each. Real signal, short leash.",
          "The keyhole saw code, not the whole building.",
        ],
        [
          "Small window, sharp jurisdiction: the claim knows exactly where to stop.",
          "The narrow frame keeps every adjective honest.",
          "No panorama from a close-up; the visible signal still lands.",
        ],
        [
          "The flashlight found a signal and declined to invent the rest of the building.",
          "One bounded sample walked in and every unsupported adjective left the room.",
        ],
      ),
      variants(
        ["the reading stays proportionate to the sample", "the limitation is part of the receipt"],
        [
          "the narrow window keeps the claim on a short leash",
          "the visible signal stays specific and stops",
          "the confidence label does actual work",
        ],
        [
          "the sample refused to cosplay as a codebase",
          "the receipt brought its own warning label",
        ],
      ),
      variants(
        [
          "the close-up stops exactly where the file ends",
          "the confidence remains honest about what is missing",
        ],
        [
          "the read lands without borrowing unseen files",
          "the close-up keeps the story disciplined",
          "the limitation blocks every imaginary flourish",
        ],
        [
          "the unseen code was denied speaking privileges",
          "the confidence meter tackled the exaggeration at the door",
        ],
      ),
    ),
  });

export function templateVariantIndex(seed: string, length: number): number {
  let hash = 0x811c9dc5;
  for (const character of seed) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % Math.max(1, length);
}

export const selectTemplateVariant = (values: readonly string[], seed: string): string =>
  values[templateVariantIndex(seed, values.length)] ?? values[0] ?? "";
