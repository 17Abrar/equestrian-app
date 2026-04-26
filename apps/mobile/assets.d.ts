// Ambient module declarations for static asset imports. Metro resolves these
// at bundle time and returns an opaque numeric asset id; expo-image / RN
// `<Image>` components accept that id directly via the `source` prop.
//
// Without this file, `import logo from './logo.png'` fails TS2307 because
// the @typescript-eslint/no-require-imports rule rejects the legacy
// `require('./logo.png')` pattern but expo/types doesn't ship default
// declarations for image extensions.

declare module '*.png' {
  const value: number;
  export default value;
}

declare module '*.jpg' {
  const value: number;
  export default value;
}

declare module '*.jpeg' {
  const value: number;
  export default value;
}

declare module '*.webp' {
  const value: number;
  export default value;
}

declare module '*.gif' {
  const value: number;
  export default value;
}

declare module '*.svg' {
  const value: number;
  export default value;
}
