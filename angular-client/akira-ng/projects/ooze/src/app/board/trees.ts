import { Species, Strip } from './meadow';

/**
 * Trees, as plants.
 *
 * <p><b>The same machinery as the grass, at forty times the scale.</b> A tree
 * here is a {@link Species} like any other: tapered strips of triangles, no
 * textures and no alpha, instanced and chunked and culled and thinned by the
 * same pixel budget, moved by the same wind and lit through by the same sun.
 * The only thing that differs is how far apart the candidates stand, which is
 * one number on the sowing.
 *
 * <p><b>Why procedural and not scanned.</b> Poly Haven has beautiful conifers.
 * The pine is a 948-megabyte geometry buffer — it is a film asset, and there is
 * no amount of decimation that turns it into something a browser should fetch.
 * Built from strips instead, a tree costs a few hundred triangles, instances to
 * a whole wood for one draw call, and inherits every improvement the grass gets
 * for free. It is also closer to what this board is aiming at: the target is a
 * painted game, and a painted wood wants a confident silhouette rather than a
 * photograph of bark.
 */

/**
 * A conifer: one trunk and a stack of drooping tiers.
 *
 * <p>Tiers rather than branches. What reads as a fir from thirty feet is the
 * *outline* — a stack of skirts narrowing to a point — and the individual
 * branches inside it are below a pixel long before anyone can count them.
 * Eight fronds a tier, each rooted at the trunk and reaching out and slightly
 * down, turned off the golden angle so no two tiers line up.
 *
 * <p>Nine tiers and eight fronds rather than seven and five, because at seven
 * and five the fronds read as separate paper fans with gaps between them. A
 * tree here is about three hundred and fifty triangles either way, and a wood
 * of a hundred and fifty of them is a rounding error next to the ferns
 * underneath — so the density that makes the silhouette solid is simply worth
 * having.
 */
function coniferStrips(needles: number, twig: number, bark: number): () => Strip[] {
  return () => {
    const strips: Strip[] = [
      // The trunk. Barely tapering, because a conifer's is barely tapering,
      // and dark, because almost none of it is ever in the light.
      { rootX: 0, rootY: 0, yaw: 0, tall: 1, bend: 0.02, width: 0.028, taper: 0.45,
        segments: 3, root: bark, tip: bark },
    ];
    const tiers = 9;
    for (let tier = 0; tier < tiers; tier++) {
      const up = 0.22 + (tier / (tiers - 1)) * 0.7;
      // Narrowing to the top, which is the whole silhouette of the tree.
      const out = (1 - (tier / (tiers - 1)) * 0.82) * 0.34 + 0.04;
      for (let frond = 0; frond < 8; frond++) {
        strips.push({
          rootX: 0, rootY: 0,
          // Golden angle plus a per-tier offset, so the tiers spiral rather
          // than stacking into five vertical ribs.
          yaw: frond * 2.3999 + tier * 0.9,
          // Negative: a fir's branches come off the trunk and fall away. The
          // reach is absolute, or the droop would drag the branch back in.
          tall: -0.04 - (tier % 2) * 0.02,
          bend: 0, reach: out,
          width: 0.088 * (1 - tier * 0.055), taper: 0.22, leaf: 0.5,
          segments: 3,
          lift: up,
          root: needles, tip: twig,
        } as Strip & { lift: number });
      }
    }
    return strips;
  };
}

/** A dead trunk: no needles, a broken top, and a few stubs. */
function snagStrips(bark: number): Strip[] {
  const strips: Strip[] = [
    { rootX: 0, rootY: 0, yaw: 0, tall: 1, bend: 0.06, width: 0.034, taper: 0.3,
      segments: 3, root: 0x3a2f24, tip: bark },
  ];
  for (let stub = 0; stub < 5; stub++) {
    strips.push({
      rootX: 0, rootY: 0,
      yaw: stub * 2.3999,
      tall: -0.02, bend: 0, reach: 0.11 + (stub % 3) * 0.04,
      width: 0.018, taper: 0.2, segments: 2,
      lift: 0.34 + stub * 0.13,
      root: 0x3a2f24, tip: bark,
    } as Strip & { lift: number });
  }
  return strips;
}

/**
 * A pine wood: firs, a few spruce among them, saplings and standing dead.
 *
 * <p>Sized in half-feet by the instance scale, so a full fir stands between
 * thirty and fifty feet — which is what makes a cabin look like a cabin.
 */
export const CONIFERS: readonly Species[] = [
  {
    name: 'fir', punctuates: false, share: 1, patch: 0.02, clumping: 1.2,
    tolerates: 0.5, slope: 0.5, scale: [56, 96], sway: 0.012, casts: true,
    lush: 0x3f5f39, dry: 0x55704a,
    strips: coniferStrips(0x24401f, 0x53743a, 0x352a20),
  },
  {
    // Bluer and narrower, in patches, which is what stops a wood being one tree
    // repeated.
    name: 'spruce', punctuates: false, share: 0.55, patch: 0.035, clumping: 2.4,
    tolerates: 0.45, slope: 0.5, scale: [48, 84], sway: 0.014, casts: true,
    lush: 0x35543f, dry: 0x43614a,
    strips: coniferStrips(0x1d3524, 0x466a44, 0x2f261e),
  },
  {
    name: 'sapling', punctuates: false, share: 0.5, patch: 0.06, clumping: 1.6,
    tolerates: 0.66, slope: 0.7, scale: [14, 30], sway: 0.05, casts: true,
    lush: 0x486b3c, dry: 0x63804a,
    strips: coniferStrips(0x2c4a24, 0x63854a, 0x3b3026),
  },
  {
    name: 'snag', punctuates: true, share: 0.35, patch: 0.05, clumping: 3,
    tolerates: 0.8, slope: 0.6, scale: [40, 68], sway: 0.008, casts: true,
    lush: 0x6b5a46, dry: 0x8a7a63,
    strips: () => snagStrips(0x6b5a46),
  },
];

/** Wind-bent coastal scrub: low, dense, leaning away from the sea. */
export const SEA_SCRUB: readonly Species[] = [
  {
    name: 'thrift', punctuates: false, share: 1, patch: 0.06, clumping: 1.4,
    tolerates: 0.62, slope: 0.85, scale: [0.7, 1.4], sway: 0.2, casts: false,
    lush: 0x5d7a46, dry: 0x8a9256,
    strips: () => spread(6, 0.4, (i, yaw, rootX, rootY) => ({
      rootX, rootY, yaw,
      tall: 0.55 + (i % 3) * 0.14, bend: 0.62,
      width: 0.04, taper: 0.2, segments: 3,
      root: 0x35502a, tip: 0x7f9450,
    })),
  },
  {
    name: 'gorse', punctuates: true, share: 0.5, patch: 0.09, clumping: 2.6,
    tolerates: 0.5, slope: 0.6, scale: [3.5, 7], sway: 0.03, casts: true,
    lush: 0x3d5230, dry: 0x6e6a3a,
    strips: () => spread(9, 0.55, (i, yaw, rootX, rootY) => ({
      rootX, rootY, yaw,
      tall: 0.5 + (i % 4) * 0.13, bend: 0.9,
      width: 0.07, taper: 0.35, leaf: 0.8, segments: 3,
      // Whin in flower, which is the one bright thing on a cliff top.
      root: 0x2c3d22, tip: i % 3 === 0 ? 0xc4a534 : 0x5f7a3c,
    })),
  },
];

/**
 * A forest floor: fern, bramble and the grass that survives in shade.
 *
 * <p>Sparser and darker than a meadow, and taller where it does grow — plants
 * under a canopy reach for what light there is, and a wood with a lawn under it
 * reads as a park.
 */
export const WOOD_FLOOR: readonly Species[] = [
  {
    name: 'shade grass', punctuates: false, share: 1, patch: 0.045, clumping: 1.6,
    tolerates: 0.5, slope: 0.8, scale: [0.9, 2.1], sway: 0.1, casts: false,
    lush: 0x486b3a, dry: 0x6a7c45,
    strips: () => spread(4, 0.5, (i, yaw, rootX, rootY) => ({
      rootX, rootY, yaw,
      tall: 0.9 + (i % 3) * 0.2, bend: 0.45,
      width: 0.045, taper: 0.14, segments: 3,
      root: 0x24381a, tip: 0x6d8a3f,
    })),
  },
  {
    // Fronds: long, low, pinnate enough at this distance to read from the
    // outline alone.
    name: 'fern', punctuates: false, share: 0.85, patch: 0.06, clumping: 2,
    tolerates: 0.6, slope: 0.7, scale: [1.6, 3.4], sway: 0.06, casts: false,
    lush: 0x3c6033, dry: 0x577a3c,
    strips: () => spread(6, 0.3, (i, yaw, rootX, rootY) => ({
      rootX, rootY, yaw,
      tall: 0.34, bend: 0, reach: 0.72 + (i % 3) * 0.12,
      width: 0.11, taper: 0.15, leaf: 0.75, segments: 4,
      root: 0x1f3a19, tip: 0x628a3c,
    })),
  },
  {
    name: 'bramble', punctuates: true, share: 0.5, patch: 0.08, clumping: 2.6,
    tolerates: 0.72, slope: 0.7, scale: [2.2, 4.6], sway: 0.05, casts: true,
    lush: 0x33512c, dry: 0x50663a,
    strips: () => spread(8, 0.6, (i, yaw, rootX, rootY) => ({
      rootX, rootY, yaw,
      tall: 0.3, bend: 0, reach: 0.8,
      width: 0.09, taper: 0.3, leaf: 0.85, segments: 3,
      root: 0x1d3318, tip: i % 4 === 0 ? 0x7a3a4a : 0x4e7034,
    })),
  },
  {
    // Toadstools, which are the one thing a wood floor has that nothing else
    // does, and are worth the fifty triangles.
    name: 'fungus', punctuates: true, share: 0.28, patch: 0.14, clumping: 4,
    tolerates: 0.66, slope: 0.5, scale: [0.6, 1.3], sway: 0, casts: false,
    lush: 0xd8c9a8, dry: 0xb07a4a,
    strips: () => [0, 1, 2].flatMap(cap => {
      const stalk = 0.34 + cap * 0.1;
      const at = cap * 2.3999;
      const rootX = Math.cos(at) * 0.16;
      const rootY = Math.sin(at) * 0.16;
      return [
        { rootX, rootY, yaw: at, tall: stalk, bend: 0.12, width: 0.03,
          taper: 0.7, segments: 2, root: 0x8f8168, tip: 0xd6c9ac },
        ...[0, 1, 2, 3].map(vane => ({
          rootX, rootY, yaw: at + vane * 1.5708,
          tall: -0.06, bend: 0, reach: 0.19,
          width: 0.14, taper: 0.6, leaf: 0.9, segments: 2,
          root: 0xa5643a, tip: 0xcf9a5e, lift: stalk,
        } as Strip & { lift: number })),
      ];
    }),
  },
];

/** Dry mountain tussock, for the bits of a snowfield the wind keeps clear. */
export const TUSSOCK: readonly Species[] = [
  {
    name: 'tussock', punctuates: false, share: 1, patch: 0.05, clumping: 2.2,
    // Only where the snow does not lie. Grass in a drift is grass under three
    // feet of snow, which is to say invisible.
    // On the scoured apron between the drifts and the rock, and nowhere else:
    // below 0.4 it is buried in snow, above 0.85 it is bare rock, and past a
    // slope of a half it is a face nothing roots on.
    needs: 0.4, tolerates: 0.85, slope: 0.5,
    scale: [1.1, 2.4], sway: 0.22, casts: false,
    lush: 0x7d7148, dry: 0xa39268,
    strips: () => spread(7, 0.35, (i, yaw, rootX, rootY) => ({
      rootX, rootY, yaw,
      tall: 0.8 + (i % 4) * 0.16, bend: 0.5,
      width: 0.035, taper: 0.12, segments: 3,
      root: 0x4a422a, tip: 0xb0a173,
    })),
  },
];

/**
 * Roots spread round a small disc rather than fanned off one point.
 *
 * <p>The same helper the meadow uses, and for the same reason: strips radiating
 * from a single origin at even angles make a star, and a field of identical
 * stars is a pattern.
 */
function spread<T>(
  count: number,
  radius: number,
  build: (i: number, yaw: number, rootX: number, rootY: number) => T,
): T[] {
  const made: T[] = [];
  for (let i = 0; i < count; i++) {
    const angle = i * 2.3999;
    const r = radius * (0.3 + ((i * 3) % 4) * 0.23);
    made.push(build(i, angle + 0.7, Math.cos(angle * 1.618) * r, Math.sin(angle * 1.618) * r));
  }
  return made;
}
