import { Canvas, ColorShader, Fill, Group, Shader, Skia } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { MvtInspector } from './mvt-inspector';
import { MvtShapeCanvas } from './mvt-shape-canvas';

export default function RedSkiaCanvas() {
  const checkerboard = useMemo(
    () =>
      Skia.RuntimeEffect.Make(`
half4 main(float2 p) {
  float size = 40.0;
  float2 cell = floor(p / size);
  float checker = mod(cell.x + cell.y, 2.0);

  half4 white = half4(1.0, 1.0, 1.0, 1.0);
  half4 lightGray = half4(0.0, 0.85, 0.85, 1.0);

  return mix(white, lightGray, checker);
}
`),
    []
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.canvasContainer}>
        <Canvas style={styles.canvas}>
          <Group>
            {checkerboard ? <Shader source={checkerboard} /> : <ColorShader color="white" />}
            <Fill />
          </Group>
        </Canvas>
      </View>
      <MvtShapeCanvas />
      <MvtInspector />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
  },
  content: {
    flexGrow: 1,
  },
  canvasContainer: {
    height: 320,
  },
  canvas: {
    flex: 1,
  },
});
