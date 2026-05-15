import { ScrollView, StyleSheet } from "react-native";

import { MvtInspector } from "./mvt-inspector";
import { MvtShapeCanvas } from "./mvt-shape-canvas";

export default function RedSkiaCanvas() {
	return (
		<ScrollView style={styles.container} contentContainerStyle={styles.content}>
			<MvtShapeCanvas />
			<MvtInspector />
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "white",
	},
	content: {
		flexGrow: 1,
	},
});
