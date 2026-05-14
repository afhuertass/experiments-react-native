import { VectorTile } from '@mapbox/vector-tile';
import { Canvas, Circle, Fill, Group, Path, Shader, Skia, type SkPath } from '@shopify/react-native-skia';
import Pbf from 'pbf';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PREFERRED_LAYER, TILE_URL } from './mvt-config';

const CANVAS_SIZE = 620;
const PADDING = 32;
const WATER_LAYER = 'water';
const EARTH_LAYER = 'earth';

type Point = { x: number; y: number };
type Geometry = Point[][];
type RenderPolygon = { path: SkPath; color: string; kind: string; layer: string };
type RenderLine = { path: SkPath; color: string; kind: string; strokeWidth: number; layer: string };
type RenderPoint = { x: number; y: number; color: string; kind: string; radius: number; layer: string };

type TileTransform = {
  minX: number;
  minY: number;
  scale: number;
  offsetX: number;
  offsetY: number;
};

const colorForKind = (kind: string) => {
  switch (kind) {
    case 'ocean':
    case 'water':
      return '#4da3ff';
    case 'park':
      return '#74c476';
    case 'building':
      return '#bdbdbd';
    case 'commercial':
      return '#fdae6b';
    case 'earth':
      return '#8ccf5f';
    default:
      return '#7b2cbf';
  }
};

const lineStyleForKind = (kind: string) => {
  switch (kind) {
    case 'major_road':
      return { color: '#fdd835', strokeWidth: 5 };
    case 'road':
      return { color: '#ffffff', strokeWidth: 3 };
    default:
      return { color: '#555555', strokeWidth: 2 };
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
      if (index === 0) path.moveTo(canvasPoint.x, canvasPoint.y);
      else path.lineTo(canvasPoint.x, canvasPoint.y);
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
      if (index === 0) path.moveTo(canvasPoint.x, canvasPoint.y);
      else path.lineTo(canvasPoint.x, canvasPoint.y);
    });
  });

  return path;
};

const featureKind = (properties: Record<string, unknown>) =>
  String(properties.kind ?? properties.class ?? properties.type ?? properties.natural ?? properties.name ?? 'point');

export function MvtShapeCanvas() {
  const waterShader = useMemo(
    () =>
      Skia.RuntimeEffect.Make(`
uniform float time;
uniform float2 resolution;

float hash(float2 p) {
  return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
}

float noise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  float2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + float2(1,0)), u.x),
    mix(hash(i + float2(0,1)), hash(i + float2(1,1)), u.x),
    u.y
  );
}

float fbm(float2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.1 + float2(1.3, 1.7);
    a *= 0.5;
  }
  return v;
}

half4 main(float2 p) {
  float2 uv = p / resolution;

  float t = time * 0.6;

  float2 q = float2(
    fbm(uv * 3.0 + float2(t * 0.4, t * 0.3)),
    fbm(uv * 3.0 + float2(t * 0.3, t * 0.5))
  );

  float2 r = float2(
    fbm(uv * 4.5 + 4.0 * q + float2(1.7, 9.2) + t * 0.15),
    fbm(uv * 4.5 + 4.0 * q + float2(8.3, 2.8) + t * 0.12)
  );

  float f = fbm(uv * 5.0 + 4.0 * r + t * 0.1);

  // Caustics — bright light refractions
  float caustic1 = sin((uv.x + q.x * 0.4) * 18.0 + t * 3.1) *
                   sin((uv.y + q.y * 0.4) * 14.0 - t * 2.3);
  float caustic2 = sin((uv.x - r.x * 0.3) * 24.0 - t * 2.0) *
                   sin((uv.y + r.y * 0.3) * 20.0 + t * 1.7);
  float caustics = smoothstep(0.55, 1.0, (caustic1 + caustic2) * 0.5 + 0.5);

  // Surface shimmer / specular
  float shimmer = smoothstep(0.78, 1.0, noise(uv * 12.0 + float2(t * 2.2, -t * 1.8)));

  // Foam at wave peaks
  float foam = smoothstep(0.68, 1.0, f + r.x * 0.3);

  // Depth — darker in center/deeper zones
  float depth = 1.0 - length(uv - float2(0.5, 0.6)) * 0.6;

  // Color layers
  half4 abyssal  = half4(0.01, 0.12, 0.35, 1.0);
  half4 deep     = half4(0.02, 0.24, 0.58, 1.0);
  half4 mid      = half4(0.05, 0.45, 0.82, 1.0);
  half4 shallow  = half4(0.10, 0.65, 0.88, 1.0);
  half4 causticC = half4(0.55, 0.92, 1.00, 1.0);
  half4 foamC    = half4(0.88, 0.97, 1.00, 1.0);
  half4 shimmerC = half4(1.00, 1.00, 1.00, 1.0);

  half4 water = mix(abyssal, deep, clamp(depth * 1.2, 0.0, 1.0));
  water = mix(water, mid, clamp(f * 1.4, 0.0, 1.0));
  water = mix(water, shallow, clamp(r.x * 0.8, 0.0, 1.0));
  water = mix(water, causticC, caustics * 0.45);
  water = mix(water, foamC, foam * 0.6);
  water = mix(water, shimmerC, shimmer * 0.35);

  return water;
}
`),
    []
  );

  const grassShader = useMemo(
    () =>
      Skia.RuntimeEffect.Make(`
uniform float time;
uniform float2 resolution;

float hash(float2 p) {
  return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
}

float noise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  float2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + float2(1,0)), u.x),
    mix(hash(i + float2(0,1)), hash(i + float2(1,1)), u.x),
    u.y
  );
}

half4 main(float2 p) {
  // work in pixel space — keeps noise frequencies visible
  float t = time*0.1;

  // rolling wind gust across x axis
  float gust = noise(float2(p.x * 0.003 + t * 0.2, t * 0.15));
  float wind = 0.6 + gust * 0.8;

  // primary sway — horizontal ripple moving with wind
  float swayA = sin(p.x * 0.07 + t * wind * 1.1 + noise(float2(p.x * 0.01, 0.0)) * 6.0);
  float swayB = sin(p.x * 0.13 - t * wind * 0.7 + 1.5) * 0.5;
  float sway = swayA * 0.6 + swayB * 0.4; // range roughly -1 to 1

  // multi-scale color noise — pixel scale so contrast is clear
  float n1 = noise(p * 0.12 + float2(t * 0.05, 0.0));       // large patches
  float n2 = noise(p * 0.35 + float2(0.0, t * 0.03));       // medium detail
  float n3 = noise(p * 0.9  + float2(t * 0.02, t * 0.02));  // fine blades

  float detail = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;

  // tip brightness — sway peaks = light hits blade tips
  float tipBright = smoothstep(0.3, 1.0, sway * 0.5 + 0.5);

  // warm/cool patches — very slow large variation
  float warmPatch = noise(p * 0.025 + float2(0.4, 1.1));

  // dew — bright specks on some blades
  float dew = smoothstep(0.80, 1.0, noise(p * 0.4 + float2(t * 0.04, 0.9)));

  // colors
  half4 dark   = half4(0.08, 0.28, 0.07, 1.0);
  half4 mid    = half4(0.20, 0.52, 0.14, 1.0);
  half4 bright = half4(0.42, 0.74, 0.18, 1.0);
  half4 tipC   = half4(0.68, 0.90, 0.30, 1.0);
  half4 warm   = half4(0.50, 0.68, 0.08, 1.0);
  half4 dewC   = half4(0.85, 0.98, 0.88, 1.0);

  half4 col = mix(dark, mid, detail * 1.6);          // base variation
  col = mix(col, bright, clamp(sway * 0.5 + 0.3, 0.0, 1.0)); // wind bright
  col = mix(col, warm,   clamp(warmPatch - 0.3, 0.0, 0.4));   // warm patches
  col = mix(col, tipC,   tipBright * 0.65);          // tip highlights
  col = mix(col, dewC,   dew * 0.5);                 // dew shimmer

  return col;
}
`),
    []
  );

  const [waterTime, setWaterTime] = useState(0);
  const [layerNames, setLayerNames] = useState<string[]>([]);
  const [polygons, setPolygons] = useState<RenderPolygon[]>([]);
  const [lines, setLines] = useState<RenderLine[]>([]);
  const [points, setPoints] = useState<RenderPoint[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let animationFrame = 0;
    const start = performance.now();

    const animate = (now: number) => {
      setWaterTime((now - start) / 1000);
      animationFrame = requestAnimationFrame(animate);
    };

    animationFrame = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrame);
    };
  }, []);

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
        const availableLayers = Object.keys(tile.layers);
        const mainLayerName = tile.layers[PREFERRED_LAYER] ? PREFERRED_LAYER : availableLayers[0];
        const selectedLayerNames = Array.from(
          new Set(
            [
              tile.layers[EARTH_LAYER] ? EARTH_LAYER : undefined,
              tile.layers[WATER_LAYER] ? WATER_LAYER : undefined,
              mainLayerName,
            ].filter(Boolean)
          )
        ) as string[];

        if (selectedLayerNames.length === 0) {
          throw new Error(`No layers found in tile. Available layers: ${availableLayers.join(', ')}`);
        }

        const polygonFeatures: { geometry: Geometry; kind: string; layer: string }[] = [];
        const lineFeatures: { geometry: Geometry; kind: string; layer: string }[] = [];
        const pointFeatures: { geometry: Geometry; kind: string; layer: string }[] = [];

        selectedLayerNames.forEach((selectedLayerName) => {
          const layer = tile.layers[selectedLayerName];

          for (let index = 0; index < layer.length; index += 1) {
            const feature = layer.feature(index);
            const kind = featureKind(feature.properties);
            const geometry = feature.loadGeometry();

            if (selectedLayerName === WATER_LAYER) {
              if (feature.type === 3 && kind === 'ocean') {
                polygonFeatures.push({ geometry, kind, layer: selectedLayerName });
              }
              continue;
            }

            if (selectedLayerName === EARTH_LAYER) {
              if (feature.type === 3 && kind === 'earth') {
                polygonFeatures.push({ geometry, kind, layer: selectedLayerName });
              }
              continue;
            }

            if (feature.type === 3) polygonFeatures.push({ geometry, kind, layer: selectedLayerName });
            if (feature.type === 2) lineFeatures.push({ geometry, kind, layer: selectedLayerName });
            if (feature.type === 1) pointFeatures.push({ geometry, kind, layer: selectedLayerName });
          }
        });

        const transform = getTileTransform([
          ...polygonFeatures.map((feature) => feature.geometry),
          ...lineFeatures.map((feature) => feature.geometry),
          ...pointFeatures.map((feature) => feature.geometry),
        ]);

        if (!transform) {
          throw new Error(`No renderable geometry was found in ${TILE_URL}`);
        }

        const renderPolygons = polygonFeatures.map(({ geometry, kind, layer }) => ({
          path: buildPolygonPath(geometry, transform),
          color: colorForKind(kind),
          kind,
          layer,
        }));

        const renderLines = lineFeatures.map(({ geometry, kind, layer }) => ({
          path: buildLinePath(geometry, transform),
          kind,
          layer,
          ...lineStyleForKind(kind),
        }));

        const renderPoints = pointFeatures.flatMap(({ geometry, kind, layer }) =>
          geometry.flat().map((point) => ({
            ...toCanvasPoint(point, transform),
            color: colorForKind(kind),
            kind,
            layer,
            radius: 4,
          }))
        );

        if (mounted) {
          setLayerNames(selectedLayerNames);
          setPolygons(renderPolygons);
          setLines(renderLines);
          setPoints(renderPoints);
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

  const earthPolygons = polygons.filter((polygon) => polygon.layer === EARTH_LAYER && polygon.kind === 'earth');
  const oceanPolygons = polygons.filter((polygon) => polygon.layer === WATER_LAYER && polygon.kind === 'ocean');
  const normalPolygons = polygons.filter(
    (polygon) =>
      !(polygon.layer === EARTH_LAYER && polygon.kind === 'earth') &&
      !(polygon.layer === WATER_LAYER && polygon.kind === 'ocean')
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Martin MVT tile rendered in Skia</Text>
      <Text style={styles.subtitle}>{TILE_URL}</Text>
      {layerNames.length > 0 && <Text style={styles.subtitle}>Layers: {layerNames.join(', ')}</Text>}

      <View style={styles.canvasFrame}>
        <Canvas style={styles.canvas}>
          <Fill color="#f7f7f7" />
          {earthPolygons.map((item, index) =>
            grassShader ? (
              <Group key={`earth-shader-${index}`} clip={item.path}>
                <Shader source={grassShader} uniforms={{ time: waterTime, resolution: [620,620] }} />
                <Fill />
              </Group>
            ) : (
              <Path key={`earth-fallback-${index}`} path={item.path} color={item.color} />
            )
          )}
          {earthPolygons.map((item, index) => (
            <Path
              key={`earth-border-${index}`}
              path={item.path}
              color="#2f6b2f"
              style="stroke"
              strokeWidth={2}
            />
          ))}
          {oceanPolygons.map((item, index) =>
            waterShader ? (
              <Group key={`ocean-shader-${index}`} clip={item.path}>
                <Shader source={waterShader} uniforms={{ time: waterTime ,  resolution: [620, 620] }} />
                <Fill />
              </Group>
            ) : (
              <Path key={`ocean-fallback-${index}`} path={item.path} color={item.color} />
            )
          )}
          {normalPolygons.map((item, index) => (
            <Path key={`polygon-${index}`} path={item.path} color={item.color} />
          ))}
          
          
          {points.map((item, index) => (
            <Circle key={`point-${index}`} cx={item.x} cy={item.y} r={item.radius} color={item.color} />
          ))}
        </Canvas>
      </View>

      <Text style={styles.count}>
        {polygons.length} polygon(s), {lines.length} line(s), {points.length} point(s), {earthPolygons.length}{' '}
        earth polygon(s), {oceanPolygons.length} ocean polygon(s)
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
  count: {
    marginTop: 8,
    color: '#555555',
  },
  error: {
    marginTop: 12,
    color: '#b00020',
  },
});
