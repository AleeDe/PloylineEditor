'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CircleDashed,
  Eraser,
  GitBranchPlus,
  Grab,
  Hand,
  Maximize2,
  Moon,
  Redo2,
  RefreshCw,
  Save,
  Sun,
  Undo2,
  Upload,
  XCircle,
} from 'lucide-react';
import { ControlButton } from '@/components/ControlButton';
import {
  deepClonePolys,
  MAX_POLYLINES,
  MODE_KEY_MAP,
  type ClosestVertex,
  type EditorMode,
  type Polyline,
  SNAP_DISTANCE,
  toScreenY,
  type Vertex3D,
} from '@/lib/polyline';

type Point2D = { x: number; y: number };
type Theme = 'light' | 'dark';
type Camera = { scale: number; offsetX: number; offsetY: number };

type SegmentHit = {
  polyIndex: number;
  insertAt: number;
  point: Vertex3D;
  dist: number;
} | null;

const MODE_LABEL: Record<EditorMode, string> = {
  begin: 'Begin',
  delete: 'Delete',
  move: 'Move',
  hand: 'Hand',
  refresh: 'Refresh',
  quit: 'Quit',
  insert: 'Insert',
};

const STORAGE_KEY = 'polyline-editor-file';
const DUPLICATE_VERTEX_DISTANCE = 10;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 6;

const createId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `poly-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function getDistance(a: Point2D, b: Point2D) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function projectVertex(vertex: Vertex3D): Point2D {
  return { x: vertex.x, y: toScreenY(vertex.y, vertex.z) };
}

function findClosestVertex(polys: Polyline[], point: Point2D): ClosestVertex {
  let best: ClosestVertex = null;

  polys.forEach((poly, polyIndex) => {
    poly.vertices.forEach((vertex, vertexIndex) => {
      const dist = getDistance({ x: vertex.x, y: toScreenY(vertex.y, vertex.z) }, point);
      if (!best || dist < best.dist) {
        best = { polyIndex, vertexIndex, dist };
      }
    });
  });

  return best;
}

function closestSegment(polys: Polyline[], point: Point2D): SegmentHit {
  let best: SegmentHit = null;

  const considerSegment = (polyIndex: number, insertAt: number, a: Vertex3D, b: Vertex3D) => {
    const ay = toScreenY(a.y, a.z);
    const by = toScreenY(b.y, b.z);
    const abx = b.x - a.x;
    const aby = by - ay;
    const apx = point.x - a.x;
    const apy = point.y - ay;
    const denom = abx * abx + aby * aby;
    if (denom === 0) {
      return;
    }

    const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / denom));
    const px = a.x + abx * t;
    const py = ay + aby * t;
    const dist = getDistance(point, { x: px, y: py });

    if (!best || dist < best.dist) {
      best = {
        polyIndex,
        insertAt,
        point: {
          x: px,
          y: a.y + (b.y - a.y) * t,
          z: a.z + (b.z - a.z) * t,
        },
        dist,
      };
    }
  };

  polys.forEach((poly, polyIndex) => {
    for (let i = 0; i < poly.vertices.length - 1; i += 1) {
      const a = poly.vertices[i];
      const b = poly.vertices[i + 1];
      considerSegment(polyIndex, i + 1, a, b);
    }

    if (poly.closed && poly.vertices.length > 2) {
      const last = poly.vertices[poly.vertices.length - 1];
      const first = poly.vertices[0];
      considerSegment(polyIndex, poly.vertices.length, last, first);
    }
  });

  return best;
}

export function PolylineEditor() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const [mode, setMode] = useState<EditorMode>('begin');
  const [theme, setTheme] = useState<Theme>('light');
  const [polys, setPolys] = useState<Polyline[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hover, setHover] = useState<Point2D | null>(null);
  const [closest, setClosest] = useState<ClosestVertex>(null);
  const [dragging, setDragging] = useState<{ polyIndex: number; vertexIndex: number } | null>(null);
  const [activePolylineId, setActivePolylineId] = useState<string | null>(null);
  const [newPolylineOnClick, setNewPolylineOnClick] = useState(true);
  const [quit, setQuit] = useState(false);
  const [past, setPast] = useState<Polyline[][]>([]);
  const [future, setFuture] = useState<Polyline[][]>([]);
  const [size, setSize] = useState({ width: 1000, height: 620 });
  const [fx, setFx] = useState<{ x: number; y: number; key: number } | null>(null);
  const [camera, setCamera] = useState<Camera>({ scale: 1, offsetX: 0, offsetY: 0 });
  const [panning, setPanning] = useState<{ start: Point2D; cameraStart: Camera } | null>(null);

  const enterQuitMode = useCallback(() => {
    setPolys([]);
    setPast([]);
    setFuture([]);
    setActivePolylineId(null);
    setNewPolylineOnClick(true);
    setClosest(null);
    setHover(null);
    setDragging(null);
    setFx(null);
    setQuit(true);
    setMode('quit');
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Polyline[];
      if (Array.isArray(parsed)) {
        setPolys(parsed.slice(0, MAX_POLYLINES));
      }
    } catch {
      // Keep startup resilient even if saved file is malformed.
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(polys));
  }, [polys]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      setSize({
        width: Math.max(320, Math.floor(entry.contentRect.width)),
        height: Math.max(360, Math.floor(entry.contentRect.height)),
      });
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const selectedVertexCount = useMemo(() => {
    if (closest) {
      return polys[closest.polyIndex]?.vertices.length ?? 0;
    }
    if (!activePolylineId) {
      return 0;
    }
    return polys.find((poly) => poly.id === activePolylineId)?.vertices.length ?? 0;
  }, [activePolylineId, closest, polys]);

  const worldToScreen = useCallback(
    (point: Point2D): Point2D => ({
      x: point.x * camera.scale + camera.offsetX,
      y: point.y * camera.scale + camera.offsetY,
    }),
    [camera],
  );

  const screenToWorld = useCallback(
    (point: Point2D): Point2D => ({
      x: (point.x - camera.offsetX) / camera.scale,
      y: (point.y - camera.offsetY) / camera.scale,
    }),
    [camera],
  );

  const getWorldBounds = useCallback(() => {
    const projected = polys.flatMap((poly) => poly.vertices.map((vertex) => projectVertex(vertex)));
    if (projected.length === 0) {
      return null;
    }
    let minX = projected[0].x;
    let maxX = projected[0].x;
    let minY = projected[0].y;
    let maxY = projected[0].y;
    projected.forEach((point) => {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    });
    return { minX, maxX, minY, maxY };
  }, [polys]);

  const fitToScreen = useCallback(() => {
    const bounds = getWorldBounds();
    if (!bounds) {
      setCamera({ scale: 1, offsetX: 0, offsetY: 0 });
      return;
    }
    const width = Math.max(1, bounds.maxX - bounds.minX);
    const height = Math.max(1, bounds.maxY - bounds.minY);
    const paddedWidth = width + 80;
    const paddedHeight = height + 80;
    const nextScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(size.width / paddedWidth, size.height / paddedHeight)));
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    setCamera({
      scale: nextScale,
      offsetX: size.width / 2 - centerX * nextScale,
      offsetY: size.height / 2 - centerY * nextScale,
    });
  }, [getWorldBounds, size.height, size.width]);

  const applyChange = useCallback((mutate: (draft: Polyline[]) => Polyline[]) => {
    setPolys((prev) => {
      const before = deepClonePolys(prev);
      const next = mutate(deepClonePolys(prev));
      if (JSON.stringify(before) === JSON.stringify(next)) {
        return prev;
      }
      setPast((old) => [...old.slice(-149), before]);
      setFuture([]);
      return next;
    });
  }, []);

  const refreshEditor = useCallback(() => {
    setQuit(false);
    setIsRefreshing(true);
    setFx({ x: 30, y: 30, key: Date.now() });
    setMode('refresh');

    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
    }

    refreshTimerRef.current = window.setTimeout(() => {
      setIsRefreshing(false);
      setMode('hand');
      refreshTimerRef.current = null;
    }, 220);
  }, []);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  const undo = useCallback(() => {
    if (past.length === 0) {
      return;
    }
    const previous = past[past.length - 1];
    setPast((old) => old.slice(0, -1));
    setFuture((old) => [...old, deepClonePolys(polys)]);
    setPolys(deepClonePolys(previous));
  }, [past, polys]);

  const redo = useCallback(() => {
    if (future.length === 0) {
      return;
    }
    const next = future[future.length - 1];
    setFuture((old) => old.slice(0, -1));
    setPast((old) => [...old, deepClonePolys(polys)]);
    setPolys(deepClonePolys(next));
  }, [future, polys]);

  const endBeginOrInsertToMove = useCallback(() => {
    if (mode !== 'begin' && mode !== 'insert') {
      return;
    }

    if (mode === 'begin' && activePolylineId) {
      applyChange((draft) => {
        const activeIndex = draft.findIndex((poly) => poly.id === activePolylineId);
        if (activeIndex >= 0 && draft[activeIndex].vertices.length >= 3) {
          draft[activeIndex].closed = true;
        }
        return draft;
      });
    }

    setNewPolylineOnClick(true);
    setMode('hand');
  }, [activePolylineId, applyChange, mode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const isTypingTarget =
        event.target instanceof HTMLElement &&
        (event.target.tagName === 'INPUT' ||
          event.target.tagName === 'TEXTAREA' ||
          event.target.isContentEditable);

      if (event.ctrlKey || event.metaKey) {
        if (key === 'z' && event.shiftKey) {
          event.preventDefault();
          redo();
          return;
        }
        if (key === 'z') {
          event.preventDefault();
          undo();
          return;
        }
        if (key === 'y') {
          event.preventDefault();
          redo();
          return;
        }
      }

      if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && closest) {
        event.preventDefault();
        const delta = event.key === 'ArrowUp' ? 1 : -1;
        applyChange((draft) => {
          const vertex = draft[closest.polyIndex]?.vertices[closest.vertexIndex];
          if (vertex) {
            vertex.z = Math.max(-120, Math.min(120, vertex.z + delta));
          }
          return draft;
        });
        return;
      }

      if (event.key === 'Escape') {
        if (mode === 'begin' || mode === 'insert') {
          event.preventDefault();
          endBeginOrInsertToMove();
          return;
        }
        setQuit(false);
        setMode('hand');
        return;
      }

      if (!isTypingTarget && key === 'z') {
        event.preventDefault();
        undo();
        return;
      }

      if (!isTypingTarget && key === 'y') {
        event.preventDefault();
        redo();
        return;
      }

      if (event.key === 'Enter' && mode === 'begin') {
        setNewPolylineOnClick(true);
        return;
      }

      const maybeMode = MODE_KEY_MAP[event.key.toLowerCase()];
      if (!maybeMode) {
        return;
      }

      event.preventDefault();
      if (maybeMode === 'quit') {
        enterQuitMode();
        return;
      }

      if (maybeMode === 'begin') {
        setNewPolylineOnClick(true);
      }

      if (maybeMode === 'refresh') {
        refreshEditor();
        return;
      }

      setQuit(false);
      setMode(maybeMode);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closest, mode, redo, undo, enterQuitMode, endBeginOrInsertToMove, refreshEditor]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.width * ratio);
    canvas.height = Math.floor(size.height * ratio);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    ctx.fillStyle = theme === 'dark' ? '#0B0C10' : '#F8F8F8';
    ctx.fillRect(0, 0, size.width, size.height);

    ctx.strokeStyle = theme === 'dark' ? '#2C2F3A' : '#111';
    ctx.lineWidth = 1;
    const viewMin = screenToWorld({ x: 0, y: 0 });
    const viewMax = screenToWorld({ x: size.width, y: size.height });
    const startX = Math.floor(viewMin.x / 40) * 40;
    const endX = Math.ceil(viewMax.x / 40) * 40;
    const startY = Math.floor(viewMin.y / 40) * 40;
    const endY = Math.ceil(viewMax.y / 40) * 40;
    for (let x = startX; x <= endX; x += 40) {
      const sx = worldToScreen({ x, y: 0 }).x;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, size.height);
      ctx.stroke();
    }
    for (let y = startY; y <= endY; y += 40) {
      const sy = worldToScreen({ x: 0, y }).y;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(size.width, sy);
      ctx.stroke();
    }

    const visiblePolys = isRefreshing ? [] : polys;

    visiblePolys.forEach((poly, polyIndex) => {
      if (poly.vertices.length === 0) {
        return;
      }

      ctx.strokeStyle = theme === 'dark' ? '#6AF5A2' : '#000';
      ctx.lineWidth = 4;
      ctx.lineJoin = 'round';
      ctx.beginPath();

      poly.vertices.forEach((v, index) => {
        const p = worldToScreen(projectVertex(v));
        if (index === 0) {
          ctx.moveTo(p.x, p.y);
        } else {
          ctx.lineTo(p.x, p.y);
        }
      });
      if (poly.closed && poly.vertices.length > 2) {
        const first = worldToScreen(projectVertex(poly.vertices[0]));
        ctx.lineTo(first.x, first.y);
      }
      ctx.stroke();

      poly.vertices.forEach((v, vertexIndex) => {
        const p = worldToScreen(projectVertex(v));
        const isNearest =
          !!closest &&
          closest.dist < SNAP_DISTANCE &&
          closest.polyIndex === polyIndex &&
          closest.vertexIndex === vertexIndex;

        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(6, 6 + v.z * 0.03), 0, Math.PI * 2);
        ctx.fillStyle = isNearest ? '#FF4D4D' : theme === 'dark' ? '#FFD54F' : '#fff';
        ctx.fill();
        ctx.lineWidth = isNearest ? 3 : 2;
        ctx.strokeStyle = '#111';
        ctx.stroke();
      });
    });

    if (mode === 'begin' && hover && activePolylineId && !isRefreshing) {
      const activePolyline = polys.find((poly) => poly.id === activePolylineId);
      const lastVertex = activePolyline?.vertices[activePolyline.vertices.length - 1];
      if (lastVertex && !newPolylineOnClick && !activePolyline?.closed) {
        const p = worldToScreen(projectVertex(lastVertex));
        const hoverScreen = worldToScreen(hover);
        ctx.setLineDash([8, 8]);
        ctx.strokeStyle = '#4F46E5';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(hoverScreen.x, hoverScreen.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    if (fx) {
      const p = worldToScreen(fx);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
      ctx.strokeStyle = '#FF6B00';
      ctx.lineWidth = 5;
      ctx.stroke();
    }
  }, [activePolylineId, camera, closest, fx, hover, isRefreshing, mode, newPolylineOnClick, polys, screenToWorld, size, theme, worldToScreen]);

  const screenPointFromEvent = (event: { currentTarget: EventTarget & HTMLCanvasElement; clientX: number; clientY: number }) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const applyDelete = (point: Point2D) => {
    let target: { polyIndex: number; vertexIndex: number } | null = null;

    if (closest && closest.dist <= SNAP_DISTANCE) {
      target = { polyIndex: closest.polyIndex, vertexIndex: closest.vertexIndex };
    } else {
      const hit = closestSegment(polys, point);
      if (hit && hit.dist <= SNAP_DISTANCE) {
        const poly = polys[hit.polyIndex];
        if (!poly || poly.vertices.length === 0) {
          return;
        }

        const leftIndex = hit.insertAt - 1;
        const rightIndex = hit.insertAt % poly.vertices.length;
        const left = poly.vertices[leftIndex];
        const right = poly.vertices[rightIndex];
        const leftDist = getDistance(
          { x: left.x, y: toScreenY(left.y, left.z) },
          { x: point.x, y: point.y },
        );
        const rightDist = getDistance(
          { x: right.x, y: toScreenY(right.y, right.z) },
          { x: point.x, y: point.y },
        );

        target = {
          polyIndex: hit.polyIndex,
          vertexIndex: leftDist <= rightDist ? leftIndex : rightIndex,
        };
      }
    }

    if (!target) {
      return;
    }

    applyChange((draft) => {
      const poly = draft[target.polyIndex];
      if (!poly) {
        return draft;
      }
      const removed = poly.vertices.splice(target.vertexIndex, 1)[0];
      if (removed) {
        setFx({ x: removed.x, y: toScreenY(removed.y, removed.z), key: Date.now() });
      }
      if (poly.vertices.length < 3) {
        poly.closed = false;
      }
      if (poly.vertices.length === 0) {
        draft.splice(target.polyIndex, 1);
      }
      return draft;
    });
  };

  const applyBegin = (point: Point2D) => {
    applyChange((draft) => {
      const nearest = findClosestVertex(draft, point);
      if (nearest && nearest.dist <= DUPLICATE_VERTEX_DISTANCE) {
        const targetPoly = draft[nearest.polyIndex];
        if (targetPoly) {
          const v = targetPoly.vertices[nearest.vertexIndex];
          if (!v) {
            return draft;
          }

          const activeIndex = draft.findIndex((poly) => poly.id === activePolylineId);
          const activePoly = activeIndex >= 0 ? draft[activeIndex] : null;

          // If currently drawing, allow an existing vertex to be a valid endpoint.
          if (activePoly && !newPolylineOnClick && activePoly.vertices.length > 0) {
            const lastIndex = activePoly.vertices.length - 1;
            const last = activePoly.vertices[lastIndex];
            const sameAsLast =
              getDistance(
                { x: last.x, y: toScreenY(last.y, last.z) },
                { x: v.x, y: toScreenY(v.y, v.z) },
              ) <= DUPLICATE_VERTEX_DISTANCE;

            // Clicking an earlier vertex of the same active polyline closes the shape.
            if (
              activeIndex === nearest.polyIndex &&
              nearest.vertexIndex !== lastIndex &&
              activePoly.vertices.length >= 2
            ) {
              activePoly.closed = true;
              setNewPolylineOnClick(true);
              setActivePolylineId(activePoly.id);
              setFx({ x: v.x, y: toScreenY(v.y, v.z), key: Date.now() });
              return draft;
            }

            // If it is another vertex location, use it as the next segment endpoint.
            if (!sameAsLast) {
              activePoly.closed = false;
              activePoly.vertices.push({ x: v.x, y: v.y, z: v.z });
              setFx({ x: v.x, y: toScreenY(v.y, v.z), key: Date.now() });
            }

            setActivePolylineId(activePoly.id);
            return draft;
          }

          // If not currently drawing, start a new polyline from that existing vertex.
          if (draft.length < MAX_POLYLINES) {
            const id = createId();
            draft.push({ id, closed: false, vertices: [{ x: v.x, y: v.y, z: v.z }] });
            setActivePolylineId(id);
            setNewPolylineOnClick(false);
            setFx({ x: v.x, y: toScreenY(v.y, v.z), key: Date.now() });
            return draft;
          }

          setActivePolylineId(targetPoly.id);
          setFx({ x: v.x, y: toScreenY(v.y, v.z), key: Date.now() });
        }
        return draft;
      }

      if ((newPolylineOnClick || !activePolylineId) && draft.length < MAX_POLYLINES) {
        const id = createId();
        draft.push({ id, vertices: [{ x: point.x, y: point.y, z: 0 }] });
        setActivePolylineId(id);
        setNewPolylineOnClick(false);
        setFx({ x: point.x, y: point.y, key: Date.now() });
        return draft;
      }

      const activeIndex = draft.findIndex((poly) => poly.id === activePolylineId);
      if (activeIndex >= 0) {
        draft[activeIndex].closed = false;
        draft[activeIndex].vertices.push({ x: point.x, y: point.y, z: 0 });
        setFx({ x: point.x, y: point.y, key: Date.now() });
      }

      return draft;
    });
  };

  const applyInsert = (point: Point2D) => {
    const hit = closestSegment(polys, point);
    if (!hit || hit.dist > 18) {
      return;
    }

    applyChange((draft) => {
      const poly = draft[hit.polyIndex];
      if (!poly) {
        return draft;
      }

      const wouldDuplicate = poly.vertices.some((vertex) => {
        return (
          getDistance(
            { x: vertex.x, y: toScreenY(vertex.y, vertex.z) },
            { x: hit.point.x, y: toScreenY(hit.point.y, hit.point.z) },
          ) <= DUPLICATE_VERTEX_DISTANCE
        );
      });

      if (wouldDuplicate) {
        setActivePolylineId(poly.id);
        return draft;
      }

      poly.vertices.splice(hit.insertAt, 0, hit.point);
      setActivePolylineId(poly.id);
      setFx({ x: hit.point.x, y: toScreenY(hit.point.y, hit.point.z), key: Date.now() });
      return draft;
    });
  };

  const onMouseMove = (event: React.MouseEvent<HTMLCanvasElement, MouseEvent>) => {
    const screenPoint = screenPointFromEvent(event);
    const point = screenToWorld(screenPoint);

    if (panning) {
      const dx = screenPoint.x - panning.start.x;
      const dy = screenPoint.y - panning.start.y;
      setCamera({
        ...panning.cameraStart,
        offsetX: panning.cameraStart.offsetX + dx,
        offsetY: panning.cameraStart.offsetY + dy,
      });
      return;
    }

    setHover(point);

    const nearest = findClosestVertex(polys, point);
    setClosest(nearest);

    if (dragging && mode === 'move') {
      setPolys((prev) => {
        const draft = deepClonePolys(prev);
        const vertex = draft[dragging.polyIndex]?.vertices[dragging.vertexIndex];
        if (!vertex) {
          return prev;
        }
        vertex.x = point.x;
        vertex.y = point.y + vertex.z * 0.45;
        return draft;
      });
    }
  };

  const onMouseDown = (event: React.MouseEvent<HTMLCanvasElement, MouseEvent>) => {
    if (quit) {
      return;
    }

    if (event.button === 1) {
      event.preventDefault();
      const start = screenPointFromEvent(event);
      setPanning({ start, cameraStart: { ...camera } });
      return;
    }

    if (event.button !== 0) {
      return;
    }

    if (mode === 'hand') {
      const start = screenPointFromEvent(event);
      setPanning({ start, cameraStart: { ...camera } });
      return;
    }

    const point = screenToWorld(screenPointFromEvent(event));

    if (mode === 'move' && closest && closest.dist <= SNAP_DISTANCE) {
      setPast((old) => [...old.slice(-149), deepClonePolys(polys)]);
      setFuture([]);
      setDragging({ polyIndex: closest.polyIndex, vertexIndex: closest.vertexIndex });
      return;
    }

    if (mode === 'delete') {
      applyDelete(point);
      return;
    }

    if (mode === 'begin') {
      applyBegin(point);
      return;
    }

    if (mode === 'insert') {
      applyInsert(point);
      return;
    }
  };

  const onMouseUp = () => {
    if (dragging) {
      const movedVertex = polys[dragging.polyIndex]?.vertices[dragging.vertexIndex];
      if (movedVertex) {
        setFx({ x: movedVertex.x, y: toScreenY(movedVertex.y, movedVertex.z), key: Date.now() });
      }
    }
    setDragging(null);
    setPanning(null);
  };

  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const screenPoint = screenPointFromEvent(event);
    const worldBefore = screenToWorld(screenPoint);
    const zoomFactor = event.deltaY < 0 ? 1.12 : 0.89;
    const nextScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.scale * zoomFactor));
    setCamera({
      scale: nextScale,
      offsetX: screenPoint.x - worldBefore.x * nextScale,
      offsetY: screenPoint.y - worldBefore.y * nextScale,
    });
  };

  const onCanvasContextMenu = (event: React.MouseEvent<HTMLCanvasElement, MouseEvent>) => {
    event.preventDefault();
    endBeginOrInsertToMove();
  };

  const saveToFile = () => {
    const blob = new Blob([JSON.stringify(polys, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'polylines.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const loadFromFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Polyline[];
      if (!Array.isArray(parsed)) {
        return;
      }
      setPast((old) => [...old.slice(-149), deepClonePolys(polys)]);
      setFuture([]);
      setPolys(parsed.slice(0, MAX_POLYLINES));
      setActivePolylineId(parsed[0]?.id ?? null);
    } catch {
      // Keep interaction smooth even when users import invalid files.
    }
  };

  const nearestVertex = closest && closest.dist <= SNAP_DISTANCE ? polys[closest.polyIndex]?.vertices[closest.vertexIndex] : null;

  const displayPolys = isRefreshing ? [] : polys;

  const miniMap = useMemo(() => {
    const points = displayPolys.flatMap((poly) => poly.vertices.map((vertex) => projectVertex(vertex)));
    const viewportMin = screenToWorld({ x: 0, y: 0 });
    const viewportMax = screenToWorld({ x: size.width, y: size.height });
    if (points.length === 0) {
      points.push(viewportMin, viewportMax);
    }

    let minX = points[0].x;
    let maxX = points[0].x;
    let minY = points[0].y;
    let maxY = points[0].y;
    points.forEach((point) => {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    });

    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const padding = 16;
    const miniWidth = Math.min(220, Math.max(132, size.width - 56));
    const miniHeight = Math.max(96, Math.round(miniWidth * 0.64));
    const scale = Math.min((miniWidth - padding * 2) / width, (miniHeight - padding * 2) / height);

    const mapPoint = (point: Point2D) => ({
      x: (point.x - minX) * scale + padding,
      y: (point.y - minY) * scale + padding,
    });

    const viewportTopLeft = mapPoint(viewportMin);
    const viewportBottomRight = mapPoint(viewportMax);

    return {
      width: miniWidth,
      height: miniHeight,
      minX,
      minY,
      scale,
      padding,
      mapPoint,
      viewport: {
        x: Math.min(viewportTopLeft.x, viewportBottomRight.x),
        y: Math.min(viewportTopLeft.y, viewportBottomRight.y),
        w: Math.abs(viewportBottomRight.x - viewportTopLeft.x),
        h: Math.abs(viewportBottomRight.y - viewportTopLeft.y),
      },
    };
  }, [displayPolys, screenToWorld, size.height, size.width]);

  const onMiniMapClick = (event: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    if (!Number.isFinite(miniMap.scale) || miniMap.scale <= 0) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const miniX = event.clientX - rect.left;
    const miniY = event.clientY - rect.top;
    const worldX = (miniX - miniMap.padding) / miniMap.scale + miniMap.minX;
    const worldY = (miniY - miniMap.padding) / miniMap.scale + miniMap.minY;

    setCamera((prev) => ({
      ...prev,
      offsetX: size.width / 2 - worldX * prev.scale,
      offsetY: size.height / 2 - worldY * prev.scale,
    }));
  };

  return (
    <main className="min-h-screen bg-[linear-gradient(135deg,#fff_0%,#f2f2f2_40%,#dedede_100%)] p-2 font-brutal text-black dark:bg-[linear-gradient(135deg,#040404_0%,#101116_45%,#1f212c_100%)] dark:text-white sm:p-3 md:p-6">
      <section className="mx-auto flex w-full max-w-[1320px] min-w-0 flex-col gap-3">
        <header className="border-4 border-black bg-[#F9FF71] p-4 shadow-[8px_8px_0_0_#000] transition-all dark:border-white dark:bg-[#F05526] dark:shadow-[8px_8px_0_0_#fff]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight md:text-3xl">Polyline Editor Lab</h1>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wide opacity-80 md:text-sm">
                2D + 3D vertex editing with keyboard-first modes
              </p>
            </div>
            <button
              type="button"
              onClick={() => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))}
              className="min-h-12 border-4 border-black bg-white px-4 py-2 text-sm font-black uppercase transition hover:-translate-y-0.5 hover:shadow-[4px_4px_0_0_#000] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-black dark:border-white dark:bg-[#111] dark:hover:shadow-[4px_4px_0_0_#fff] dark:focus-visible:ring-white"
              aria-label="Toggle theme"
            >
              <span className="flex items-center gap-2">{theme === 'light' ? <Moon size={17} /> : <Sun size={17} />} Theme</span>
            </button>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-8 md:gap-3" aria-label="Action controls">
          <ControlButton icon={CircleDashed} label="Begin" shortcut="B" active={mode === 'begin'} onClick={() => setMode('begin')} disabled={quit} />
          <ControlButton icon={Eraser} label="Delete" shortcut="D" active={mode === 'delete'} onClick={() => setMode('delete')} disabled={quit} />
          <ControlButton icon={Grab} label="Move" shortcut="M" active={mode === 'move'} onClick={() => setMode('move')} disabled={quit} />
          <ControlButton icon={Hand} label="Hand" shortcut="H" active={mode === 'hand'} onClick={() => setMode('hand')} disabled={quit} />
          <ControlButton icon={RefreshCw} label="Refresh" shortcut="R" active={mode === 'refresh'} onClick={refreshEditor} disabled={quit} />
          <ControlButton icon={XCircle} label="Quit" shortcut="Q" active={mode === 'quit'} onClick={enterQuitMode} />
          <ControlButton icon={GitBranchPlus} label="Insert" shortcut="I" active={mode === 'insert'} onClick={() => setMode('insert')} disabled={quit} />
          <div className="col-span-1 flex min-h-12 flex-wrap items-center justify-center gap-2 border-4 border-black bg-white px-3 py-2 sm:col-span-2 md:col-span-4 lg:col-span-1 dark:border-white dark:bg-[#151721]">
            <button
              type="button"
              className="h-9 w-9 border-2 border-black bg-[#C7FF74] p-1 transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black disabled:opacity-50 dark:border-white dark:bg-[#0EAD69] dark:focus-visible:ring-white"
              onClick={undo}
              disabled={!past.length || quit}
              aria-label="Undo"
            >
              <Undo2 className="mx-auto" size={16} />
            </button>
            <button
              type="button"
              className="h-9 w-9 border-2 border-black bg-[#8AF8FF] p-1 transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black disabled:opacity-50 dark:border-white dark:bg-[#0369A1] dark:focus-visible:ring-white"
              onClick={redo}
              disabled={!future.length || quit}
              aria-label="Redo"
            >
              <Redo2 className="mx-auto" size={16} />
            </button>
            <button
              type="button"
              className="h-9 w-9 border-2 border-black bg-[#FFD166] p-1 transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black dark:border-white dark:bg-[#B45309] dark:focus-visible:ring-white"
              onClick={saveToFile}
              aria-label="Save to file"
            >
              <Save className="mx-auto" size={16} />
            </button>
            <button
              type="button"
              className="h-9 w-9 border-2 border-black bg-[#FCA5A5] p-1 transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black dark:border-white dark:bg-[#9F1239] dark:focus-visible:ring-white"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Load from file"
            >
              <Upload className="mx-auto" size={16} />
            </button>
            <button
              type="button"
              className="h-9 w-9 border-2 border-black bg-[#DDD6FE] p-1 transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black dark:border-white dark:bg-[#312E81] dark:focus-visible:ring-white"
              onClick={fitToScreen}
              aria-label="Fit to screen"
            >
              <Maximize2 className="mx-auto" size={16} />
            </button>
            <input
              ref={fileInputRef}
              className="hidden"
              type="file"
              accept="application/json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void loadFromFile(file);
                }
                event.currentTarget.value = '';
              }}
            />
          </div>
        </section>

        <section className="grid gap-3 lg:grid-cols-[1fr_280px]">
          <div className="relative border-4 border-black bg-white shadow-[8px_8px_0_0_#000] dark:border-white dark:bg-[#0B0C10] dark:shadow-[8px_8px_0_0_#fff]">
            <div ref={containerRef} className="h-[52vh] min-h-[320px] w-full md:h-[68vh] md:min-h-[360px]">
              <canvas
                ref={canvasRef}
                tabIndex={0}
                className={`h-full w-full outline-none ${panning ? 'cursor-grabbing' : mode === 'move' || mode === 'hand' ? 'cursor-grab' : 'cursor-crosshair'}`}
                onMouseMove={onMouseMove}
                onMouseDown={onMouseDown}
                onMouseUp={onMouseUp}
                onWheel={onWheel}
                onContextMenu={onCanvasContextMenu}
                onMouseLeave={() => {
                  setHover(null);
                  setDragging(null);
                  setPanning(null);
                }}
                aria-label="Polyline drawing canvas"
                role="application"
              />
            </div>
            <div className="absolute bottom-2 right-2 max-w-[calc(100%-1rem)] border-4 border-black bg-white/95 p-1 dark:border-white dark:bg-[#0B0C10]/95 sm:bottom-3 sm:right-3">
              <svg
                width={miniMap.width}
                height={miniMap.height}
                aria-label="Mini map overview"
                onMouseDown={onMiniMapClick}
                className="cursor-pointer"
              >
                <rect x={0} y={0} width={miniMap.width} height={miniMap.height} fill={theme === 'dark' ? '#0B0C10' : '#f7f7f7'} />
                {displayPolys.map((poly) => {
                  const points = poly.vertices.map((vertex) => {
                    const p = miniMap.mapPoint(projectVertex(vertex));
                    return `${p.x},${p.y}`;
                  });
                  if (poly.closed && points.length > 2) {
                    points.push(points[0]);
                  }
                  return (
                    <polyline
                      key={poly.id}
                      points={points.join(' ')}
                      fill="none"
                      stroke={theme === 'dark' ? '#6AF5A2' : '#111'}
                      strokeWidth={2}
                    />
                  );
                })}
                <rect
                  x={miniMap.viewport.x}
                  y={miniMap.viewport.y}
                  width={miniMap.viewport.w}
                  height={miniMap.viewport.h}
                  fill="none"
                  stroke={theme === 'dark' ? '#FF6B00' : '#EF4444'}
                  strokeWidth={2}
                  strokeDasharray="6 4"
                />
              </svg>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-wide opacity-80">Click to Jump</p>
            </div>
            {quit ? (
              <div className="absolute inset-0 grid place-items-center bg-black/75 p-4 text-center text-white">
                <div className="border-4 border-white bg-black p-4">
                  <p className="text-lg font-black uppercase">Editor Paused (Quit Mode)</p>
                  <p className="mt-2 text-sm">Press Escape to continue.</p>
                </div>
              </div>
            ) : null}
          </div>

          <aside className="space-y-3">
            <div className="border-4 border-black bg-[#F3F3F3] p-3 dark:border-white dark:bg-[#151721]">
              <p className="text-xs uppercase tracking-wide opacity-70">Current Mode</p>
              <p key={mode} className="animate-pop text-2xl font-black uppercase">
                {MODE_LABEL[mode]}
              </p>
              <p className="mt-2 text-xs leading-relaxed opacity-80">
                Core shortcuts: <strong>B</strong>egin, <strong>D</strong>elete, <strong>M</strong>ove, <strong>R</strong>efresh,
                <strong> Q</strong>uit. Extension: <strong>I</strong>nsert, <strong>H</strong>and.
              </p>
            </div>

            <div className="border-4 border-black bg-[#D9F99D] p-3 dark:border-white dark:bg-[#14532D]">
              <p className="text-xs uppercase tracking-wide opacity-70">Status Bar</p>
              <p className="mt-2 text-sm font-semibold">Polylines: {polys.length} / {MAX_POLYLINES}</p>
              <p className="text-sm font-semibold">Selected Polyline Vertices: {selectedVertexCount}</p>
              <p className="text-sm font-semibold">History: {past.length} undo / {future.length} redo</p>
              <p className="text-sm font-semibold">Zoom: {Math.round(camera.scale * 100)}%</p>
            </div>

            <div className="border-4 border-black bg-[#E0F2FE] p-3 dark:border-white dark:bg-[#1E3A8A]">
              <p className="text-xs uppercase tracking-wide opacity-70">3D Depth</p>
              <p className="mt-1 text-xs opacity-85">Use Alt + ArrowUp/ArrowDown or the slider when a vertex is highlighted.</p>
              <input
                type="range"
                min={-120}
                max={120}
                step={1}
                value={nearestVertex?.z ?? 0}
                disabled={!nearestVertex || quit}
                aria-label="Vertex Z depth"
                onPointerDown={() => {
                  if (!nearestVertex) {
                    return;
                  }
                  setPast((old) => [...old.slice(-149), deepClonePolys(polys)]);
                  setFuture([]);
                }}
                onChange={(event) => {
                  if (!closest || !nearestVertex) {
                    return;
                  }
                  const value = Number(event.target.value);
                  setPolys((prev) => {
                    const draft = deepClonePolys(prev);
                    const vertex = draft[closest.polyIndex]?.vertices[closest.vertexIndex];
                    if (!vertex) {
                      return prev;
                    }
                    vertex.z = value;
                    return draft;
                  });
                }}
                className="mt-3 w-full accent-black dark:accent-[#6AF5A2]"
              />
              <p className="mt-1 text-sm font-black">Z: {nearestVertex?.z ?? 'N/A'}</p>
            </div>
          </aside>
        </section>
      </section>
    </main>
  );
}
