// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
    expoConfig,
    {
        ignores: ['dist/*'],
    },
    {
        // Both assume React Compiler is compiling this code -- it isn't (no
        // reactCompiler experiment or babel plugin enabled). Without it they
        // just flag Reanimated's own SharedValue.value API and the
        // ref-mirror-latest-callback pattern this codebase relies on (see
        // PrincipalSync.tsx, profile.tsx, saved.tsx) as errors.
        rules: {
            'react-hooks/immutability': 'off',
            'react-hooks/refs': 'off',
        },
    },
]);
