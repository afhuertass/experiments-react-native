import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

type ParsedFeature = {
  id: string | number | undefined;
  type: number;
  properties: Record<string, unknown>;
};

type ParsedLayer = {
  name: string;
  extent: number;
  version: number;
  features: ParsedFeature[];
};

const geometryTypeName = (type: number) => {
  switch (type) {
    case 1:
      return 'Point';
    case 2:
      return 'LineString';
    case 3:
      return 'Polygon';
    default:
      return `Unknown (${type})`;
  }
};

export function MvtInspector() {
  const [layers, setLayers] = useState<ParsedLayer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const loadTile = async () => {
      try {
        const response = await fetch('/tiles/sample.mvt');

        if (!response.ok) {
          throw new Error(`Failed to fetch sample.mvt: ${response.status} ${response.statusText}`);
        }

        const bytes = new Uint8Array(await response.arrayBuffer());
        const tile = new VectorTile(new Pbf(bytes));

        const parsedLayers = Object.entries(tile.layers).map(([name, layer]) => ({
          name,
          extent: layer.extent,
          version: layer.version,
          features: Array.from({ length: layer.length }, (_, index) => {
            const feature = layer.feature(index);

            return {
              id: feature.id,
              type: feature.type,
              properties: feature.properties,
            };
          }),
        }));

        if (mounted) {
          setLayers(parsedLayers);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to parse sample.mvt');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadTile();

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Parsed vector tile</Text>
      <Text style={styles.subtitle}>/tiles/sample.mvt</Text>

      {loading && <ActivityIndicator style={styles.loader} />}
      {error && <Text style={styles.error}>{error}</Text>}

      {layers.map((layer) => (
        <View key={layer.name} style={styles.layerCard}>
          <Text style={styles.layerTitle}>Layer: {layer.name}</Text>
          <Text style={styles.meta}>
            extent {layer.extent} · version {layer.version} · {layer.features.length} features
          </Text>

          {layer.features.map((feature, index) => (
            <View key={`${layer.name}-${index}`} style={styles.featureRow}>
              <Text style={styles.featureTitle}>
                {index + 1}. {geometryTypeName(feature.type)}
              </Text>
              <Text style={styles.properties}>{JSON.stringify(feature.properties)}</Text>
            </View>
          ))}
        </View>
      ))}
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
  loader: {
    marginTop: 16,
    alignSelf: 'flex-start',
  },
  error: {
    marginTop: 12,
    color: '#b00020',
  },
  layerCard: {
    marginTop: 16,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
  },
  layerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111111',
  },
  meta: {
    marginTop: 4,
    color: '#555555',
  },
  featureRow: {
    marginTop: 12,
    paddingTop: 12,
    borderTopColor: '#dddddd',
    borderTopWidth: 1,
  },
  featureTitle: {
    fontWeight: '700',
    color: '#222222',
  },
  properties: {
    marginTop: 4,
    color: '#333333',
    fontFamily: 'monospace',
  },
});
