/// Auto-split from the original `src/runtimes/playgroundTemplates.ts`
/// monolith. See `scripts/split-playground-templates.mjs` for the
/// splitter. Each multi-file template gets its own file; single-file
/// templates live together in `../single-file.ts`.

import type { WorkbenchFile } from "../../../data/types";

/// React Native starter — rendered via react-native-web in the local
/// preview server. A single-file component is enough: the runtime
/// weaves in React + ReactNative imports at mount time and looks for
/// a top-level `App` component to register. No Expo boilerplate here —
/// the in-app runtime doesn't need a Metro bundler; the Expo path
/// (iOS sim / QR code) is handled separately as a dev-tool escape
/// hatch for when the user has their own Expo project running.
export const REACT_NATIVE_TEMPLATE_FILES: WorkbenchFile[] = [
  {
    name: "App.js",
    language: "javascript",
    content: `import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

// Declare a top-level \`App\` component. The runtime registers it with
// AppRegistry and mounts it into a full-height root element. Write RN
// as you would in a real Expo project — react-native-web translates
// Views to divs, Text to spans, StyleSheet to inline styles, etc.
export default function App() {
  const [count, setCount] = useState(0);
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Hello from React Native</Text>
      <Text style={styles.subtitle}>
        Rendered via react-native-web in the local preview.
      </Text>
      <Pressable
        style={({ pressed }) => [
          styles.btn,
          pressed && styles.btnPressed,
        ]}
        onPress={() => setCount((c) => c + 1)}
      >
        <Text style={styles.btnLabel}>
          Tapped {count} {count === 1 ? 'time' : 'times'}
        </Text>
      </Pressable>
    </View>
  );
}

// Reference the live Fishbones theme via CSS custom properties — the
// runtime injects these into the iframe's :root before the component
// renders, so the preview adopts whatever theme is active in the app
// (Catppuccin, Vesper, Word, etc.) without us hardcoding colour
// values. Replace any 'var(--rn-*)' string with a fixed colour to
// override.
const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'var(--rn-bg-primary)',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: 'var(--rn-text-primary)',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    color: 'var(--rn-text-secondary)',
    marginBottom: 20,
    textAlign: 'center',
  },
  btn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: 'var(--rn-text-primary)',
  },
  btnPressed: { opacity: 0.7 },
  btnLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: 'var(--rn-bg-primary)',
  },
});
`,
  },
];
