# Open-Source Book Covers — Lovart Prompts

_Self-contained Lovart / Nanobanana-2 prompts for every book in `openbook-ingest-tracker.md`. Each prompt is a single block ready to paste — the specimen-plate / armoury preamble is encoded inline so each one is portable on its own._

Last updated: 2026-04-30
Maintainer: matt + Claude agent runs

---

## 1. Style preamble (encoded into every prompt below)

Every prompt opens with this preamble verbatim. Listed once here for documentation; do **not** paste this section separately into Lovart — it's already baked into each per-book prompt.

> Vintage 19th-century natural-history specimen plate crossed with a martial-armoury field manual. Aged cream-parchment background with faint age-spots and visible paper grain. Decorative four-pointed star ornaments in each corner of the page. Small inset medallions at the four corners showing kata-training motifs: top-left a pair of crossed brass training swords, top-right a small brass anvil, bottom-left an oak-leaf laurel, bottom-right a heraldic shield. Clean keyline frame inset just inside the page edges. Restrained desaturated palette: faded teal, antique copper, dusty brown, off-white, plus the language's one signature accent. Strictly symmetrical composition. Portrait 2:3 aspect ratio (1024 × 1536). NO text or typography. Quiet, antique field-manual mood.

### Signature accent by language

| Language    | Accent ink   | Hex       |
| ----------- | ------------ | --------- |
| JavaScript  | Mustard      | `#D9A74A` |
| Python      | Seafoam      | `#3F8A7C` |
| Rust        | Oxblood      | `#9C3B3A` |
| Solidity    | Aubergine    | `#6B4F7A` |
| Bitcoin     | Burnt orange | `#D8861A` |
| Ethereum    | Dusty blue   | `#4F66B8` |
| Lightning   | Copper-amber | `#A8702E` |
| Git / shell | Russet       | `#8C5A3A` |
| Ruby        | Ruby red     | `#CC342D` |
| Lua         | Moon blue    | `#3050A0` |
| Dart        | Clear blue   | `#0175C2` |
| Haskell     | Plum violet  | `#5D4F85` |
| Scala       | Scala red    | `#DC322F` |
| SQL         | Indigo       | `#336791` |
| Elixir      | Wisteria     | `#6E4A7E` |
| Zig         | Amber        | `#F7A41D` |
| Move        | Slate blue   | `#4E5D7E` |
| Cairo       | StarkNet     | `#FA9056` |
| Sway        | Fuel green   | `#00C078` |

The accent is the **only** saturated colour on the page — used at the central specimen and in the corner-medallion detail lines.

---

## 2. Wave 1

### 2.1 Eloquent JavaScript (4th ed.) — Marijn Haverbeke

_Subject: JavaScript as a craft — values, functions, higher-order programming, the event loop._

> Vintage 19th-century natural-history specimen plate crossed with a martial-armoury field manual. Aged cream-parchment background with faint age-spots and visible paper grain. Decorative four-pointed star ornaments in each corner of the page. Small inset medallions at the four corners showing kata-training motifs: top-left a pair of crossed brass training swords, top-right a small brass anvil, bottom-left an oak-leaf laurel, bottom-right a heraldic shield. Clean keyline frame inset just inside the page edges. Restrained desaturated palette: faded teal, antique copper, dusty brown, off-white, plus a single signature accent of mustard (`#D9A74A`) used sparingly as the highlight ink. Strictly symmetrical composition. Portrait 2:3 aspect ratio (1024 × 1536). NO text or typography. Quiet, antique field-manual mood.
>
> Subject: a symbolic specimen-rendering of *Eloquent JavaScript — values, functions, higher-order programming, and the event loop* — expressed through skeletal / structural metaphor, not a literal coding scene.
>
> Central specimen, dead-centre on the page, symmetrical along the vertical axis: a Victorian phonograph-cylinder mechanism rendered as an exploded anatomical cross-section. The brass cylinder sits upright at the page's centre, its outer casing peeled away to reveal the speaking mechanism — a coiled mainspring at the base, an escapement wheel mid-frame, and a pair of mirror-imaged tone arms tracing helical grooves on the cylinder's surface. The grooves themselves are drawn as nested function-call rings — a coiled flow that loops back on itself in a visual rhyme with closure. Above the cylinder, two symmetrical brass cranks fan outward like compass needles, suggesting the ingestion + emission of a higher-order function. Below the mechanism, an event-loop wheel sits as a horizontal clock face, twelve evenly-spaced ticks around its rim, each tick a tiny callback-shaped flag. Faint radial lines emanate from the escapement wheel in a sparse halo, marked in the mustard accent (`#D9A74A`) — the only saturated colour on the page, used only here and in the four corner medallions' detail lines. Pinned-specimen style throughout: hairline hatching for shadows, restrained two-ink registration, no glow effects.
>
> **Exclude:** any text, letterforms, typography, labels, numbers, the literal `JS` letterform, photorealism, 3D rendering, smooth digital gradients, glossy surfaces, AI-smooth geometry, pure-white backgrounds.

---

### 2.2 Crafting Interpreters (with JavaScript) — Robert Nystrom

_Subject: tokenizing, parsing, tree-walking and bytecode interpretation — building a language end-to-end (Lox port to JavaScript)._

> Vintage 19th-century natural-history specimen plate crossed with a martial-armoury field manual. Aged cream-parchment background with faint age-spots and visible paper grain. Decorative four-pointed star ornaments in each corner of the page. Small inset medallions at the four corners showing kata-training motifs: top-left a pair of crossed brass training swords, top-right a small brass anvil, bottom-left an oak-leaf laurel, bottom-right a heraldic shield. Clean keyline frame inset just inside the page edges. Restrained desaturated palette: faded teal, antique copper, dusty brown, off-white, plus a single signature accent of mustard (`#D9A74A`) used sparingly as the highlight ink. Strictly symmetrical composition. Portrait 2:3 aspect ratio (1024 × 1536). NO text or typography. Quiet, antique field-manual mood.
>
> Subject: a symbolic specimen-rendering of *Crafting Interpreters — lexing, parsing, tree-walking, and bytecode compilation* — expressed through skeletal / structural metaphor, not a literal coding scene.
>
> Central specimen, dead-centre on the page, symmetrical along the vertical axis: an exploded cross-section of a Babbage-style mechanical pipeline, rendered as a four-tier vertical apparatus with bilateral symmetry. TIER ONE (top) — a typesetter's case of source-glyphs (abstract scratches, never literal text) feeding into a toothed comb that tokenizes the stream. TIER TWO — twin armatures of brass rods rise upward from the comb in a perfectly symmetrical V, building a parse-tree where each node is a small octagonal joint, branches mirroring left to right. TIER THREE — at the page's exact centre sits an ornate clockwork brain: a pair of mirror-imaged interpretive cogs, one labelled visually with leaf-veins (the tree-walker), one with a coil of bytecode-shape ribbon (the bytecode VM). TIER FOUR (bottom) — a single output spout in the lower middle releases a faint plume of executed instructions, dissolving into the cream parchment. Faint radial lines emanate from the centre cogs in a sparse halo, marked in the mustard accent (`#D9A74A`) — the only saturated colour on the page, used only here and in the four corner medallions' detail lines. Pinned-specimen style throughout: hairline hatching for shadows, restrained two-ink registration, no glow effects.
>
> **Exclude:** any text, letterforms, typography, labels, numbers, photorealism, 3D rendering, smooth digital gradients, glossy surfaces, AI-smooth geometry, pure-white backgrounds.

---

### 2.3 Programming Bitcoin (with Python) — Jimmy Song

_Subject: building Bitcoin from scratch in Python — elliptic-curve cryptography, transactions, and the consensus loop._

> Vintage 19th-century natural-history specimen plate crossed with a martial-armoury field manual. Aged cream-parchment background with faint age-spots and visible paper grain. Decorative four-pointed star ornaments in each corner of the page. Small inset medallions at the four corners showing kata-training motifs: top-left a pair of crossed brass training swords, top-right a small brass anvil, bottom-left an oak-leaf laurel, bottom-right a heraldic shield. Clean keyline frame inset just inside the page edges. Restrained desaturated palette: faded teal, antique copper, dusty brown, off-white, plus a single signature accent of seafoam (`#3F8A7C`) used sparingly as the highlight ink. Strictly symmetrical composition. Portrait 2:3 aspect ratio (1024 × 1536). NO text or typography. Quiet, antique field-manual mood.
>
> Subject: a symbolic specimen-rendering of *Programming Bitcoin — building the protocol from scratch in Python: elliptic-curve cryptography, transactions, and consensus* — expressed through skeletal / structural metaphor, not a literal coding scene.
>
> Central specimen, dead-centre on the page, symmetrical along the vertical axis: an articulated brass astrolabe rendered as an exploded anatomical cross-section. The outermost ring is etched with the curve of secp256k1, drawn as a delicate ouroboros-like elliptic figure-eight in dusty-brown linework, flanked by a perfectly mirrored pair of compass arms. Inside the ring, a transaction-shaped scroll unfurls dead-centre — input quills on the left, output quills on the right, each quill ending in a small faceted UTXO bead. At the astrolabe's hub, an escapement wheel doubles as a mining clock — twelve symmetrical teeth ringing the rim, each one a tiny block locket. From either side of the centre hub, equal-length serpentine vertebrae representing the Python language coil downward and outward like Aesculapian rods, dissolving into the cream parchment before reaching the lower third of the page. Faint radial lines emanate from the hub in a sparse halo, marked in the seafoam accent (`#3F8A7C`) — the only saturated colour on the page, used only here and in the four corner medallions' detail lines. Pinned-specimen style throughout: hairline hatching for shadows, restrained two-ink registration, no glow effects.
>
> **Exclude:** any text, letterforms, typography, labels, numbers, the literal Bitcoin "₿" symbol, currency-style coin renders, photorealism, 3D rendering, smooth digital gradients, glossy surfaces, AI-smooth geometry, pure-white backgrounds.

---

### 2.4 Pro Git — Scott Chacon, Ben Straub

_Subject: distributed version control — commits, branches, merges, the directed acyclic graph._

> Vintage 19th-century natural-history specimen plate crossed with a martial-armoury field manual. Aged cream-parchment background with faint age-spots and visible paper grain. Decorative four-pointed star ornaments in each corner of the page. Small inset medallions at the four corners showing kata-training motifs: top-left a pair of crossed brass training swords, top-right a small brass anvil, bottom-left an oak-leaf laurel, bottom-right a heraldic shield. Clean keyline frame inset just inside the page edges. Restrained desaturated palette: faded teal, antique copper, dusty brown, off-white, plus a single signature accent of russet (`#8C5A3A`) used sparingly as the highlight ink. Strictly symmetrical composition. Portrait 2:3 aspect ratio (1024 × 1536). NO text or typography. Quiet, antique field-manual mood.
>
> Subject: a symbolic specimen-rendering of *Pro Git — commits, branches, merges, and the directed acyclic graph* — expressed through skeletal / structural metaphor, not a literal coding scene.
>
> Central specimen, dead-centre on the page, symmetrical along the vertical axis: a botanical-plate rendering of an espaliered fruit tree pinned to a herbarium board, its trunk forming the page's vertical axis. Each branching node is a small faceted commit-bead; branches fan outward in perfect bilateral symmetry, two principal limbs mid-trunk depicting a feature-branch / mainline split that re-converges at a higher node — a merge — drawn as a delicate engrafted joint with mirror-image suturing. Below the trunk's base, the root system spreads as a directed-acyclic-graph network of fine fibre-roots, each tip terminating in a tiny anchor-shaped commit-stub. Two crossed bookbinder's awls flank the trunk at its midpoint as armoury motifs, suggesting the act of stitching history. Faint radial lines emanate from the merge-joint in a sparse halo, marked in the russet accent (`#8C5A3A`) — the only saturated colour on the page, used only here and in the four corner medallions' detail lines. Pinned-specimen style throughout: hairline hatching for shadows, restrained two-ink registration, no glow effects.
>
> **Exclude:** any text, letterforms, typography, labels, numbers, the literal Git logo, photorealism, 3D rendering, smooth digital gradients, glossy surfaces, AI-smooth geometry, pure-white backgrounds.

---

## 3. Wave 2

### 3.1 Mastering Bitcoin (with Python) — Andreas Antonopoulos

_Subject: digital scarcity, proof-of-work, trustless settlement._

> Vintage 19th-century natural-history specimen plate crossed with a martial-armoury field manual. Aged cream-parchment background with faint age-spots and visible paper grain. Decorative four-pointed star ornaments in each corner of the page. Small inset medallions at the four corners showing kata-training motifs: top-left a pair of crossed brass training swords, top-right a small brass anvil, bottom-left an oak-leaf laurel, bottom-right a heraldic shield. Clean keyline frame inset just inside the page edges. Restrained desaturated palette: faded teal, antique copper, dusty brown, off-white, plus a single signature accent of burnt orange (`#D8861A`) used sparingly as the highlight ink. Strictly symmetrical composition. Portrait 2:3 aspect ratio (1024 × 1536). NO text or typography. Quiet, antique field-manual mood.
>
> Subject: a symbolic specimen-rendering of *Bitcoin — digital scarcity, proof-of-work, and trustless settlement* — expressed through skeletal / structural metaphor, not a literal coding scene.
>
> Central specimen, dead-centre on the page, symmetrical along the vertical axis: a Victorian-era vault door rendered as an exploded anatomical cross-section. The mechanism is laid open like a clockwork orrery — tumblers, gears, pawls, and an ornate escapement wheel arranged in mirror-image pairs flanking the vertical axis, drawn in dusty-brown linework with faded-teal shading. The combination dial in the upper third is replaced by a Merkle hash-tree, branches radiating outward in perfect bilateral symmetry, each tip a tiny faceted node-bead in antique copper. From either side of the vault door, equal-length chains of linked locker-shaped blocks fan downward and outward — left and right matching exactly — each link hatched with subtle UTXO-shape marks, the chains dissolving into the cream parchment before they reach the lower third of the page. Faint radial lines emanate from the escapement wheel in a sparse halo, marked in the burnt-orange accent (`#D8861A`) — the only saturated colour on the page, used only here and in the four corner medallions' detail lines. Pinned-specimen style throughout: hairline hatching for shadows, restrained two-ink registration, no glow effects.
>
> **Exclude:** any text, letterforms, typography, labels, numbers, the literal Bitcoin "₿" symbol, currency-style coin renders, photorealism, 3D rendering, smooth digital gradients, glossy surfaces, AI-smooth geometry, pure-white backgrounds.

---

### 3.2 Mastering Ethereum (with Solidity) — Andreas Antonopoulos, Gavin Wood

_Subject: the world computer — smart contracts, the EVM, global state._

> Vintage 19th-century natural-history specimen plate crossed with a martial-armoury field manual. Aged cream-parchment background with faint age-spots and visible paper grain. Decorative four-pointed star ornaments in each corner of the page. Small inset medallions at the four corners showing kata-training motifs: top-left a pair of crossed brass training swords, top-right a small brass anvil, bottom-left an oak-leaf laurel, bottom-right a heraldic shield. Clean keyline frame inset just inside the page edges. Restrained desaturated palette: faded teal, antique copper, dusty brown, off-white, plus a single signature accent of dusty Ethereum blue (`#4F66B8`) used sparingly as the highlight ink. Strictly symmetrical composition. Portrait 2:3 aspect ratio (1024 × 1536). NO text or typography. Quiet, antique field-manual mood.
>
> Subject: a symbolic specimen-rendering of *Ethereum — the world computer, smart contracts, the EVM, and global state* — expressed through skeletal / structural metaphor, not a literal coding scene.
>
> Central specimen, dead-centre on the page, symmetrical along the vertical axis: the Ethereum stacked-tetrahedra diamond rendered as an exploded anatomical cross-section, its internal mechanism laid open like a clockwork orrery. The UPPER tetrahedron is the smart-contract surface — its faces drawn as engraved bronze plates etched with abstract bytecode-shape glyphs (chevrons, circles, slashes — never literal text), framed inside by symmetrical pairs of brass gears representing the EVM's stack and opcodes. The LOWER tetrahedron is the world state — its volume filled with a Merkle-Patricia trie that descends in perfect bilateral symmetry, branches radiating downward, each leaf a tiny faceted account-bead in antique copper. Where the two tetrahedra meet at the diamond's equator, an ornate brass escapement wheel sits dead-centre, its teeth symmetrical, representing block production and consensus. Flanking the diamond on either side, equal-length tributaries of transaction-shaped capsules drift inward toward the equator — left and right mirroring exactly — each capsule hatched with subtle gas-meter dial marks. Faint radial lines emanate from the escapement wheel in a sparse halo, marked in the dusty Ethereum-blue accent (`#4F66B8`) — the only saturated colour on the page, used only here and in the four corner medallions' detail lines. Pinned-specimen style throughout: hairline hatching for shadows, restrained two-ink registration, no glow effects.
>
> **Exclude:** any text, letterforms, typography, labels, numbers, the literal Ξ symbol or Ethereum-logo lockup, currency-style coin renders, photorealism, 3D rendering, smooth digital gradients, glossy surfaces, AI-smooth geometry, pure-white backgrounds.

---

### 3.3 Mastering Lightning Network (with Python) — Antonopoulos, Osuntokun, Pickhardt

_Subject: payment channels, HTLCs, onion-routed instant settlement on top of Bitcoin._

> Vintage 19th-century natural-history specimen plate crossed with a martial-armoury field manual. Aged cream-parchment background with faint age-spots and visible paper grain. Decorative four-pointed star ornaments in each corner of the page. Small inset medallions at the four corners showing kata-training motifs: top-left a pair of crossed brass training swords, top-right a small brass anvil, bottom-left an oak-leaf laurel, bottom-right a heraldic shield. Clean keyline frame inset just inside the page edges. Restrained desaturated palette: faded teal, antique copper, dusty brown, off-white, plus a single signature accent of copper-amber (`#A8702E`) used sparingly as the highlight ink. Strictly symmetrical composition. Portrait 2:3 aspect ratio (1024 × 1536). NO text or typography. Quiet, antique field-manual mood.
>
> Subject: a symbolic specimen-rendering of *the Lightning Network — payment channels, HTLCs, and onion-routed instant settlement on top of Bitcoin* — expressed through skeletal / structural metaphor, not a literal coding scene.
>
> Central specimen, dead-centre on the page, symmetrical along the vertical axis: a Victorian-era electrostatic apparatus rendered as an exploded anatomical cross-section. At the apex sits an ornate brass spark-gap, its two electrodes mirrored and pointing inward, between them a pinned specimen of forked lightning frozen mid-arc and rendered as a delicate forking veinwork. Below the spark-gap, two glass Leyden-jar capacitors flank the page's vertical axis in perfect mirror-image — these are the payment channels, each jar's inner foil etched with a hatched balance-meter scale. From the jars' bases, equal-length brass conduits descend and weave inward, crossing at midpage in an ornate four-stage onion-route lattice (each ring of the onion drawn as a concentric oval with a small HTLC-shaped clasp at its rim). At the page's lower-third boundary, the conduits dissolve into the cream parchment as a fine gradient of dotted relay-hops. Faint radial lines emanate from the spark-gap in a sparse halo, marked in the copper-amber accent (`#A8702E`) — the only saturated colour on the page, used only here and in the four corner medallions' detail lines. Pinned-specimen style throughout: hairline hatching for shadows, restrained two-ink registration, no glow effects.
>
> **Exclude:** any text, letterforms, typography, labels, numbers, the literal lightning-bolt logo, photorealism, 3D rendering, smooth digital gradients, glossy surfaces, AI-smooth geometry, pure-white backgrounds.

---

### 3.4 The Modern JavaScript Tutorial — Ilya Kantor (javascript.info)

_Subject: a comprehensive JavaScript reference — the language, objects, browser APIs._

> Vintage 19th-century natural-history specimen plate crossed with a martial-armoury field manual. Aged cream-parchment background with faint age-spots and visible paper grain. Decorative four-pointed star ornaments in each corner of the page. Small inset medallions at the four corners showing kata-training motifs: top-left a pair of crossed brass training swords, top-right a small brass anvil, bottom-left an oak-leaf laurel, bottom-right a heraldic shield. Clean keyline frame inset just inside the page edges. Restrained desaturated palette: faded teal, antique copper, dusty brown, off-white, plus a single signature accent of mustard (`#D9A74A`) used sparingly as the highlight ink. Strictly symmetrical composition. Portrait 2:3 aspect ratio (1024 × 1536). NO text or typography. Quiet, antique field-manual mood.
>
> Subject: a symbolic specimen-rendering of *the Modern JavaScript Tutorial — a comprehensive reference to the language, its objects, and the browser surface* — expressed through skeletal / structural metaphor, not a literal coding scene.
>
> Central specimen, dead-centre on the page, symmetrical along the vertical axis: a Victorian-era apothecary cabinet rendered as an exploded cross-section, its many tiny specimen drawers facing the viewer in strictly symmetrical rows. The cabinet has FIVE rows of TEN drawers each (mirrored across the vertical axis), every drawer-front etched with a different abstract feature-glyph: a coiled ribbon for closures, a divided cell for objects, a forked arrow for control flow, an opened book-clasp for prototypes, etc. At the cabinet's vertical centre, two drawers are pulled half-open — left and right matching exactly — revealing their interiors: one holds a tiny pinned specimen of an event-loop wheel, the other a delicate DOM-tree skeleton. Above the cabinet sits a small armoury crest; below it, two crossed quill-pens form an X. Faint radial lines emanate from the central pulled drawers in a sparse halo, marked in the mustard accent (`#D9A74A`) — the only saturated colour on the page, used only here and in the four corner medallions' detail lines. Pinned-specimen style throughout: hairline hatching for shadows, restrained two-ink registration, no glow effects.
>
> **Exclude:** any text, letterforms, typography, labels, numbers, photorealism, 3D rendering, smooth digital gradients, glossy surfaces, AI-smooth geometry, pure-white backgrounds.

---

### 3.5 You Don't Know JS Yet — Kyle Simpson

_Subject: deep dives into the parts of JavaScript developers think they know — scope, closures, this, async._

> Vintage 19th-century natural-history specimen plate crossed with a martial-armoury field manual. Aged cream-parchment background with faint age-spots and visible paper grain. Decorative four-pointed star ornaments in each corner of the page. Small inset medallions at the four corners showing kata-training motifs: top-left a pair of crossed brass training swords, top-right a small brass anvil, bottom-left an oak-leaf laurel, bottom-right a heraldic shield. Clean keyline frame inset just inside the page edges. Restrained desaturated palette: faded teal, antique copper, dusty brown, off-white, plus a single signature accent of mustard (`#D9A74A`) used sparingly as the highlight ink. Strictly symmetrical composition. Portrait 2:3 aspect ratio (1024 × 1536). NO text or typography. Quiet, antique field-manual mood.
>
> Subject: a symbolic specimen-rendering of *You Don't Know JS Yet — deep dives into scope, closures, `this`, prototypes, and async semantics* — expressed through skeletal / structural metaphor, not a literal coding scene.
>
> Central specimen, dead-centre on the page, symmetrical along the vertical axis: a glass apothecary's dissection-jar pinned to a board, its contents a coiled briar of nested scope-chains drawn as an exploded specimen of a thorny vine — six concentric loops mirrored across the vertical axis, each loop a tighter scope, the innermost two coils almost meeting at the page's centre to form a closure-knot. Threaded through the briar from top to bottom is a slender brass rod (the call stack), tipped at the apex with a small faceted `this`-binding orb that splits into two reflected variants — one bound, one floating — symmetrical about the rod's vertical line. At the jar's base, four short tendrils fan outward in perfect mirror image: two ending in callback-shaped flags, two in promise-rings. Faint radial lines emanate from the closure-knot in a sparse halo, marked in the mustard accent (`#D9A74A`) — the only saturated colour on the page, used only here and in the four corner medallions' detail lines. Pinned-specimen style throughout: hairline hatching for shadows, restrained two-ink registration, no glow effects.
>
> **Exclude:** any text, letterforms, typography, labels, numbers, photorealism, 3D rendering, smooth digital gradients, glossy surfaces, AI-smooth geometry, pure-white backgrounds.

---

### 3.6 Rust by Example — The Rust Project

_Subject: Rust's feature surface — ownership, traits, lifetimes, concurrency — taught through worked examples._

> Vintage 19th-century natural-history specimen plate crossed with a martial-armoury field manual. Aged cream-parchment background with faint age-spots and visible paper grain. Decorative four-pointed star ornaments in each corner of the page. Small inset medallions at the four corners showing kata-training motifs: top-left a pair of crossed brass training swords, top-right a small brass anvil, bottom-left an oak-leaf laurel, bottom-right a heraldic shield. Clean keyline frame inset just inside the page edges. Restrained desaturated palette: faded teal, antique copper, dusty brown, off-white, plus a single signature accent of oxblood (`#9C3B3A`) used sparingly as the highlight ink. Strictly symmetrical composition. Portrait 2:3 aspect ratio (1024 × 1536). NO text or typography. Quiet, antique field-manual mood.
>
> Subject: a symbolic specimen-rendering of *Rust by Example — ownership, traits, lifetimes, and concurrency taught via worked examples* — expressed through skeletal / structural metaphor, not a literal coding scene.
>
> Central specimen, dead-centre on the page, symmetrical along the vertical axis: an armourer's wall-mounted training rack rendered as an exploded anatomical cross-section — a regimented display of practice swords, each pinned in mirror-image pairs along the vertical axis. The rack has FOUR tiers, each tier holding two crossed swords (left + right matching exactly). The blades are etched with hairline glyphs that read as abstract feature-marks: tier one (top) — ownership chevrons; tier two — borrowing arcs; tier three — lifetime-tick notches; tier four (bottom) — concurrency-fork forks. At the rack's vertical centre, an ornate brass crest holds a single specimen-quality ceremonial sabre upright, its hilt ringed by a small wreath of oak leaves. Two crossed iron locks flank the crest at the page's exact centre — closed on the left, open on the right — suggesting compile-time guarantees being earned through practice. Faint radial lines emanate from the central crest in a sparse halo, marked in the oxblood accent (`#9C3B3A`) — the only saturated colour on the page, used only here and in the four corner medallions' detail lines. Pinned-specimen style throughout: hairline hatching for shadows, restrained two-ink registration, no glow effects.
>
> **Exclude:** any text, letterforms, typography, labels, numbers, the literal Rust crab logo, photorealism, 3D rendering, smooth digital gradients, glossy surfaces, AI-smooth geometry, pure-white backgrounds.

---

## 4. Wave 3

### 4.1 The Async Book (Rust) — The Rust Project

_Subject: futures, executors, and the art of cooperative concurrency in Rust._

> Vintage 19th-century natural-history specimen plate crossed with a martial-armoury field manual. Aged cream-parchment background with faint age-spots and visible paper grain. Decorative four-pointed star ornaments in each corner of the page. Small inset medallions at the four corners showing kata-training motifs: top-left a pair of crossed brass training swords, top-right a small brass anvil, bottom-left an oak-leaf laurel, bottom-right a heraldic shield. Clean keyline frame inset just inside the page edges. Restrained desaturated palette: faded teal, antique copper, dusty brown, off-white, plus a single signature accent of oxblood (`#9C3B3A`) used sparingly as the highlight ink. Strictly symmetrical composition. Portrait 2:3 aspect ratio (1024 × 1536). NO text or typography. Quiet, antique field-manual mood.
>
> Subject: a symbolic specimen-rendering of *the Async Book — futures, executors, polling, and cooperative concurrency in Rust* — expressed through skeletal / structural metaphor, not a literal coding scene.
>
> Central specimen, dead-centre on the page, symmetrical along the vertical axis: an exploded cross-section of a Victorian-era pneumatic-postal pinwheel station, four equal-length arms radiating outward from a central brass hub in perfect cruciform symmetry. Each arm is a future-in-flight: a slender pneumatic tube whose interior shows a small pinned capsule mid-poll, capsule hatching subtly different on each arm to suggest different states (pending / ready / parked / waking). At the hub sits a single ornate executor-cog with sixteen symmetrical teeth, each tooth corresponding to a tick of cooperative scheduling. Above the hub, a small brass waker-bell hangs centred; below, two crossed lever-handles cross the vertical axis at exactly 45° suggesting `await` points. Around the entire pinwheel, a thin geared ring rotates clockwise — drawn as a static specimen but with directional arrow-hatches at its outer edge mirrored on opposing sides. Faint radial lines emanate from the central executor in a sparse halo, marked in the oxblood accent (`#9C3B3A`) — the only saturated colour on the page, used only here and in the four corner medallions' detail lines. Pinned-specimen style throughout: hairline hatching for shadows, restrained two-ink registration, no glow effects.
>
> **Exclude:** any text, letterforms, typography, labels, numbers, photorealism, 3D rendering, smooth digital gradients, glossy surfaces, AI-smooth geometry, pure-white backgrounds.

---

### 4.2 The Rustonomicon — The Rust Project

_Subject: the dark arts — `unsafe`, raw pointers, undefined behaviour, the rules behind Rust's safety._

> Vintage 19th-century natural-history specimen plate crossed with a martial-armoury field manual. Aged cream-parchment background with faint age-spots and visible paper grain. Decorative four-pointed star ornaments in each corner of the page. Small inset medallions at the four corners showing kata-training motifs: top-left a pair of crossed brass training swords, top-right a small brass anvil, bottom-left an oak-leaf laurel, bottom-right a heraldic shield. Clean keyline frame inset just inside the page edges. Restrained desaturated palette: faded teal, antique copper, dusty brown, off-white, plus a single signature accent of oxblood (`#9C3B3A`) used sparingly as the highlight ink. Strictly symmetrical composition. Portrait 2:3 aspect ratio (1024 × 1536). NO text or typography. Quiet, antique field-manual mood.
>
> Subject: a symbolic specimen-rendering of *the Rustonomicon — `unsafe`, raw pointers, lifetimes-by-hand, and the rules behind Rust's safety guarantees* — expressed through skeletal / structural metaphor, not a literal coding scene.
>
> Central specimen, dead-centre on the page, symmetrical along the vertical axis: a leather-bound apothecary grimoire rendered as an exploded cross-section, opened flat to reveal a pinned specimen page. On the LEFT half — the safe side — an ornate brass lockbox sits intact, its keyhole framed by laurel hatching. On the RIGHT half — the unsafe side — the same lockbox is shown with its outer panel ceremonially removed, exposing a delicate skeletal interior of raw-pointer rods radiating outward like a beetle's articulated legs, each rod tipped with a tiny anchor-shaped address-bead. The two halves are bound together at the page's central spine by a brass clasp, broken open and hinged outward in perfect mirror image. Above the spine, a small skull-and-laurel crest sits upright as a sober memento-mori for misuse. Two crossed iron rods flank the spine at the page's exact centre — one labelled visually with a closed clasp (compile-time), one with an open clasp (runtime UB). Faint radial lines emanate from the broken-clasp halo in a sparse pattern, marked in the oxblood accent (`#9C3B3A`) — the only saturated colour on the page, used only here and in the four corner medallions' detail lines. Pinned-specimen style throughout: hairline hatching for shadows, restrained two-ink registration, no glow effects.
>
> **Exclude:** any text, letterforms, typography, labels, numbers, photorealism, 3D rendering, smooth digital gradients, glossy surfaces, AI-smooth geometry, pure-white backgrounds.

---

### 4.3 Composing Programs (with Python) — John DeNero

_Subject: SICP-flavoured Python — abstraction, higher-order functions, interpreters, declarative programming._

> Vintage 19th-century natural-history specimen plate crossed with a martial-armoury field manual. Aged cream-parchment background with faint age-spots and visible paper grain. Decorative four-pointed star ornaments in each corner of the page. Small inset medallions at the four corners showing kata-training motifs: top-left a pair of crossed brass training swords, top-right a small brass anvil, bottom-left an oak-leaf laurel, bottom-right a heraldic shield. Clean keyline frame inset just inside the page edges. Restrained desaturated palette: faded teal, antique copper, dusty brown, off-white, plus a single signature accent of seafoam (`#3F8A7C`) used sparingly as the highlight ink. Strictly symmetrical composition. Portrait 2:3 aspect ratio (1024 × 1536). NO text or typography. Quiet, antique field-manual mood.
>
> Subject: a symbolic specimen-rendering of *Composing Programs — abstraction, higher-order functions, interpreters, and the layered architecture of programs* — expressed through skeletal / structural metaphor, not a literal coding scene.
>
> Central specimen, dead-centre on the page, symmetrical along the vertical axis: a stack of concentric Russian nesting-doll shells rendered as an exploded anatomical cross-section, each shell flanked by a mirror-image counterpart in perfect bilateral symmetry. There are FIVE shells stacked top to bottom, the largest at the apex and the smallest at the base — a visual rhyme with abstraction-by-procedure (top), data abstraction (next), interpretation (middle), evaluation (next), and primitive ops (bottom). Each shell is opened along a hinge and shown with its inner detail laid bare: shell three (the centre / middle layer) reveals a tiny pinned eval-apply orrery — two interlocking gears, mirrored — hovering inside. Threading through every shell from apex to base is a single brass spinal column representing function-composition; from each vertebra two delicate arms branch outward symmetrically, ending in tiny higher-order-function flags. Faint radial lines emanate from the centre eval-apply orrery in a sparse halo, marked in the seafoam accent (`#3F8A7C`) — the only saturated colour on the page, used only here and in the four corner medallions' detail lines. Pinned-specimen style throughout: hairline hatching for shadows, restrained two-ink registration, no glow effects.
>
> **Exclude:** any text, letterforms, typography, labels, numbers, photorealism, 3D rendering, smooth digital gradients, glossy surfaces, AI-smooth geometry, pure-white backgrounds.

---

### 4.4 Open Data Structures (with Python) — Pat Morin

_Subject: arrays, linked lists, trees, hash tables — the canonical data-structure curriculum._

> Vintage 19th-century natural-history specimen plate crossed with a martial-armoury field manual. Aged cream-parchment background with faint age-spots and visible paper grain. Decorative four-pointed star ornaments in each corner of the page. Small inset medallions at the four corners showing kata-training motifs: top-left a pair of crossed brass training swords, top-right a small brass anvil, bottom-left an oak-leaf laurel, bottom-right a heraldic shield. Clean keyline frame inset just inside the page edges. Restrained desaturated palette: faded teal, antique copper, dusty brown, off-white, plus a single signature accent of seafoam (`#3F8A7C`) used sparingly as the highlight ink. Strictly symmetrical composition. Portrait 2:3 aspect ratio (1024 × 1536). NO text or typography. Quiet, antique field-manual mood.
>
> Subject: a symbolic specimen-rendering of *Open Data Structures — arrays, linked lists, trees, and hash tables* — expressed through skeletal / structural metaphor, not a literal coding scene.
>
> Central specimen, dead-centre on the page, symmetrical along the vertical axis: a herbarium-mounted botanical specimen rendered as an exploded anatomical cross-section. AT THE APEX — a perfectly bilaterally-symmetrical tree skeleton, its branches forking into a balanced binary structure that descends to fourteen leaf-tips, each leaf hatched with a subtle red-black-tree marking. ALONG THE TRUNK — a creeping vine wraps the spine in two strands twisted in mirror-image, each strand a doubly-linked list whose nodes are tiny pinned segment-cells. AT THE ROOTS — a honeycomb lattice spreads outward in perfect symmetry, each hexagonal cell a hash-table bucket; one cell at the lattice's centre is shown opened to reveal three chained collision-pearls strung on a fine wire. Two short array-stem segments flank the trunk's midpoint as supporting struts, each segment exactly six cells long, mirrored. Faint radial lines emanate from the trunk's midpoint in a sparse halo, marked in the seafoam accent (`#3F8A7C`) — the only saturated colour on the page, used only here and in the four corner medallions' detail lines. Pinned-specimen style throughout: hairline hatching for shadows, restrained two-ink registration, no glow effects.
>
> **Exclude:** any text, letterforms, typography, labels, numbers, photorealism, 3D rendering, smooth digital gradients, glossy surfaces, AI-smooth geometry, pure-white backgrounds.

---

### 4.5 Algorithms — Jeff Erickson (with Python)

_Subject: the canonical algorithms curriculum — recursion, divide-and-conquer, dynamic programming, graphs._

> Vintage 19th-century natural-history specimen plate crossed with a martial-armoury field manual. Aged cream-parchment background with faint age-spots and visible paper grain. Decorative four-pointed star ornaments in each corner of the page. Small inset medallions at the four corners showing kata-training motifs: top-left a pair of crossed brass training swords, top-right a small brass anvil, bottom-left an oak-leaf laurel, bottom-right a heraldic shield. Clean keyline frame inset just inside the page edges. Restrained desaturated palette: faded teal, antique copper, dusty brown, off-white, plus a single signature accent of seafoam (`#3F8A7C`) used sparingly as the highlight ink. Strictly symmetrical composition. Portrait 2:3 aspect ratio (1024 × 1536). NO text or typography. Quiet, antique field-manual mood.
>
> Subject: a symbolic specimen-rendering of *Algorithms — recursion, divide-and-conquer, dynamic programming, and graph traversal* — expressed through skeletal / structural metaphor, not a literal coding scene.
>
> Central specimen, dead-centre on the page, symmetrical along the vertical axis: a brass-and-bone abacus rendered as an exploded anatomical cross-section. The frame is a heavy walnut-grained rectangle holding NINE horizontal rods, each rod strung with bead-pairs in perfect bilateral symmetry across the vertical axis. The TOP THREE rods depict recursion — beads forming a self-similar fractal at progressively smaller scales, mirrored. The MIDDLE THREE rods depict divide-and-conquer — bead clusters bisected at the rod's centre with a fine etched line, each half's beads counted equally. The BOTTOM THREE rods depict dynamic programming — beads arranged in a memo-table grid, two beads at the rod's centre highlighted as the optimal-substructure pivot. Above the abacus, a small graph-traversal armillary sphere hangs on a brass chain — an open lattice of nodes-and-edges drawn in mirror image, two equal hemispheres separated by a delicate equator. Below the abacus, two crossed measuring-calipers form an X. Faint radial lines emanate from the central rod's pivot in a sparse halo, marked in the seafoam accent (`#3F8A7C`) — the only saturated colour on the page, used only here and in the four corner medallions' detail lines. Pinned-specimen style throughout: hairline hatching for shadows, restrained two-ink registration, no glow effects.
>
> **Exclude:** any text, letterforms, typography, labels, numbers, photorealism, 3D rendering, smooth digital gradients, glossy surfaces, AI-smooth geometry, pure-white backgrounds.

---

### 4.6 Functional-Light JavaScript — Kyle Simpson

_Subject: pragmatic FP in JS — composition, immutability, currying, function purity without category theory._

> Vintage 19th-century natural-history specimen plate crossed with a martial-armoury field manual. Aged cream-parchment background with faint age-spots and visible paper grain. Decorative four-pointed star ornaments in each corner of the page. Small inset medallions at the four corners showing kata-training motifs: top-left a pair of crossed brass training swords, top-right a small brass anvil, bottom-left an oak-leaf laurel, bottom-right a heraldic shield. Clean keyline frame inset just inside the page edges. Restrained desaturated palette: faded teal, antique copper, dusty brown, off-white, plus a single signature accent of mustard (`#D9A74A`) used sparingly as the highlight ink. Strictly symmetrical composition. Portrait 2:3 aspect ratio (1024 × 1536). NO text or typography. Quiet, antique field-manual mood.
>
> Subject: a symbolic specimen-rendering of *Functional-Light JavaScript — composition, immutability, currying, and function purity without the category-theory weight* — expressed through skeletal / structural metaphor, not a literal coding scene.
>
> Central specimen, dead-centre on the page, symmetrical along the vertical axis: a Victorian apothecary's balance scale rendered as an exploded anatomical cross-section. The central beam is perfectly horizontal, its fulcrum mounted on a brass pillar at the page's vertical axis. Hanging from the LEFT pan: a stack of three immutable input-vials, each etched with a subtle data-shape glyph, tied together with a fine hatched cord. Hanging from the RIGHT pan: an identical stack of output-vials in mirror image, each one transformed (one slightly larger, one slightly cleaner, one slightly distilled) but the same count, suggesting purity. Threaded through the fulcrum from above, a fine brass curry-comb with three teeth descends — its teeth are partial-application notches, and from each tooth a thin wire feeds one of the input-vials, mirrored on the right. Below the scale, two crossed quill-pens cross at exactly the page's vertical centre. Faint radial lines emanate from the fulcrum in a sparse halo, marked in the mustard accent (`#D9A74A`) — the only saturated colour on the page, used only here and in the four corner medallions' detail lines. Pinned-specimen style throughout: hairline hatching for shadows, restrained two-ink registration, no glow effects.
>
> **Exclude:** any text, letterforms, typography, labels, numbers, photorealism, 3D rendering, smooth digital gradients, glossy surfaces, AI-smooth geometry, pure-white backgrounds.

---

## 5. Wave 4 — 2026 Language-Expansion Challenge Packs

_Eleven kata-style challenge packs added in the 2026 expansion. Each pack ships five Easy challenges of the same shared problem set — `greeting`, `add`, `reverse_string`, `is_palindrome`, `sum_array` — implemented idiomatically per language. Because these are practice-drill packs and not narrative books, every cover leans on the **armoury / training-rack** half of the house style rather than the natural-history half: training swords, drill weights, mirrored practice mannequins, etc._

_Course ids: `challenges-{ruby,lua,dart,haskell,scala,sql,elixir,zig,move,cairo,sway}-handwritten`._

### 5.1 Ruby Challenges

_Subject: dynamic OO, blocks + iterators, "developer happiness" — practiced as five short drills._

> Vintage 19th-century natural-history specimen plate crossed with a martial-armoury field manual. Aged cream-parchment background with faint age-spots and visible paper grain. Decorative four-pointed star ornaments in each corner of the page. Small inset medallions at the four corners showing kata-training motifs: top-left a pair of crossed brass training swords, top-right a small brass anvil, bottom-left an oak-leaf laurel, bottom-right a heraldic shield. Clean keyline frame inset just inside the page edges. Restrained desaturated palette: faded teal, antique copper, dusty brown, off-white, plus a single signature accent of ruby red (`#CC342D`) used sparingly as the highlight ink. Strictly symmetrical composition. Portrait 2:3 aspect ratio (1024 × 1536). NO text or typography. Quiet, antique field-manual mood.
>
> Subject: a symbolic specimen-rendering of *Ruby Challenges — five Easy practice drills exercising blocks, iterators, and the language's joy-of-expression* — expressed through skeletal / structural metaphor of an armoury training-cabinet, not a literal coding scene.
>
> Central specimen, dead-centre on the page, symmetrical along the vertical axis: a Victorian jeweller's mounting-vise displayed as an exploded anatomical cross-section, holding a single faceted ruby at the page's exact centre. The vise is rendered in dusty brown with antique-copper detail; the ruby is shown in profile with its internal crystal lattice laid open as a delicate three-tier method-dispatch diagram — top tier a small block-shaped quill (the iterator), middle tier a perfectly mirrored pair of receiver-arms, bottom tier a coiled enumerator-thread. Around the gem in perfect bilateral symmetry, FIVE numbered training-medallions hang from a horizontal rail crossing the upper third of the page — each medallion engraved with an abstract drill-glyph (a greeting horn, a plus-cross, a reversed scroll, a mirror-pair, a tally-bar) corresponding to the pack's five challenges. Below the gem, two crossed jeweller's loupes flank the vertical axis at exactly 45°. The setting prongs of the vise are mirrored exactly left-and-right, six on each side. Faint radial lines emanate from the gem's centre in a sparse halo, marked in the ruby-red accent (`#CC342D`) — the only saturated colour on the page, used only here and in the four corner medallions' detail lines. Pinned-specimen style throughout: hairline hatching for shadows, restrained two-ink registration, no glow effects.
>
> **Exclude:** any text, letterforms, typography, labels, numbers, the literal Ruby logo or rubygems mark, glossy gemstone renders, photorealism, 3D rendering, smooth digital gradients, glossy surfaces, AI-smooth geometry, pure-white backgrounds.

---

### 5.2 Lua Challenges

_Subject: tiny embedded language, single global table, metatables, coroutines — practiced as five short drills._

> Vintage 19th-century natural-history specimen plate crossed with a martial-armoury field manual. Aged cream-parchment background with faint age-spots and visible paper grain. Decorative four-pointed star ornaments in each corner of the page. Small inset medallions at the four corners showing kata-training motifs: top-left a pair of crossed brass training swords, top-right a small brass anvil, bottom-left an oak-leaf laurel, bottom-right a heraldic shield. Clean keyline frame inset just inside the page edges. Restrained desaturated palette: faded teal, antique copper, dusty brown, off-white, plus a single signature accent of moon blue (`#3050A0`) used sparingly as the highlight ink. Strictly symmetrical composition. Portrait 2:3 aspect ratio (1024 × 1536). NO text or typography. Quiet, antique field-manual mood.
>
> Subject: a symbolic specimen-rendering of *Lua Challenges — five Easy practice drills exercising tables, metatables, and the lunar simplicity of the language* — expressed through skeletal / structural metaphor of an antique celestial-orrery training-bench, not a literal coding scene.
>
> Central specimen, dead-centre on the page, symmetrical along the vertical axis: a Victorian celestial orrery rendered as an exploded anatomical cross-section. At the orrery's hub sits a small carved-bone moon (the only "Lua" allusion, drawn as a profile crescent with hairline crater-stipple). Encircling the moon, a single broad orbital ring carries TWELVE evenly-spaced specimen-cells, each cell etched with a generic key-glyph — the global table, with its keys hung as moon-stations. Outside that, a finer outer ring of metatable-wires hangs as delicate brass threads connecting alternating cells to small attached __index / __newindex tags, drawn as tiny mirrored compass-roses on opposite sides. Below the moon, two coroutine-tracks branch downward in perfect bilateral symmetry — one yielded, one resumed — each track terminating in a small coiled spring-loop. Above the moon, a small armoury crest holds five numbered drill-medallions hung from a horizontal rail in mirror order. Faint radial lines emanate from the moon in a sparse halo, marked in the moon-blue accent (`#3050A0`) — the only saturated colour on the page, used only here and in the four corner medallions' detail lines. Pinned-specimen style throughout: hairline hatching for shadows, restrained two-ink registration, no glow effects.
>
> **Exclude:** any text, letterforms, typography, labels, numbers, the literal Lua moon-logo, photorealism, 3D rendering, smooth digital gradients, glossy surfaces, AI-smooth geometry, pure-white backgrounds.

---

### 5.3 Dart Challenges

_Subject: client-side language for Flutter — sound null safety, isolates, async/await — practiced as five short drills._

> Vintage 19th-century natural-history specimen plate crossed with a martial-armoury field manual. Aged cream-parchment background with faint age-spots and visible paper grain. Decorative four-pointed star ornaments in each corner of the page. Small inset medallions at the four corners showing kata-training motifs: top-left a pair of crossed brass training swords, top-right a small brass anvil, bottom-left an oak-leaf laurel, bottom-right a heraldic shield. Clean keyline frame inset just inside the page edges. Restrained desaturated palette: faded teal, antique copper, dusty brown, off-white, plus a single signature accent of clear blue (`#0175C2`) used sparingly as the highlight ink. Strictly symmetrical composition. Portrait 2:3 aspect ratio (1024 × 1536). NO text or typography. Quiet, antique field-manual mood.
>
> Subject: a symbolic specimen-rendering of *Dart Challenges — five Easy practice drills exercising null safety, async, and the language of a thousand UI surfaces* — expressed through skeletal / structural metaphor of an Edwardian dart-throwing training apparatus, not a literal coding scene.
>
> Central specimen, dead-centre on the page, symmetrical along the vertical axis: an Edwardian wall-mounted dart-target apparatus rendered as an exploded anatomical cross-section. The target board is a perfectly circular brass plate with FIVE concentric rings — outermost to innermost: an iso­late ring (each segment a tiny hatched mailbox), a future ring (each segment a slow-arrow), an await ring (each segment a paused-flag), a non-null ring (closed clasps), and at the bull's-eye a single faceted nullable-pearl in profile with its `?` decoration replaced by a stylised crescent-notch. Pinned dead-centre into the bull's-eye is a single ceremonial dart, its fletching mirrored across the vertical axis, shaft engraved with hairline type-annotation marks. Flanking the target, two equal-length practice-stands rise from the page's lower third — each stand carries five horizontal drill-rods of progressive thickness (the five challenges). Above the target, a small armoury crest holds two crossed quill-pens. Faint radial lines emanate from the bull's-eye in a sparse halo, marked in the clear-blue accent (`#0175C2`) — the only saturated colour on the page, used only here and in the four corner medallions' detail lines. Pinned-specimen style throughout: hairline hatching for shadows, restrained two-ink registration, no glow effects.
>
> **Exclude:** any text, letterforms, typography, labels, numbers, the literal Dart logo or Flutter butterfly, photorealism, 3D rendering, smooth digital gradients, glossy surfaces, AI-smooth geometry, pure-white backgrounds.

---

### 5.4 Haskell Challenges

_Subject: pure functional, lazy evaluation, type classes, monads — practiced as five short drills._

> Vintage 19th-century natural-history specimen plate crossed with a martial-armoury field manual. Aged cream-parchment background with faint age-spots and visible paper grain. Decorative four-pointed star ornaments in each corner of the page. Small inset medallions at the four corners showing kata-training motifs: top-left a pair of crossed brass training swords, top-right a small brass anvil, bottom-left an oak-leaf laurel, bottom-right a heraldic shield. Clean keyline frame inset just inside the page edges. Restrained desaturated palette: faded teal, antique copper, dusty brown, off-white, plus a single signature accent of plum violet (`#5D4F85`) used sparingly as the highlight ink. Strictly symmetrical composition. Portrait 2:3 aspect ratio (1024 × 1536). NO text or typography. Quiet, antique field-manual mood.
>
> Subject: a symbolic specimen-rendering of *Haskell Challenges — five Easy practice drills exercising purity, laziness, type classes, and monadic sequencing* — expressed through skeletal / structural metaphor of an alchemist's distillation training-bench, not a literal coding scene.
>
> Central specimen, dead-centre on the page, symmetrical along the vertical axis: a Victorian alchemist's distillation apparatus rendered as an exploded anatomical cross-section. At the apex sits a single lambda-shaped retort — its curved neck forming the exact silhouette of the Greek letter λ in mirrored brass piping (this is the only allusive glyph permitted, drawn as plumbing not letterform). Beneath the retort, a vertical column of FIVE stacked condenser-flasks descends along the page's vertical axis: each flask a numbered drill, internal etched glyphs depicting (top to bottom) a greeting horn, a plus-cross, a reversed scroll, a mirror-pair, a tally-bar. Flanking the column on either side in perfect bilateral symmetry, twin spiral coils of cooling-tubing wind around brass armatures — these are type-class instances, each loop a different instance frozen mid-derivation. Below the column, three suspended droplets hang frozen mid-fall from a horizontal beam (lazy thunks), each droplet pinned in place by a fine wire. Above the retort sits a small ornate ouroboros pinwheel suggesting monadic bind. Faint radial lines emanate from the retort's bell in a sparse halo, marked in the plum-violet accent (`#5D4F85`) — the only saturated colour on the page, used only here and in the four corner medallions' detail lines. Pinned-specimen style throughout: hairline hatching for shadows, restrained two-ink registration, no glow effects.
>
> **Exclude:** any text, letterforms, typography, labels, numbers, the literal Haskell logo, photorealism, 3D rendering, smooth digital gradients, glossy surfaces, AI-smooth geometry, pure-white backgrounds.

---

### 5.5 Scala Challenges

_Subject: hybrid OO + FP on the JVM, traits, pattern matching — practiced as five short drills._

> Vintage 19th-century natural-history specimen plate crossed with a martial-armoury field manual. Aged cream-parchment background with faint age-spots and visible paper grain. Decorative four-pointed star ornaments in each corner of the page. Small inset medallions at the four corners showing kata-training motifs: top-left a pair of crossed brass training swords, top-right a small brass anvil, bottom-left an oak-leaf laurel, bottom-right a heraldic shield. Clean keyline frame inset just inside the page edges. Restrained desaturated palette: faded teal, antique copper, dusty brown, off-white, plus a single signature accent of scala red (`#DC322F`) used sparingly as the highlight ink. Strictly symmetrical composition. Portrait 2:3 aspect ratio (1024 × 1536). NO text or typography. Quiet, antique field-manual mood.
>
> Subject: a symbolic specimen-rendering of *Scala Challenges — five Easy practice drills exercising the hybrid OO/FP grammar, traits, and pattern matching* — expressed through skeletal / structural metaphor of a twin-cabinet armourer's display, not a literal coding scene.
>
> Central specimen, dead-centre on the page, symmetrical along the vertical axis: a Victorian split-cabinet display rendered as an exploded anatomical cross-section, hinged open at the page's vertical centre to reveal two perfectly mirrored interiors. The LEFT half is the OO half: tiered brass clockwork — three trait-rings stacked vertically, each ring engraved with hairline override-marks, all rings interlinking through a central inheritance-pin. The RIGHT half is the FP half: a botanical fractal pressed flat — a self-similar tree of immutable case-class leaves, each leaf veined with a small constructor-glyph. At the cabinet's exact vertical centre, where the two halves meet, sits an ornate brass prism-mount holding a single faceted pattern-matching prism, its facets cleaved in mirror image so a hypothetical incoming light-ray would split equally into both halves' branch-paths. Above the cabinet, FIVE numbered drill-medallions hang from a horizontal rail in mirror order. Below it, two crossed measuring-calipers form an X. Faint radial lines emanate from the prism in a sparse halo, marked in the scala-red accent (`#DC322F`) — the only saturated colour on the page, used only here and in the four corner medallions' detail lines. Pinned-specimen style throughout: hairline hatching for shadows, restrained two-ink registration, no glow effects.
>
> **Exclude:** any text, letterforms, typography, labels, numbers, the literal Scala logo, photorealism, 3D rendering, smooth digital gradients, glossy surfaces, AI-smooth geometry, pure-white backgrounds.

---

### 5.6 SQL Challenges

_Subject: declarative queries, set theory, joins, aggregates — practiced as five short drills against an in-memory SQLite database._

> Vintage 19th-century natural-history specimen plate crossed with a martial-armoury field manual. Aged cream-parchment background with faint age-spots and visible paper grain. Decorative four-pointed star ornaments in each corner of the page. Small inset medallions at the four corners showing kata-training motifs: top-left a pair of crossed brass training swords, top-right a small brass anvil, bottom-left an oak-leaf laurel, bottom-right a heraldic shield. Clean keyline frame inset just inside the page edges. Restrained desaturated palette: faded teal, antique copper, dusty brown, off-white, plus a single signature accent of indigo (`#336791`) used sparingly as the highlight ink. Strictly symmetrical composition. Portrait 2:3 aspect ratio (1024 × 1536). NO text or typography. Quiet, antique field-manual mood.
>
> Subject: a symbolic specimen-rendering of *SQL Challenges — five Easy practice drills exercising SELECT, JOIN, GROUP BY, and the relational set-theoretic core* — expressed through skeletal / structural metaphor of a Victorian library card-catalog cabinet, not a literal coding scene.
>
> Central specimen, dead-centre on the page, symmetrical along the vertical axis: a Victorian library card-catalog cabinet rendered as an exploded anatomical cross-section. The cabinet has FIVE rows of TEN identical specimen-drawers (mirrored across the vertical axis), every drawer-front etched with a generic record-glyph — these are the relations. At the cabinet's exact vertical centre, two adjacent drawers are pulled half-open in perfect mirror image, exposing brass index-rods that pass straight from one drawer through the other (the JOIN). Threading down the cabinet's spine, a single brass query-rod descends from the apex carrying a small projection-prism mid-frame; from the prism, two thin filter-wires fan out at exactly 45° (the WHERE clause). Above the cabinet sits a small armoury crest containing two perfectly overlapping Venn-style rings (set theory); below it, two crossed quill-pens form an X. Five numbered drill-medallions hang from the upper rail. Faint radial lines emanate from the projection-prism in a sparse halo, marked in the indigo accent (`#336791`) — the only saturated colour on the page, used only here and in the four corner medallions' detail lines. Pinned-specimen style throughout: hairline hatching for shadows, restrained two-ink registration, no glow effects.
>
> **Exclude:** any text, letterforms, typography, labels, numbers, vendor logos (SQLite, Postgres, MySQL, etc.), photorealism, 3D rendering, smooth digital gradients, glossy surfaces, AI-smooth geometry, pure-white backgrounds.

---

### 5.7 Elixir Challenges

_Subject: BEAM VM, actor-model concurrency, fault tolerance, supervisor trees — practiced as five short drills._

> Vintage 19th-century natural-history specimen plate crossed with a martial-armoury field manual. Aged cream-parchment background with faint age-spots and visible paper grain. Decorative four-pointed star ornaments in each corner of the page. Small inset medallions at the four corners showing kata-training motifs: top-left a pair of crossed brass training swords, top-right a small brass anvil, bottom-left an oak-leaf laurel, bottom-right a heraldic shield. Clean keyline frame inset just inside the page edges. Restrained desaturated palette: faded teal, antique copper, dusty brown, off-white, plus a single signature accent of wisteria (`#6E4A7E`) used sparingly as the highlight ink. Strictly symmetrical composition. Portrait 2:3 aspect ratio (1024 × 1536). NO text or typography. Quiet, antique field-manual mood.
>
> Subject: a symbolic specimen-rendering of *Elixir Challenges — five Easy practice drills exercising message passing, pattern matching, and the OTP supervisor-tree mind-set* — expressed through skeletal / structural metaphor of a Victorian apothecary's elixir-flask training-bench, not a literal coding scene.
>
> Central specimen, dead-centre on the page, symmetrical along the vertical axis: a tall Victorian apothecary's elixir-flask rendered as an exploded anatomical cross-section. The flask sits upright at the page's exact centre, its glass body cleaved open to reveal an interior process mailbox — a vertical column of pinned message-capsules stacked top-to-bottom, each capsule a different abstract pattern (chevron, dot-trio, slash, fork). Above the flask's stopper, a perfectly symmetrical supervisor-tree branches outward — three tiers of spawned children, each tier mirrored left-and-right, the leaves drawn as tiny pinned process-pins. Below the flask's base, a single phoenix-feather lies pressed flat as a herbarium specimen (let-it-crash semantics) — its plume mirrored exactly. Flanking the flask at the page's midpoint, two equal-length pipe-conduits descend from the supervisor-tree to the phoenix below, each conduit hatched with a fine arrow-stipple in the wisteria accent. Five numbered drill-medallions hang from a horizontal rail crossing the upper third. Faint radial lines emanate from the flask's centre in a sparse halo, marked in the wisteria accent (`#6E4A7E`) — the only saturated colour on the page, used only here and in the four corner medallions' detail lines. Pinned-specimen style throughout: hairline hatching for shadows, restrained two-ink registration, no glow effects.
>
> **Exclude:** any text, letterforms, typography, labels, numbers, the literal Elixir drop logo, photorealism, 3D rendering, smooth digital gradients, glossy surfaces, AI-smooth geometry, pure-white backgrounds.

---

### 5.8 Zig Challenges

_Subject: low-level systems, comptime evaluation, no hidden control flow, explicit allocators — practiced as five short drills._

> Vintage 19th-century natural-history specimen plate crossed with a martial-armoury field manual. Aged cream-parchment background with faint age-spots and visible paper grain. Decorative four-pointed star ornaments in each corner of the page. Small inset medallions at the four corners showing kata-training motifs: top-left a pair of crossed brass training swords, top-right a small brass anvil, bottom-left an oak-leaf laurel, bottom-right a heraldic shield. Clean keyline frame inset just inside the page edges. Restrained desaturated palette: faded teal, antique copper, dusty brown, off-white, plus a single signature accent of amber (`#F7A41D`) used sparingly as the highlight ink. Strictly symmetrical composition. Portrait 2:3 aspect ratio (1024 × 1536). NO text or typography. Quiet, antique field-manual mood.
>
> Subject: a symbolic specimen-rendering of *Zig Challenges — five Easy practice drills exercising explicit memory, comptime, and the language's no-hidden-control-flow ethos* — expressed through skeletal / structural metaphor of a master-armourer's forge bench, not a literal coding scene.
>
> Central specimen, dead-centre on the page, symmetrical along the vertical axis: a small Victorian armourer's anvil rendered as an exploded anatomical cross-section, the anvil itself sitting dead-centre with perfect bilateral symmetry around its horn. Hovering directly above the anvil's striking surface, a precise comptime mandrel descends from a brass overhead frame — the mandrel is a slim shaped form whose silhouette mirrors the anvil exactly, hatching showing it computed-at-compile-time (faint dotted dashes versus solid lines). Flanking the anvil on either side at exact mirror positions, two allocator-scales hang from short brass arms — left scale loaded with a stack of pre-counted ingots (heap allocator), right scale loaded with the same count of mirrored ingots (arena allocator); the scales are perfectly balanced. Below the anvil's base, two crossed cooling-tongs form an X. Above the overhead frame, FIVE numbered drill-medallions hang from a horizontal rail in mirror order. The whole composition reads as quiet, exacting, and explicit — no hidden machinery. Faint radial lines emanate from the strike-point of the anvil in a sparse halo, marked in the amber accent (`#F7A41D`) — the only saturated colour on the page, used only here and in the four corner medallions' detail lines. Pinned-specimen style throughout: hairline hatching for shadows, restrained two-ink registration, no glow effects.
>
> **Exclude:** any text, letterforms, typography, labels, numbers, the literal Zig lightning-Z logo, photorealism, 3D rendering, smooth digital gradients, glossy surfaces, AI-smooth geometry, pure-white backgrounds.

---

### 5.9 Move Challenges

_Subject: resource-oriented programming for Aptos / Sui — linear types, transferable-not-copyable assets — practiced as five short drills._

> Vintage 19th-century natural-history specimen plate crossed with a martial-armoury field manual. Aged cream-parchment background with faint age-spots and visible paper grain. Decorative four-pointed star ornaments in each corner of the page. Small inset medallions at the four corners showing kata-training motifs: top-left a pair of crossed brass training swords, top-right a small brass anvil, bottom-left an oak-leaf laurel, bottom-right a heraldic shield. Clean keyline frame inset just inside the page edges. Restrained desaturated palette: faded teal, antique copper, dusty brown, off-white, plus a single signature accent of slate blue (`#4E5D7E`) used sparingly as the highlight ink. Strictly symmetrical composition. Portrait 2:3 aspect ratio (1024 × 1536). NO text or typography. Quiet, antique field-manual mood.
>
> Subject: a symbolic specimen-rendering of *Move Challenges — five Easy practice drills exercising the resource-as-asset model where values can be moved but never duplicated* — expressed through skeletal / structural metaphor of a custodial transit-strongbox apparatus, not a literal coding scene.
>
> Central specimen, dead-centre on the page, symmetrical along the vertical axis: a pair of Victorian transit-strongboxes rendered as an exploded anatomical cross-section, mounted on opposite ends of a single horizontal brass transit-rail that crosses the page's exact centre. The LEFT strongbox is shown with its lid open and its interior empty (the donor account, post-move); the RIGHT strongbox is shown with its lid closed and a single faceted resource-token resting inside (the recipient account). Connecting them along the rail is a small brass carriage holding a single token mid-flight — pinned at the rail's centre — its position making clear there is exactly ONE token, never a copy. Below the rail, a vertical linear-type chain descends along the page's vertical axis, each link a tiny faceted ownership-key, the chain's length suggesting ascending custodianship. Above the rail, FIVE numbered drill-medallions hang from a horizontal mounting-bar in mirror order. Two crossed key-pins flank the centre of the rail at exactly 45°. Faint radial lines emanate from the carriage in a sparse halo, marked in the slate-blue accent (`#4E5D7E`) — the only saturated colour on the page, used only here and in the four corner medallions' detail lines. Pinned-specimen style throughout: hairline hatching for shadows, restrained two-ink registration, no glow effects.
>
> **Exclude:** any text, letterforms, typography, labels, numbers, the literal Aptos / Sui / Move logos, photorealism, 3D rendering, smooth digital gradients, glossy surfaces, AI-smooth geometry, pure-white backgrounds.

---

### 5.10 Cairo Challenges

_Subject: provable computation on StarkNet — felt arithmetic, ZK-friendly programming — practiced as five short drills._

> Vintage 19th-century natural-history specimen plate crossed with a martial-armoury field manual. Aged cream-parchment background with faint age-spots and visible paper grain. Decorative four-pointed star ornaments in each corner of the page. Small inset medallions at the four corners showing kata-training motifs: top-left a pair of crossed brass training swords, top-right a small brass anvil, bottom-left an oak-leaf laurel, bottom-right a heraldic shield. Clean keyline frame inset just inside the page edges. Restrained desaturated palette: faded teal, antique copper, dusty brown, off-white, plus a single signature accent of StarkNet orange (`#FA9056`) used sparingly as the highlight ink. Strictly symmetrical composition. Portrait 2:3 aspect ratio (1024 × 1536). NO text or typography. Quiet, antique field-manual mood.
>
> Subject: a symbolic specimen-rendering of *Cairo Challenges — five Easy practice drills exercising felt252 arithmetic, recursion, and the prove-then-verify mind-set of zero-knowledge programming* — expressed through skeletal / structural metaphor of a sealed-glass zoetrope verification apparatus, not a literal coding scene.
>
> Central specimen, dead-centre on the page, symmetrical along the vertical axis: a Victorian zoetrope rendered as an exploded anatomical cross-section. A perfectly circular brass drum sits dead-centre, its outer wall pierced by twelve equally-spaced viewing-slits in mirror symmetry. Inside the drum, a folded scroll of proof-tape spirals from the centre outward — drawn as a slender ribbon making one full revolution then dissolving into the drum's interior haze. Above the drum, in the upper third, a STARK-tree fractal hangs as an inverted herbarium pressing — three tiers of branching nodes, each branch ending in a tiny faceted commitment-bead, perfectly mirrored across the vertical axis. Below the drum, in the lower third, a second smaller drum sits inverted as the verifier — its slits mirroring the prover's exactly. Between the two drums, two equal-length witness-rods cross at the page's vertical centre at exactly 45°, suggesting the act of submitting a proof. Five numbered drill-medallions hang from the upper rail. Faint radial lines emanate from the prover-drum's hub in a sparse halo, marked in the StarkNet-orange accent (`#FA9056`) — the only saturated colour on the page, used only here and in the four corner medallions' detail lines. Pinned-specimen style throughout: hairline hatching for shadows, restrained two-ink registration, no glow effects.
>
> **Exclude:** any text, letterforms, typography, labels, numbers, the literal StarkNet / Cairo logo, photorealism, 3D rendering, smooth digital gradients, glossy surfaces, AI-smooth geometry, pure-white backgrounds.

---

### 5.11 Sway Challenges

_Subject: smart contracts on Fuel — Rust-flavoured syntax, parallel transaction execution, UTXO model — practiced as five short drills._

> Vintage 19th-century natural-history specimen plate crossed with a martial-armoury field manual. Aged cream-parchment background with faint age-spots and visible paper grain. Decorative four-pointed star ornaments in each corner of the page. Small inset medallions at the four corners showing kata-training motifs: top-left a pair of crossed brass training swords, top-right a small brass anvil, bottom-left an oak-leaf laurel, bottom-right a heraldic shield. Clean keyline frame inset just inside the page edges. Restrained desaturated palette: faded teal, antique copper, dusty brown, off-white, plus a single signature accent of fuel green (`#00C078`) used sparingly as the highlight ink. Strictly symmetrical composition. Portrait 2:3 aspect ratio (1024 × 1536). NO text or typography. Quiet, antique field-manual mood.
>
> Subject: a symbolic specimen-rendering of *Sway Challenges — five Easy practice drills exercising the FuelVM's parallel-execution + UTXO model in a Rust-shaped grammar* — expressed through skeletal / structural metaphor of a Victorian water-mill running multiple wheels in parallel, not a literal coding scene.
>
> Central specimen, dead-centre on the page, symmetrical along the vertical axis: a Victorian multi-wheel water-mill rendered as an exploded anatomical cross-section. THREE equal-sized mill wheels are mounted side by side on a shared horizontal mill-axle that crosses the page's exact centre — left wheel, centre wheel, right wheel — in perfect mirror symmetry, each wheel turning a different transaction-load (stippled to suggest motion without breaking the static plate). Above the wheels, a watercourse divides into three parallel channels at a single source-aqueduct, each channel feeding one wheel — these are independent UTXO inputs being processed in parallel. Below the wheels, the three streams reunite into a single tail-race that exits the bottom of the frame. At the central axle's hub, an ABI-printed millstone sits as a small octagonal disc with eight engraved facets (the contract entry-points). Above the aqueduct, FIVE numbered drill-medallions hang from a horizontal rail in mirror order. Two crossed reed-stalks (a nod to "sway grass") flank the centre at exactly 45°. Faint radial lines emanate from the central millstone in a sparse halo, marked in the fuel-green accent (`#00C078`) — the only saturated colour on the page, used only here and in the four corner medallions' detail lines. Pinned-specimen style throughout: hairline hatching for shadows, restrained two-ink registration, no glow effects.
>
> **Exclude:** any text, letterforms, typography, labels, numbers, the literal Fuel / Sway logos, photorealism, 3D rendering, smooth digital gradients, glossy surfaces, AI-smooth geometry, pure-white backgrounds.

---

## 6. Workflow

1. Pick a section above. Copy the entire blockquote (the prompt is one self-contained block).
2. Paste into Lovart with Nanobanana 2 set to 1024 × 1536 portrait.
3. Generate three variants. Pick the one with the cleanest symmetry + the most-restrained accent use.
4. Save the chosen PNG to `cover-overrides/<course-id>.png`. Course ids:
   - **Books**: match the id chosen in `openbook-ingest-tracker.md` (e.g. `eloquent-javascript`, `mastering-bitcoin`).
   - **Wave 4 challenge packs**: `challenges-<lang>-handwritten.png` — e.g. `challenges-ruby-handwritten.png`, `challenges-zig-handwritten.png`.
5. Run `node scripts/extract-starter-courses.mjs && node scripts/sync-drills-to-local.mjs` so the cover ships with the bundled-pack archive.

## 7. Tone notes

- **Symmetry is non-negotiable.** Lovart sometimes drifts toward asymmetric "design-y" compositions on long prompts. If it does, regenerate with the word "strictly symmetrical" repeated once more.
- **Accent restraint.** The accent ink should appear in maybe 5–10% of the image area. Reject any output where the accent dominates — it should read as a single highlight, not the page's mood.
- **No text.** Always reject any output with letterforms, even decorative ones. Lovart slips in fake-Latin filler under stress.
- **The corner medallions** are part of the brand — the four kata motifs (swords / anvil / laurel / shield) appear on every cover.

---

## 8. Changelog

- **2026-04-30** — Wave 4 added. 11 challenge-pack prompts for the 2026 language expansion (Ruby / Lua / Dart / Haskell / Scala / SQL / Elixir / Zig / Move / Cairo / Sway). Each leans on the **armoury training-rack** half of the house style — five drill-medallions hung from a horizontal rail above each central specimen — to read as practice packs rather than narrative books. Accent table extended with the 11 new signature inks.
- **2026-04-28** — Initial drafting. 16 prompts covering Wave 1–3 of the open-book ingest tracker. Bitcoin + Ethereum prompts ported in from earlier chat drafts.
