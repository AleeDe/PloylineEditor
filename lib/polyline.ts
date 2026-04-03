export type EditorMode = 'begin' | 'delete' | 'move' | 'refresh' | 'quit' | 'insert' | 'hand';

export type Vertex3D = {
  x: number;
  y: number;
  z: number;
};

export type Polyline = {
  id: string;
  vertices: Vertex3D[];
  closed?: boolean;
};

export type ClosestVertex = {
  polyIndex: number;
  vertexIndex: number;
  dist: number;
} | null;

export const MAX_POLYLINES = 100;
export const SNAP_DISTANCE = 20;

export const MODE_KEY_MAP: Record<string, EditorMode> = {
  b: 'begin',
  d: 'delete',
  m: 'move',
  h: 'hand',
  r: 'refresh',
  q: 'quit',
  i: 'insert',
};

export const deepClonePolys = (polys: Polyline[]): Polyline[] =>
  polys.map((poly) => ({
    ...poly,
    vertices: poly.vertices.map((v) => ({ ...v })),
  }));

export const toScreenY = (y: number, z: number) => y - z * 0.45;
