'use strict';
// Builds builds/static-strike-slayer.json: Alohaa's Static Strike Slayer levelling PoB (updated 6 Nov 2026,
// https://pobb.in/2FlZU8rRPp3F) + his guide sheet + 3.30 patch-note changes + a post-campaign route to
// 4 voidstones (chapters after Act 10).
// Usage: node scripts/make-default-build.js [pob-link-or-code]
// Without an argument it uses the saved copy in test/fixtures, so it works offline.
const fs = require('fs');
const path = require('path');
const { importPob } = require('../src/engine/pob');

const FIXTURE = path.join(__dirname, '..', 'test', 'fixtures', 'alohaa-static-strike-2FlZU8rRPp3F.pob.txt');
const PHYS_2H = String.raw`"two hand (a|s|m)" "ed phys|adds \d+ to \d+ ph"`;

// Post-campaign route (route DSL): #section = overlay header, #chapter = one "zone" (Shift+F1/F2 moves
// between chapters), #stage = which PoB gear/links set the overlay shows from that step on.
// {generic|..} highlights, {arena|..} boss areas, {copy|..} search strings (click or F4 pastes them).
const ENDGAME = String.raw`
#section Endgame 1: maps
#chapter After Kitava: set up for maps
#stage 61-Early Maps
Hideout: set up the {generic|crafting bench}, {generic|map device} and stash; open the {generic|Atlas}
    #sub 3.30: the Atlas tree starts in the CENTRE (150 points). Spend the first points on map sustain near the centre
    #sub Scarabs are gone: {generic|Threads} go in the map device (up to 8). Frayed Threads vendor for a random Thread
Weapon first: a high-phys {generic|Reaver Axe} is the biggest upgrade (the Storm Blade reward in Act 9 is one)
    #sub Scour + Transmute, then Alteration until a T3-T5 flat phys or % phys roll; Granite Flask recipe can raise flat phys one tier
    #sub Augment, Regal, then bench whichever phys mod is missing. Save at least 4 Exalted Orbs for the red-map axe
Buy {generic|Daresso's Salute} and fix accuracy: with Precise Technique, main-hand accuracy must be above your life
    #sub Weapon accuracy, Precision, or bench accuracy on gloves/helmet. Check it in the character sheet
First upgrade after the campaign: a {generic|5-link} body armour (bench "Five Linked Sockets" or buy one)
Rotation: Shield Charge in, Static Strike, then Ambush + Static Strike on tanky rares
    #sub Ambush (exert) and Ruthless snapshot for the whole Static Strike; flasks, tinctures and buffs only count while active
    #sub Set every skill to "Always attack without moving". Count Ruthless hits only on pinnacle bosses
#chapter White maps (T1-T5), level 68-75
Complete every map you can reach. Atlas bonus: complete white maps while they are {generic|magic}
    #sub Use Kirac's missions on maps you're missing. 3.30: his shop stops at T14 and costs more gold
Filter: pick up every {generic|pink} base. Rares with life + resistances are your gear for now
    #sub Priority on armour and jewellery: life > elemental resistances > Dex/Int > chaos resistance
Fill resistance gaps on the bench, then upgrade rings (Amethyst) and belt (Rustic Sash, later Stygian Vise)
    #sub 3.30 buffs: Two-Toned Boots (+16-20% to two resistances) and Spiked Gloves (24-30% increased melee damage). Both now drop only as tiered magic/rare items: the filter shows every one in pink
    #sub 3.30 Item Tiers: from Act 6, magic/rare items roll Tier 2-5; higher tiers roll better mods, links and quality
    #sub Tier 5 magic items can drop {generic|fractured}: a fractured key base (pink) is the best crafting base you can find
Essences now spawn in maps by default: {generic|Essence of Greed} (life) and {generic|Contempt} (flat phys) on your key bases
Level 75-80: get the {generic|6-link} and anoint the amulet
    #sub 6-link: bench 6-link (Fusings), or buy. 6L: Static Strike + MPD + Ruthless + Trinity + Elemental Damage with Attacks + Close Combat
Run the {generic|Eternal Labyrinth} (Uber Lab) around level 80 for the 4th ascendancy
    #sub Order: Impact, Bane of Legends, Brutal Fervour, Headsman (swap the last two if you need recovery)
#chapter Yellow maps (T6-T10), level 75-85
#stage Midgame
The {generic|Envoy} appears in yellow maps: talk to him to start the Maven and Eldritch (Exarch/Eater) questlines
Atlas bonus: complete yellow maps while they are {generic|rare}
Red-map axe: {generic|item level 77+} Reaver Axe, Alteration until T1/T2 flat phys, or a Deafening Essence of Contempt
    #sub Finish with the bench "(100-129)% increased Physical Damage" craft (4 Exalted). Alteration regex for % phys:
    #sub {copy|"^Emperor's|^Dictator's|^Tyrannical|^Merciless"}
    #sub 3.30: the maps that unlocked this craft (Foundry) and the glove cold-conversion craft (Atoll) are off the Atlas. Unlocked recipes stay on your bench
Rare jewels: life, increased physical damage, critical strike multiplier. Then {generic|Dawnbreaker} if cheap
    #sub Dawnbreaker priority: physical damage taken as fire, then block chance, then armour
Buy an {generic|ilvl 85 Prismatic Tincture} and Alteration it for penetration + effect
Buy {generic|Marylene's Fallacy}, anoint it, cap your crit chance. Early Taming is optional for more damage
#chapter Red maps (T11-T16), level 85+
#stage Endgame Red Maps
Atlas bonus: complete red maps while they are {generic|corrupted rares}
Gloves: {generic|Leviathan Gauntlets} with attack speed, accuracy, life, res + "(20-25)% Physical Converted to Cold" bench craft
    #sub Full conversion: 50% from Static Strike + 25% glove craft + 25% Eater implicit on gloves (20% phys to lightning)
    #sub Stash regex for ilvl 84 Leviathan Gauntlets: {copy|"Leviathan Gauntlets"}
Eldritch currency (Embers/Ichors from the altars) on gloves, helmet, body armour and boots
Body: {generic|Royal Plate} with high armour + "% additional Physical Damage Reduction". Buy it, or craft it (next step)
    #sub ilvl 86 Royal Plate, Alteration for T1 % armour / hybrid / flat: {copy|"^Impenetrable|^Mammoth's|^Impervious|of the Conservator$"}
    #sub Recombine to 2+2 prefixes, bench "Prefixes cannot be changed", Harvest reforge Physical until T1/T2 phys reduction, bench a suffix, Exalt
    #sub 3.30 cost check: "Prefixes cannot be changed" on armour is now 4 Divine + 4 Blessed; Recombinator result uses the chosen base's item level
Endgame flasks: {generic|Cinderswallow Urn} and {generic|Progenesis}; then Lethal Pride (5% double damage) and The Light of Meaning
#section Endgame 2: 4 voidstones
#chapter Voidstone 1: Eldritch (Exarch + Eater)
Run maps with Exarch/Eater {generic|altars}. Influenced T9+, T10+, T11+ map bosses advance the quest
The 3rd boss drops the {generic|Polaric Invitation} or {generic|Writhing Invitation}: kill {kill|The Black Star} and {kill|The Infinite Hunger}
    #sub Black Star: Polaric Void. Infinite Hunger: Seething Chyme. Use both invitations (you get the other one the same way)
Keep killing influenced T12+ to T16+ map bosses for the {generic|Incandescent Invitation} (Exarch) and {generic|Screaming Invitation} (Eater)
Kill the {kill|Searing Exarch} in {arena|Absence of Patience and Wisdom}
    #sub Before pinnacles: max resistances, Silver Flask of the Walrus (freeze immunity for Lunaris), Ambush before every Static Strike
Kill the {kill|Eater of Worlds} in {arena|Absence of Symmetry and Harmony}: both done = {generic|Eldritch Voidstone}, 2 Atlas points each
#chapter Voidstone 2: Originator (Incarnation of Dread)
Memory Tear in a T14+ map: {arena|Courtyard of Wasting}, then talk to {generic|Eagon Caeserius} in your hideout
Kill the {kill|Incarnation of Neglect} in {arena|Moment of Loneliness}
Memory Tear in a T15+ map: {arena|Chambers of Impurity}, then the {kill|Incarnation of Fear} in {arena|Moment of Trauma}
Memory Tear in a T16+ map: {arena|Theatre of Lies}, then the {kill|Incarnation of Dread} in {arena|Moment of Reverence} = {generic|Originator Voidstone}
    #sub The tradeable key for Dread is the Echo of Reverence if you want to buy the last step
#chapter Voidstone 3: Decayed (Shaper + Elder)
Shaper guardian maps drop from T14+ map bosses: {generic|Lair of the Hydra}, {generic|Maze of the Minotaur}, {generic|Forge of the Phoenix}, {generic|Pit of the Chimera}
    #sub Run them with the Maven's Beacon active for her "The Formed" invitation. 3.30: guardian fragments no longer add quantity and aren't consumed with a map
Elder guardians appear in Elder-influenced T14+ maps: the Purifier, Constrictor, Enslaver and Eradicator
Kill the {kill|Shaper} in {arena|The Shaper's Realm} with the 4 Shaper fragments
Kill the {kill|Elder} in {arena|Absence of Value and Meaning} with the 4 Elder fragments: Shaper + Elder = {generic|Decayed Voidstone}
    #sub Uber Elder (Terror + Emptiness + Knowledge + Shape) isn't needed for the stone, but gives 4 Atlas points in 3.30
#chapter Voidstone 4: Ceremonial (Maven)
Get the {generic|Maven's Beacon} from the Envoy and let the Maven witness map bosses (up to 10 different ones)
Complete Maven invitations in {arena|The Maven's Crucible}: The Formed (Shaper guardians), The Twisted (Elder guardians), region invitations
    #sub Every invitation drops Crescent Splinters; 10 make {generic|The Maven's Writ}. Each invitation is 2 Atlas points in 3.30
Kill the {kill|Maven} in {arena|Absence of Mercy and Empathy} = {generic|Ceremonial Voidstone}
4 voidstones: socket them on the Atlas. Done! Next: farm the Atlas strategy you like, upgrade toward the Endgame PoB set
`;

(async () => {
  const src = process.argv[2] || fs.readFileSync(FIXTURE, 'utf8').trim();
  const b = await importPob(src, { name: 'Static Strike Slayer (Alohaa, 3.30)' });
  b.source = { pob: 'https://pobb.in/2FlZU8rRPp3F', guide: 'https://www.youtube.com/watch?v=jQy7qtUnQHM', sheet: 'https://docs.google.com/spreadsheets/d/1UGBybGpDGgNuewBudqyATyZwY-i81vjFpufj0020DvQ' };
  b.pantheon = 'Soul of Lunaris (needs a freeze-immunity flask) + Soul of Gruthkul';

  for (const s of b.stages) {
    if (s.title === '61-Early Maps') {
      // "61 Crit Swap" and "61-Early Maps" both start at 61 in the PoB; early-maps gear needs ilvl 67+ bases
      s.from = 68;
      s.notes.push('Early-maps target gear (item level 67+ bases). The pink filter labels are these bases.');
    }
    if (s.title === '61 Crit Swap') {
      s.to = 67;
      s.notes.push('Only swap with a high-phys Reaver Axe (flat + % phys). Otherwise stay on the 2H axe and swap in white maps.');
      s.notes.push('Respec with Faustus gold + refund points: drop 2H nodes; take Dismembering, Eagle Eye, axe damage/crit. Ambush replaces Intimidating Cry.');
    }
    if (s.title === 'Endgame Red Maps') s.from = 85; // the post-campaign route switches to it in red maps
    if (s.title === 'lvl 1-11') s.notes.push('Spectral Throw until 12, then Static Strike. Get 3 Transmutes: Static Strike, Intimidating Cry, Lapis Amulet (Frostblink).');
    if (s.title === '12-17') s.notes.push('Static Strike + Ruthless + Ancestral Call. After Sharp and Cruel, Close Combat replaces Chance to Bleed.');
    if (s.title === '18-28') s.notes.push('Level 18 Attack Mastery (+1 strike target): Melee Physical Damage replaces Ancestral Call.');
    if (s.title === '28-60') s.notes.push('Act 6 Lilly Roth: buy Fortify, Ambush, Trinity, Hatred. Fortify is the 5th link until Trinity. Level Ambush, Trinity and Hatred in weapon swap.');
  }
  b.stages.sort((x, y) => x.from - y.from);
  // the sheet: Fortify is the 5th link from Act 6 until Trinity; Ambush/Trinity bought from Lilly in Act 6 and
  // levelled in weapon swap (the PoB only shows them from 61)
  const mid = b.stages.find((s) => s.title === '28-60');
  const ss = mid && mid.links.find((l) => l.gems[0] === 'Static Strike');
  if (ss && !ss.gems.includes('Fortify Support')) ss.gems.push('Fortify Support');
  // Alohaa's lab order (the PoB has two of them in the same tree)
  b.ascendancyOrder = ['Impact', 'Bane of Legends', 'Brutal Fervour', 'Headsman'];
  b.gemOverrides = { Ambush: { pin: 'a6q4' }, 'Trinity Support': { pin: 'a6q4' }, 'Fortify Support': { pin: 'a6q4', neededAt: 45 } };

  b.milestones = [
    { level: 1, until: 30, slot: 'Boots', text: 'Movement speed boots: buy 10%+, or vendor normal boots + Quicksilver Flask + Orb of Augmentation.', search: '"ent sp|runn|sprint"' },
    { level: 3, until: 60, slot: 'Shop', text: 'Every town visit: sweep the vendors for links and movement speed (any socket colour works).', search: String.raw`"\w-\w-\w-\w|ent sp"` },
    { level: 9, until: 14, slot: 'Weapon', text: 'Level 9: gamble a 2H axe from the weapon vendor with gold (you want a Jade Chopper). Gamble is cheaper in 3.30.' },
    { level: 9, until: 45, slot: 'Weapon', text: "Weapon recipe: white 2H axe + Blacksmith's Whetstone + rare Rustic Sash = % phys axe. Then Augment, Regal, bench flat phys.", search: PHYS_2H },
    { level: 24, until: 30, slot: 'Body', text: 'Level 26: gamble an armour body armour for a 4-link and put Ruthless back in.' },
    { level: 36, until: 45, slot: 'Resists', text: 'Cap fire, cold and lightning resistance before Kitava at the end of Act 5 (-30% after the kill).' },
    { level: 45, until: 61, slot: 'Swap', text: 'Level Ambush, Trinity and Hatred in weapon set 2 so they are ready for the level-61 crit swap.' },
    { level: 58, until: 67, slot: 'Weapon', text: 'Crit-swap axe: the Storm Blade reward (Act 9) is a Reaver Axe. Scour, Transmute, Alteration to T3-T5 flat/% phys, Augment, Regal, bench.' },
    { level: 62, until: 70, slot: 'Resists', text: 'Cap resistances again before Act 10 Kitava (another -30%).' },
  ];

  b.searches = [
    { label: '2H axes with physical damage (levelling)', search: PHYS_2H },
    { label: '1H axes + shields (crit swap)', search: '"one hand a|tower s"' },
    { label: 'Alohaa gem/vendor regex (Acts 1-3)', search: '"poa|ge on f|cis|atr|od rag|^spectral t|akn|dati|d win|ess su|^trin|stbl|^hast|lix|bush$|^ancestral ca|c st|ld ch|^melee p|f ash$|bat s|^mom|-[rgbw]-|Runn|rint|s:.+ax"' },
    { label: '% phys on axes (Alteration rolling)', search: '"^Emperor\'s|^Dictator\'s|^Tyrannical|^Merciless"' },
  ];

  b.steps = [
    { area: '1_1_town', text: 'Buy Spectral Throw from Nessa (1 Wisdom). 3.30: Wisdom Scrolls are 15 gold at every vendor, Transmutes cost an Augmentation.', kind: 'note' },
    { area: '1_2_town', text: 'Bandits: help Alira for this build.', kind: 'note' },
    { area: '1_3_town', text: 'Check the weapon vendor for a better 2H axe. Socket colours do not matter (since 3.29).', search: PHYS_2H, kind: 'item' },
    { area: '2_6_town', text: 'Lilly Roth sells every gem from here on: Fortify, Ambush, Trinity, Hatred. Level Ambush/Trinity/Hatred in weapon swap.', kind: 'note' },
    { quest: 'a9q3', text: 'Take the Reaver Axe: it is the crit-swap weapon base (craft it before you swap at 61).', kind: 'item' },
  ];

  b.endgame = ENDGAME.split('\n').filter((l) => l.trim());
  b.pobNotes = [
    '3.30 Covens of Umbra (patch notes 11 Nov 2026): no changes to Static Strike, its supports, or the Slayer in normal leagues',
    '(the Slayer notable changes in the notes are Ruthless-only).',
    'Changes that touch this plan: Atlas tree starts in the centre (150 points); Scarabs replaced by Threads; Foundry/Atoll/Shipyard',
    'removed from the Atlas (they unlocked bench crafts this build uses); meta-crafts cost more; Recombinator and Harvest reworked;',
    'Stygian Vise only drops at Item Tier 5; Amethyst Ring chaos res lowered; gem prices: lvl 28-33 gems cost an Alteration, 34-37 an Alchemy.',
    '',
    b.pobNotes || '',
  ].join('\n');

  const out = path.join(__dirname, '..', 'builds', 'static-strike-slayer.json');
  fs.writeFileSync(out, JSON.stringify(b, null, 2));
  console.log('wrote', out, 'stages:', b.stages.map((s) => `${s.title}@${s.from}-${s.to}`).join(', '));
  if (b.importWarnings.length) console.log('warnings:', b.importWarnings);
})().catch((e) => { console.error(e); process.exit(1); });
