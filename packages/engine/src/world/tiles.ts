export const enum Tile {
  Grass = 0,
  Road = 1,
  Wood = 2,
  Concrete = 3,
  Wall = 4,
  Window = 5,
  Tree = 6,
  Car = 7,
  Fence = 8,
  Dirt = 9,
  Border = 10,
  /** Sea or river: can't be walked, seen and shot across. */
  Water = 11,
  /** Railway track on gravel: walkable. */
  Rail = 12,
  /** A shipping container stack: solid, blocks sight and bullets. */
  Container = 13,
  /** A locked steel door (see GameMap.doors): solid and opaque until a key opens it, then floor again. */
  LockedDoor = 14,
}

/** Movement blocked. */
export const SOLID = new Uint8Array(16);
/** Vision / bullets blocked. */
export const OPAQUE = new Uint8Array(16);
/** Gives cover: blocks bullets, but you can see over it. */
export const COVER = new Uint8Array(16);

for (const t of [Tile.Wall, Tile.Window, Tile.Tree, Tile.Car, Tile.Fence, Tile.Border, Tile.Water, Tile.Container, Tile.LockedDoor]) SOLID[t] = 1;
for (const t of [Tile.Wall, Tile.Border, Tile.Container, Tile.LockedDoor]) OPAQUE[t] = 1;
for (const t of [Tile.Wall, Tile.Border, Tile.Car, Tile.Tree, Tile.Container, Tile.LockedDoor]) COVER[t] = 1;

export const isFloorTile = (t: Tile) => t === Tile.Wood || t === Tile.Concrete;
