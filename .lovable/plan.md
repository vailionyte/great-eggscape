## Changes to `src/components/eggscape/Game.tsx`

1. **Unify hitboxes** — set `hitboxEgg: 0.55` and `hitboxObs: 0.22` on the `easy` config so both modes use the same collision box (currently Normal's values, the tighter/realistic ones).

2. **Rename Normal → Hard** in the UI only (label on the difficulty pill button). Internal keys stay `"easy" | "normal"` to avoid breaking `localStorage` values, config maps (`DIFFICULTY_CFG`, `POWERUP_INTERVAL`), refs, and the query-param parser.

No other tuning changes — Easy remains slower, wider gaps, smaller obstacles, more powerups, and free-hit; Hard keeps its faster ramp and no free hit.