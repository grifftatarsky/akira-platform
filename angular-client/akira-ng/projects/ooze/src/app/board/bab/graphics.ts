import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import { CascadedShadowGenerator } from '@babylonjs/core/Lights/Shadows/cascadedShadowGenerator';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { Scene } from '@babylonjs/core/scene';
import { DepthOfFieldEffectBlurLevel } from '@babylonjs/core/PostProcesses/depthOfFieldEffect';

import '@babylonjs/core/Rendering/depthRendererSceneComponent';

import type { Effects } from './effects';
import type { FastGrass } from './grass-fast';
import type { Meadow } from './meadow';
import type { Stage } from './stage';
import type { Terrain } from './terrain';

export type Setting = boolean | number | string;

export interface Switch {
  readonly kind: 'switch';
  readonly key: string;
  readonly label: string;
  readonly note: string;
  readonly cost?: string;
  readonly fallback: boolean;
}

export interface Pick {
  readonly kind: 'pick';
  readonly key: string;
  readonly label: string;
  readonly note: string;
  readonly cost?: string;
  readonly fallback: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
}

export interface Dial {
  readonly kind: 'dial';
  readonly key: string;
  readonly label: string;
  readonly note: string;
  readonly fallback: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit?: string;
}

export type Knob = Switch | Pick | Dial;

export interface Bank {
  readonly title: string;
  readonly note: string;
  readonly knobs: readonly Knob[];
}

function pick(
  key: string, label: string, fallback: string, options: readonly [string, string][],
  note: string, cost?: string,
): Pick {
  return {
    kind: 'pick', key, label, fallback, note, cost,
    options: options.map(([value, name]) => ({ value, label: name })),
  };
}

function dial(
  key: string, label: string, fallback: number, min: number, max: number,
  step: number, note: string, unit = '%',
): Dial {
  return { kind: 'dial', key, label, fallback, min, max, step, note, unit };
}

function flip(
  key: string, label: string, fallback: boolean, note: string, cost?: string,
): Switch {
  return { kind: 'switch', key, label, fallback, note, cost };
}

export const BANKS: readonly Bank[] = [
  {
    title: 'edges',
    note: 'What smooths the step between one blade and the next. Temporal aa is the only one on, and it is what stops the field crawling.',
    knobs: [
      flip('taa', 'temporal aa', true, 'Averages jittered frames over time. It is the only anti-aliasing here: off, edge contrast rises from 17.9 to 22.4.', '+1.8 ms'),
      dial('taaSamples', 'taa samples', 16, 2, 32, 2, 'How many sub-pixel positions the jitter walks before repeating. More is smoother and slower to converge.', ''),
      dial('taaFactor', 'taa blend', 16, 2, 60, 2, 'How much of each new frame replaces the history. Low is smooth and smears; high is sharp and crawls.'),
      flip('taaOnMove', 'taa while moving', false, 'Off by default: the resolve is suspended while the camera moves, because a moving history ghosts. On keeps it running through pans, which is smoother and smears.'),
      flip('msaa', 'msaa ×2', false, 'Multisampling on the temporal resolve target. It needs temporal aa on — with it off this does nothing at all.', '+4.6 ms'),
      flip('fxaa', 'fxaa', false, 'A single-frame edge filter. It does not ghost, so it is the answer for a camera that is always moving — and it softens fine grass rather than resolving it.'),
    ],
  },
  {
    title: 'light and shade',
    note: 'The shadow map, the occlusion and the shafts. Everything here costs a frame.',
    knobs: [
      flip('ao', 'ambient occlusion', false, 'Contact darkening where geometry meets geometry. Read from a half-resolution depth and normal buffer; leaving the grass out of that buffer takes it from 26.9 ms to 8.4 and takes most of what you can see with it.', '+8.4 / +26.9 ms'),
      pick('aoReads', 'occlusion reads', 'all', [['solid', 'ground only'], ['all', 'grass too']],
        'Which meshes feed the depth and normal buffer the occlusion is read from.'),
      flip('rays', 'god rays', false, 'Shafts from a real sun disc, scattered around whatever stands in front of it. Worth having at a low sun; at noon nothing is in front of the sun.', '+4.6 ms'),
      flip('grassShade', 'grass shadows', false, 'Lets the grass receive the shadow map, so tree shadows fall across the field instead of stopping at the ground under it. Turns fast grass off, which cannot receive.', '+8.3 ms'),
      pick('grassCasts', 'grass shadows cast', 'solid', [['solid', 'trees and stone'], ['all', 'everything']],
        'Everything keeps the lifted proxy casting, which puts the field’s shadow on the road and darkens every blade under it.'),
      pick('shadowSize', 'shadow map', '2048', [['1024', '1024'], ['2048', '2048'], ['4096', '4096']],
        'The cascade texture, per cascade. 4096 is four times the memory and the fill.'),
      pick('cascades', 'cascades', '2', [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']],
        'How many depth slices the shadow map is split into. More is sharper near the camera and one more full pass over every caster.'),
      pick('shadowFilter', 'shadow filter', 'pcf', [['none', 'hard'], ['pcf', 'pcf'], ['pcss', 'contact hardening'], ['poisson', 'poisson']],
        'Contact hardening widens the penumbra with distance from the caster, which is what a real shadow does and what a tree canopy needs.'),
      pick('shadowQuality', 'shadow filter quality', 'medium', [['low', 'low'], ['medium', 'medium'], ['high', 'high']],
        'Taps per shadow sample. Low with pcf runs at medium instead: Babylon 9.26 emits invalid WGSL for the one-tap cascaded PCF path, so that pairing is not available. Low with contact hardening or poisson is fine.'),
      dial('shadowBlend', 'cascade blend', 15, 0, 60, 1, 'How far the cascades cross-fade into each other. Zero shows the seam as a line across the field.'),
      dial('shadowDark', 'shadow darkness', 0, 0, 90, 5, 'Lifts the shadowed side toward the lit one. Zero is a full shadow.'),
      flip('shadowBounds', 'fit cascades to depth', false, 'Recomputes the cascade split from the actual depth range each frame. Sharper shadows, one depth pass.'),
      dial('skyLight', 'sky light', 45, 0, 150, 5, 'Image-based light from the sky probe, on the ground and the scans. The grass opts out of it deliberately.'),
    ],
  },
  {
    title: 'the grade',
    note: 'Tone, colour and the post chain. None of it is a new pass over the geometry, so most of it is close to free.',
    knobs: [
      pick('tone', 'tone mapping', 'neutral', [['off', 'none'], ['standard', 'standard'], ['aces', 'aces'], ['neutral', 'khr pbr neutral']],
        'How high dynamic range is folded into the screen. Standard clips hard, ACES is filmic and desaturates the top, KHR PBR Neutral holds hue.'),
      dial('exposure', 'exposure', 100, 40, 220, 5, 'On top of the clock’s own exposure, which already tracks the sun’s elevation.'),
      dial('contrast', 'contrast', 100, 60, 180, 5, 'On top of the board’s 1.4. Straight down a meadow is all tips and no shade, which is why it is high to begin with.'),
      dial('vignette', 'vignette', 100, 0, 300, 10, 'On top of the board’s 0.1. A summer afternoon is not a mood.'),
      flip('white', 'white balance', false, 'Warms or cools the whole frame independently of the sun’s own colour.'),
      dial('temperature', 'temperature', 60, 0, 100, 1, 'Cool to warm. Only applies with white balance on.', ''),
      dial('tint', 'tint', 0, -50, 50, 1, 'Green to magenta. Only applies with white balance on.', ''),
      dial('dither', 'dither', 0, 0, 100, 5, 'Breaks up the eight-bit banding in the sky gradient with noise below one level.'),
      flip('bloom', 'bloom', false, 'Light spilling around bright edges. Nothing on a midday meadow is bright enough — measured, everything sits under 0.4 luminance. It is here for torches and fire.', '+1.6 ms'),
      dial('bloomThreshold', 'bloom threshold', 86, 0, 100, 2, 'Luminance a pixel has to clear before it blooms.'),
      dial('bloomWeight', 'bloom strength', 34, 0, 150, 2, 'How much of the blurred highlight is added back.'),
      dial('bloomKernel', 'bloom spread', 32, 8, 128, 8, 'The blur kernel, in pixels.', 'px'),
      flip('glow', 'glow layer', false, 'A second pass that blooms only what a material marks as emissive, rather than whatever is bright. For torches, runes and spell effects.'),
      dial('glowStrength', 'glow strength', 100, 0, 300, 10, 'Only applies with the glow layer on.'),
      flip('grain', 'grain', false, 'Film grain over the whole frame. Hides banding, costs nothing.'),
      dial('grainAmount', 'grain strength', 12, 0, 60, 1, 'Only applies with grain on.'),
      flip('sharpen', 'sharpen', false, 'An unsharp mask on the finished frame. This is the half of an upscaler that is free — pair it with render scale below 100%.'),
      dial('sharpenAmount', 'sharpen strength', 30, 0, 100, 5, 'Only applies with sharpen on.'),
      flip('aberration', 'chromatic aberration', false, 'Splits the channels toward the edge of the frame, the way a cheap lens does.'),
      dial('aberrationAmount', 'aberration strength', 30, 0, 100, 5, 'Only applies with chromatic aberration on.'),
    ],
  },
  {
    title: 'air and lens',
    note: 'Distance haze and the camera’s own optics. Depth of field needs a depth pass, so it is the only one here that is not free.',
    knobs: [
      pick('fog', 'fog', 'off', [['off', 'off'], ['linear', 'linear'], ['exp', 'exponential'], ['exp2', 'exponential²']],
        'Distance haze, coloured by the clock so it warms at dusk. Linear takes a start and an end; the exponentials take a density.'),
      dial('fogDensity', 'fog density', 10, 0, 100, 1, 'For the exponential modes. Linear uses the camera’s far plane instead.'),
      flip('dof', 'depth of field', false, 'Throws everything but the focus plane out of focus — the tilt-shift look that makes a board read as a model. Needs a depth pass over the whole scene.'),
      pick('dofBlur', 'depth of field quality', 'low', [['low', 'low'], ['medium', 'medium'], ['high', 'high']],
        'How many taps the bokeh blur takes.'),
      dial('dofFocus', 'focus distance', 150, 10, 600, 10, 'Half-feet from the camera to the plane that stays sharp.', 'hf'),
      dial('dofStop', 'aperture', 14, 1, 60, 1, 'f-stop ×10. Lower is a shallower field and more blur.', ''),
      dial('dofLens', 'lens size', 50, 5, 200, 5, 'How wide the bokeh circle grows.', ''),
    ],
  },
  {
    title: 'the field',
    note: 'The meadow and the ground themselves, rather than the frame they are drawn into.',
    knobs: [
      flip('fast', 'fast grass', false, 'Swaps the grass off PBR onto a shader written for it. The wind, the leaf-normal blend, the per-plant tint and the base-to-tip ramp carry over unchanged. It cannot receive the shadow map, so it and grass shadows turn each other off.', '−3.2 ms'),
      pick('fastLit', 'fast grass lit', 'match', [['match', 'matched'], ['flat', 'no sheen']],
        'Matched keeps the GGX highlight, which is where the sky’s blue reaches a green field, and is 1.7 of the 4.8 ms this material saves.'),
      dial('cutoff', 'leaf cut-out', 28, 5, 70, 1, 'How opaque a texel has to be to survive the alpha test. Low keeps more leaf and more fringe; high eats the thin tips.'),
      dial('roughness', 'leaf roughness', 55, 5, 100, 5, 'How wide the highlight on a blade spreads. Low is wet and waxy, high is dry and matte.'),
      dial('relief', 'ground relief', 85, 0, 200, 5, 'The strength of the terrain’s normal map. This is what the ruts in the road are made of.'),
      pick('aniso', 'texture sharpness', '8', [['1', 'off'], ['4', '4×'], ['8', '8×'], ['16', '16×']],
        'Anisotropic filtering. It only shows at a grazing angle, which on a top-down board is the horizon and the road running away from you.'),
    ],
  },
  {
    title: 'resolution',
    note: 'The last resort and the largest lever. Everything above is drawn into whatever this leaves.',
    knobs: [
      pick('scale', 'render scale', '100',
        [['100', '100%'], ['85', '85%'], ['75', '75%'], ['60', '60%'], ['50', '50%']],
        'Renders at a fraction of the canvas and scales up. Not linear in pixels: a quarter of the pixels buys 31% of the frame, because the vertex work, the culling and the shadow map do not scale with the render target. 27.9 ms at 100%, 19.1 at 50%.',
        '27.9 → 19.1 ms'),
    ],
  },
];

const FALLBACKS: Record<string, Setting> = {};
for (const bank of BANKS) {
  for (const knob of bank.knobs) {
    FALLBACKS[knob.key] = knob.fallback;
  }
}

export const DEFAULTS: Readonly<Record<string, Setting>> = FALLBACKS;

export interface Field {
  readonly stage: Stage;
  readonly effects: Effects;
  readonly quick: FastGrass;
  readonly meadow: Meadow;
  readonly terrain: Terrain;
}

const TONES: Record<string, number> = {
  standard: ImageProcessingConfiguration.TONEMAPPING_STANDARD,
  aces: ImageProcessingConfiguration.TONEMAPPING_ACES,
  neutral: ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL,
};

const QUALITIES: Record<string, number> = {
  low: ShadowGenerator.QUALITY_LOW,
  medium: ShadowGenerator.QUALITY_MEDIUM,
  high: ShadowGenerator.QUALITY_HIGH,
};

const BLURS: Record<string, DepthOfFieldEffectBlurLevel> = {
  low: DepthOfFieldEffectBlurLevel.Low,
  medium: DepthOfFieldEffectBlurLevel.Medium,
  high: DepthOfFieldEffectBlurLevel.High,
};

export class Graphics {

  constructor(private readonly field: Field) { }

  apply(key: string, value: Setting, all: Readonly<Record<string, Setting>>): void {
    const { stage, effects, quick, meadow, terrain } = this.field;
    const scene = stage.scene;
    const taa = stage.taa;
    const post = stage.bloom;
    const shadows = stage.shadows;
    const number = typeof value === 'number' ? value : Number(value);
    const on = value === true;

    switch (key) {
      case 'taa': stage.setResolve(on); break;
      case 'taaSamples': taa.samples = Math.max(1, Math.round(number)); break;
      case 'taaFactor': taa.factor = number / 100; break;
      case 'taaOnMove': taa.disableOnCameraMove = !on; break;
      case 'msaa': stage.setMsaa(on ? 2 : 1); break;
      case 'fxaa': if (post) { post.fxaaEnabled = on; } break;

      case 'ao':
        effects.setAoOverGrass(all['aoReads'] !== 'solid');
        void effects.setAmbientOcclusion(on);
        break;
      case 'aoReads': effects.setAoOverGrass(value !== 'solid'); break;
      case 'rays': effects.setGodRays(on); break;
      case 'grassShade':
        effects.setGrassFromSelf(all['grassCasts'] === 'all');
        effects.setGrassShadows(on);
        break;
      case 'grassCasts': effects.setGrassFromSelf(value === 'all'); break;
      case 'shadowSize': shadows.mapSize = number; break;
      case 'cascades': shadows.numCascades = Math.max(1, Math.min(4, number)); break;
      case 'shadowFilter':
        this.filter(String(value), String(all['shadowQuality'] ?? 'medium'));
        break;
      case 'shadowQuality':
        this.filter(String(all['shadowFilter'] ?? 'pcf'), String(value));
        break;
      case 'shadowBlend': shadows.cascadeBlendPercentage = number / 100; break;
      case 'shadowDark': shadows.setDarkness(number / 100); break;
      case 'shadowBounds': shadows.autoCalcDepthBounds = on; break;
      case 'skyLight': scene.environmentIntensity = number / 100; break;

      case 'tone': {
        const image = scene.imageProcessingConfiguration;
        image.toneMappingEnabled = value !== 'off';
        image.toneMappingType = TONES[String(value)] ?? TONES['neutral'];
        break;
      }
      case 'exposure': stage.exposureTrim = number / 100; stage.regrade(); break;
      case 'contrast': stage.contrastTrim = number / 100; stage.regrade(); break;
      case 'vignette': stage.vignetteTrim = number / 100; stage.regrade(); break;
      case 'white': scene.imageProcessingConfiguration.whiteBalanceEnabled = on; break;
      case 'temperature': scene.imageProcessingConfiguration.temperature = number; break;
      case 'tint': scene.imageProcessingConfiguration.tint = number; break;
      case 'dither': {
        const image = scene.imageProcessingConfiguration;
        image.ditheringEnabled = number > 0;
        image.ditheringIntensity = number / 100;
        break;
      }
      case 'bloom': if (post) { post.bloomEnabled = on; } break;
      case 'bloomThreshold': if (post) { post.bloomThreshold = number / 100; } break;
      case 'bloomWeight': if (post) { post.bloomWeight = number / 100; } break;
      case 'bloomKernel': if (post) { post.bloomKernel = number; } break;
      case 'glow': if (post) { post.glowLayerEnabled = on; } break;
      case 'glowStrength':
        if (post?.glowLayer) { post.glowLayer.intensity = number / 100; }
        break;
      case 'grain': if (post) { post.grainEnabled = on; } break;
      case 'grainAmount': if (post) { post.grain.intensity = number; } break;
      case 'sharpen': if (post) { post.sharpenEnabled = on; } break;
      case 'sharpenAmount':
        if (post) {
          post.sharpen.edgeAmount = number / 100;
          post.sharpen.colorAmount = 1;
        }
        break;
      case 'aberration': if (post) { post.chromaticAberrationEnabled = on; } break;
      case 'aberrationAmount':
        if (post) { post.chromaticAberration.aberrationAmount = number; }
        break;

      case 'fog': this.fog(String(value), Number(all['fogDensity'] ?? 10)); break;
      case 'fogDensity': this.fog(String(all['fog'] ?? 'off'), number); break;
      case 'dof': if (post) { post.depthOfFieldEnabled = on; } break;
      case 'dofBlur':
        if (post) { post.depthOfFieldBlurLevel = BLURS[String(value)] ?? BLURS['low']; }
        break;
      case 'dofFocus': if (post) { post.depthOfField.focusDistance = number * 100; } break;
      case 'dofStop': if (post) { post.depthOfField.fStop = number / 10; } break;
      case 'dofLens': if (post) { post.depthOfField.lensSize = number; } break;

      case 'fast': quick.sheen(all['fastLit'] !== 'flat'); quick.on(on); break;
      case 'fastLit': quick.sheen(value !== 'flat'); break;
      case 'cutoff':
        for (const sown of meadow.sown) {
          const paint = sown.mesh.material as PBRMaterial | null;
          if (paint instanceof PBRMaterial) {
            paint.alphaCutOff = number / 100;
          }
        }
        quick.cutoff(number / 100);
        break;
      case 'roughness':
        for (const sown of meadow.sown) {
          const paint = sown.mesh.material as PBRMaterial | null;
          if (paint instanceof PBRMaterial) {
            paint.roughness = number / 100;
          }
        }
        break;
      case 'relief': {
        const relief = terrain.material.bumpTexture;
        if (relief) {
          relief.level = number / 100;
        }
        break;
      }
      case 'aniso':
        for (const texture of scene.textures as BaseTexture[]) {
          texture.anisotropicFilteringLevel = number;
        }
        break;

      case 'scale': stage.setRenderScale(number / 100); break;
    }
  }

  private filter(how: string, quality: string): void {
    const shadows = this.field.stage.shadows;

    const safe = how === 'pcf' && quality === 'low' ? 'medium' : quality;
    shadows.filteringQuality = QUALITIES[safe] ?? ShadowGenerator.QUALITY_MEDIUM;
    shadows.usePercentageCloserFiltering = false;
    shadows.useContactHardeningShadow = false;
    shadows.usePoissonSampling = false;
    if (how === 'pcf') {
      shadows.usePercentageCloserFiltering = true;
    } else if (how === 'pcss') {
      shadows.useContactHardeningShadow = true;
      shadows.contactHardeningLightSizeUVRatio = 0.06;
    } else if (how === 'poisson') {
      shadows.usePoissonSampling = true;
    } else {
      shadows.filter = CascadedShadowGenerator.FILTER_NONE;
    }
  }

  private fog(how: string, density: number): void {
    const scene = this.field.stage.scene;
    const modes: Record<string, number> = {
      off: Scene.FOGMODE_NONE,
      linear: Scene.FOGMODE_LINEAR,
      exp: Scene.FOGMODE_EXP,
      exp2: Scene.FOGMODE_EXP2,
    };
    scene.fogMode = modes[how] ?? Scene.FOGMODE_NONE;
    scene.fogDensity = (density / 100) * 0.01;
    const camera = this.field.stage.camera;
    scene.fogStart = camera.maxZ * 0.08;
    scene.fogEnd = camera.maxZ * 0.55;
    const lit = scene.fogMode !== Scene.FOGMODE_NONE;
    for (const mesh of scene.meshes) {
      const paint = mesh.material;
      if (paint) {
        paint.fogEnabled = lit;
      }
    }
  }
}
