# How Fluoddity works

Fluoddity is a human-guided evolutionary particle system, implemented almost
entirely as WebGPU work. At full world size it advances 600,000 persistent
particles over a 1024 x 1024 double-buffered trail texture.

## State

- Each particle is 32 bytes: position, velocity, sprite size, config index, and
  two raw color signals.
- The shared trail canvas is `rg16float`. Its two channels store a velocity
  vector, not pigment or occupancy.
- A behavior rule is 80 float32 values: ten Fourier centers, each with a 4D
  frequency vector and a 4D amplitude vector.
- World settings control trail persistence, diffusion, scale, and edge behavior.

The particles never query one another directly. Their only communication is the
velocity field they collectively write and later sense.

## One physics substep

1. Every particle samples the trail vector at two points, rotated left and right
   from its current velocity direction.
2. Those two 2D readings become one 4D input. Ten sinusoidal Fourier features
   map it to four outputs. Evaluating the rule a second time in mirrored local
   coordinates and combining the results removes systematic left/right handedness.
3. Two outputs accelerate velocity. Two are a direct positional displacement
   called `strafe`; it lets a particle move sideways without first turning its
   velocity vector.
4. Drag, optional gravity, painted displacement fields, cohort fences, and the
   selected edge rule are applied.
5. A fullscreen pass diffuses the trail canvas with a five-tap cross and decays
   it by trail persistence, then swaps the front and back textures.
6. Every particle additively splats a small Gaussian carrying its velocity into
   the new front texture.

The feedback loop is therefore:

```text
particle motion -> vector trails -> two local sensors -> Fourier rule
       ^                                             |
       +-------------- force and strafe -------------+
```

The order is deliberately update particles, diffuse/decay, then splat. It looks
slightly backward, but changing it changes the historical preset behaviors.

## Why it looks alive

The field is memory, transport medium, and interaction channel at once. A small
turn changes the trail; the trail changes where nearby particles look; that
changes their turn. Stable loops, moving fronts, membranes, branches, and
fission-like instabilities can all become attractors of that feedback system.

The visible colors are mostly a rendering of behavior rather than four chemical
species. Particle view turns either a raw rule output or cohort identity into
hue. Trail view instead maps trail-vector direction to hue and magnitude to
brightness, then applies motion accumulation, bloom, exposure, and an `asinh`
tone curve.

## What “lineage” means here

Particles are assigned fixed cohorts by index. Each cohort gets a deterministic,
seeded mutation of the same base 80-float rule. Selecting a cohort asks the GPU
to derive the exact rule that cohort obeys, adopts it as the new base rule, and
resets the population so a fresh set of mutated children can be compared.

That is genuine interactive artificial selection, but not autonomous Darwinian
evolution inside a run. Cohort sizes do not grow, particles do not reproduce,
and Corally's hazard rate is zero. A shape that divides is a self-organized
particle/trail morphology splitting while its underlying particle population
remains fixed.

## Corally specifically

- one authored behavior rule;
- four equal cohorts, initially placed in a 2 x 2 grid;
- mutation scale `0.133`, mutation seed `0.3951658881798008`;
- trail persistence `0.9430000185966492`, diffusion `1`;
- wrapping world boundary;
- no cohort fences, hazard resets, or gravity;
- per-step distance-sensor jitter `0.3804347826086957`.

The four quadrants are therefore four nearby descendants of one behavioral rule.
Their radically different macroscopic bodies are the genotype-to-dynamics map
amplifying small coefficient changes.

## Reproducibility boundary

The share fragment saves the genotype and physics, not a simulation snapshot.
It omits particle state, the trail texture, frame number, display preferences,
and hardware calibration. This checkout can reproduce the exact deployed program
bytes and exact starting payload, but a frame-for-frame trajectory can still
diverge across GPU implementations or different physics rates.
