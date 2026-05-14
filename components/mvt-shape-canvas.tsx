import { VectorTile } from '@mapbox/vector-tile';
import { Canvas, Fill, Path, Skia, type SkPath } from '@shopify/react-native-skia';
import Pbf from 'pbf';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

const CANVAS_SIZE = 320;
const PADDING = 32;
const TILE_URL = '/tiles/sample2.mvt';
const TILE_LAYER = 'map';

type Point = { x: number; y: number };
type Geometry = Point[][];
type RenderPolygon = { path: SkPath; color: string; kind: string };
type RenderRoad = { path: SkPath; color: string; kind: string; strokeWidth: number };

type TileTransform = {
  minX: number;
  minY: number;
  scale: number;
  offsetX: number;
  offsetY: number;
};

const colorForKind = (kind: string) => {
  switch (kind) {
    case 'park':
      return '#74c476';
    case 'water':
      return '#6baed6';
    case 'building':
      return '#bdbdbd';
    case 'commercial':
      return '#fdae6b';
    default:
      return '#20a85a';
  }
};

const roadStyleForKind = (kind: string) => {
  switch (kind) {
    case 'major_road':
      return { color: '#fdd835', strokeWidth: 5 };
    case 'road':
      return { color: '#ffffff', strokeWidth: 3 };
    default:
      return { color: '#ffffff', strokeWidth: 2 };
  }
};

const getTileTransform = (geometries: Geometry[]): TileTransform | null => {
  const points = geometries.flat(2);

  if (points.length === 0) {
    return null;
  }

  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  const drawableSize = CANVAS_SIZE - PADDING * 2;
  const scale = Math.min(drawableSize / width, drawableSize / height);

  return {
    minX,
    minY,
    scale,
    offsetX: (CANVAS_SIZE - width * scale) / 2,
    offsetY: (CANVAS_SIZE - height * scale) / 2,
  };
};

const toCanvasPoint = (point: Point, transform: TileTransform) => ({
  x: transform.offsetX + (point.x - transform.minX) * transform.scale,
  y: transform.offsetY + (point.y - transform.minY) * transform.scale,
});

const buildPolygonPath = (rings: Geometry, transform: TileTransform) => {
  const path = Skia.Path.Make();

  rings.forEach((ring) => {
    ring.forEach((point, index) => {
      const canvasPoint = toCanvasPoint(point, transform);

      if (index === 0) {
        path.moveTo(canvasPoint.x, canvasPoint.y);
      } else {
        path.lineTo(canvasPoint.x, canvasPoint.y);
      }
    });

    path.close();
  });

  return path;
};

const buildLinePath = (lines: Geometry, transform: TileTransform) => {
  const path = Skia.Path.Make();

  lines.forEach((line) => {
    line.forEach((point, index) => {
      const canvasPoint = toCanvasPoint(point, transform);

      if (index === 0) {
        path.moveTo(canvasPoint.x, canvasPoint.y);
      } else {
        path.lineTo(canvasPoint.x, canvasPoint.y);
      }
    });
  });

  return path;
};

export function MvtShapeCanvas() {
  const [polygons, setPolygons] = useState<RenderPolygon[]>([]);
  const [roads, setRoads] = useState<RenderRoad[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadTile = async () => {
      try {
        const response = await fetch(TILE_URL);

        if (!response.ok) {
          throw new Error(`Failed to fetch ${TILE_URL}: ${response.status} ${response.statusText}`);
        }

        const bytes = new Uint8Array(await response.arrayBuffer());
        const tile = new VectorTile(new Pbf(bytes));
        const layer = tile.layers[TILE_LAYER];

        if (!layer) {
          throw new Error(`Layer "${TILE_LAYER}" was not found in ${TILE_URL}`);
        }

        const polygonFeatures: { geometry: Geometry; kind: string }[] = [];
        const roadFeatures: { geometry: Geometry; kind: string }[] = [];

        for (let index = 0; index < layer.length; index += 1) {
          const feature = layer.feature(index);
          const kind = String(feature.properties.kind ?? 'unknown');

          if (feature.type === 3) {
            polygonFeatures.push({ geometry: feature.loadGeometry(), kind });
          }

          if (feature.type === 2 && (kind === 'road' || kind === 'major_road')) {
            roadFeatures.push({ geometry: feature.loadGeometry(), kind });
          }
        }

        const transform = getTileTransform([
          ...polygonFeatures.map((feature) => feature.geometry),
          ...roadFeatures.map((feature) => feature.geometry),
        ]);

        if (!transform) {
          throw new Error(`No renderable geometry was found in ${TILE_URL}`);
        }

        const renderPolygons = polygonFeatures.map(({ geometry, kind }) => ({
          path: buildPolygonPath(geometry, transform),
          color: colorForKind(kind),
          kind,
        }));

        const renderRoads = roadFeatures.map(({ geometry, kind }) => ({
          path: buildLinePath(geometry, transform),
          kind,
          ...roadStyleForKind(kind),
        }));

        if (mounted) {
          setPolygons(renderPolygons);
          setRoads(renderRoads);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to render tile');
        }
      }
    };

    loadTile();

    return () => {
      mounted = false;
    };
  }, []);

  const countsByKind = [...polygons, ...roads].reduce<Record<string, number>>((counts, item) => {
    counts[item.kind] = (counts[item.kind] ?? 0) + 1;
    return counts;
  }, {});

  return (
    <View style={styles.container}>
      <Text style={styles.title}>MVT tile rendered in Skia</Text>
      <Text style={styles.subtitle}>Rendering polygons and roads from {TILE_URL}</Text>

      <View style={styles.canvasFrame}>
        <Canvas style={styles.canvas}>
          <Fill color="#f7f7f7" />
          {polygons.map((item, index) => (
            <Path key={`polygon-${index}`} path={item.path} color={item.color} />
          ))}
          {roads.map((item, index) => (
            <Path
              key={`road-casing-${index}`}
              path={item.path}
              color="#8d8d8d"
              style="stroke"
              strokeWidth={item.strokeWidth + 2}
            />
          ))}
          {roads.map((item, index) => (
            <Path
              key={`road-${index}`}
              path={item.path}
              color={item.color}
              style="stroke"
              strokeWidth={item.strokeWidth}
            />
          ))}
        </Canvas>
      </View>

      <View style={styles.legend}>
        {Object.entries(countsByKind).map(([kind, count]) => (
          <View key={kind} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: colorForKind(kind) }]} />
            <Text style={styles.legendText}>
              {kind}: {count}
            </Text>
          </View>
        ))}
      </View>

      <Text style={styles.count}>
        {polygons.length} polygon(s), {roads.length} road(s)
      </Text>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: '#ffffff',
    borderTopColor: '#dddddd',
    borderTopWidth: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111111',
  },
  subtitle: {
    marginTop: 4,
    color: '#666666',
  },
  canvasFrame: {
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
    marginTop: 16,
    borderColor: '#dddddd',
    borderWidth: 1,
  },
  canvas: {
    flex: 1,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  swatch: {
    width: 14,
    height: 14,
    borderRadius: 3,
    borderColor: '#999999',
    borderWidth: 1,
  },
  legendText: {
    color: '#333333',
  },
  count: {
    marginTop: 8,
    color: '#555555',
  },
  error: {
    marginTop: 12,
    color: '#b00020',
  },
});
