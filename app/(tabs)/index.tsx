import { WithSkiaWeb } from "@shopify/react-native-skia/lib/module/web";
import { StyleSheet, View } from "react-native";

export default function HomeScreen() {
  return (
    <WithSkiaWeb
      fallback={<View style={styles.fallback} />}
      getComponent={() => import("@/components/red-skia-canvas")}
      opts={{ locateFile: () => "/canvaskit.wasm" }}
    />
  );
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    backgroundColor: "red"
  }
});
