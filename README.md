# Hearthvale

A cosy little 3D medieval village builder that runs in the browser. Build cottages, farms and fishing huts on a grassy meadow beside a lake, and watch the villagers go about their day.

Built with [three.js](https://threejs.org/) and [Vite](https://vitejs.dev/). All models, textures and sounds are generated in code, so there are no asset files.

## Running it

```bash
npm install
npm run dev          # open the printed localhost URL
```

Other scripts:

```bash
npm run build        # production build in dist/
npm run build:single # one self-contained HTML file in dist-single/ (easy to share)
npm run preview      # serve the production build
```

## How to play

The game switches between mouse and touch controls automatically, depending on what you last used.

### Mouse & keyboard

| Action | Controls |
|---|---|
| Pick a building | Click it in the bottom bar, or press `1`–`8` |
| Place | Click on the meadow (dragging moves the camera instead) |
| Rotate | `R`, or middle-click |
| Paint paths | Path tool, then click and drag |
| Demolish | `X`, then click a building or drag over paths (half the wood back) |
| Cancel | `Esc` or right-click |
| Move camera | Left-drag, `WASD` or arrow keys |
| Orbit | Right-drag, or `Q` / `E` |
| Zoom | Scroll wheel |
| Pause | `Space` |

### Touch

| Action | Gesture |
|---|---|
| Move camera | Drag with one finger (it glides a little when you let go) |
| Zoom / turn | Pinch, and twist two fingers |
| Build | Pick from the bar, drag the see-through building or tap the meadow to position it, then press **Build** |
| Rotate | ↻ button in the build bar |
| Paint paths | Drag one finger, or tap for a single tile. Two fingers still move the camera |
| Demolish | 🧹, then tap a building and confirm, or drag over paths to erase |
| Info | Tap a villager or building |
| Sound / graphics / help | ⚙️ button |

A touch only counts as a tap if the finger barely moves, lifts quickly and no second finger joins, so moving the camera never builds or selects anything by accident.

### Buildings

| | Building | Cost | What it does |
|---|---|---|---|
| 👣 | Path | free | Villagers walk faster on paths and prefer them |
| 🏡 | Cottage | 10 🪵 | Home for 3 villagers. New families move in over time |
| 🌾 | Wheat Farm | 8 🪵 | 2 farmers grow wheat and deliver food |
| 🪓 | Woodcutter | 5 🪵 | Fells nearby trees for wood. Stumps grow back |
| 🎣 | Fishing Hut | 8 🪵 | A fisher catches fish from the shore. Must be built beside the lake |
| 🪣 | Well | 4 🪵 | Villagers gather here to chat. Adds cosiness |
| 🌷 | Flower Bed | 1 🪵 | Adds cosiness |
| 🏮 | Lantern | 2 🪵 | Glows at night. Adds cosiness |

Villagers pick up jobs on their own, carry goods to the storehouse, and head home to sleep when the lanterns come on. The village needs a little food each morning. A cosier village (wells, flowers, lanterns, paths, full bellies) attracts new families faster.

The game saves to the browser's local storage every 20 seconds. If it runs slowly, the ✨ button switches to lighter graphics. It also switches automatically when the frame rate drops.

## Code layout

```
src/
  main.js         game loop, input, placement, save/load, post-processing
  terrain.js      height field, lake, grid and terrain shader (soft dirt paths, placement grid)
  water.js        stylised lake shader (depth colour, shoreline foam, sparkles)
  nature.js       instanced trees, grass, flowers, rocks, reeds, lily pads
  buildings.js    building definitions, placement rules, animations, smoke and crops
  models.js       procedural low-poly models built from rounded primitives
  villagers.js    villager models, A* pathing, job/sleep behaviour
  fish.js         fish swimming and jumping in the lake
  sky.js          day/night palette, sun/moon, sky dome, clouds
  camera.js       smooth damped orbit camera with pan inertia
  input.js        separate mouse and touch gesture handling
  particles.js    smoke, dust, splashes, fireflies, ripples
  audio.js        synthesised sound effects, ambience and music
  ui.js           HUD, toolbar, toasts and tooltips
```
