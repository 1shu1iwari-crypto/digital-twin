import type { ExpoConfig } from 'expo/config'

const allowDevHttp = process.env.EXPO_PUBLIC_ALLOW_HTTP === '1'

const config: ExpoConfig = {
  name: 'CardioTwin',
  slug: 'cardiotwin-mobile',
  version: '0.2.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  scheme: 'cardiotwin',
  newArchEnabled: true,
  ios: {
    bundleIdentifier: 'health.cardiotwin.companion',
    deploymentTarget: '16.4',
    supportsTablet: false,
    infoPlist: allowDevHttp
      ? {
          NSAppTransportSecurity: {
            NSAllowsArbitraryLoads: true,
          },
        }
      : {},
  },
  android: {
    package: 'health.cardiotwin.companion',
    permissions: [
      'android.permission.health.READ_HEART_RATE',
      'android.permission.health.READ_RESTING_HEART_RATE',
      'android.permission.health.READ_HEART_RATE_VARIABILITY',
      'android.permission.health.READ_RESPIRATORY_RATE',
      'android.permission.health.READ_OXYGEN_SATURATION',
      'android.permission.health.READ_STEPS',
      'android.permission.health.READ_WEIGHT',
      'android.permission.health.READ_BLOOD_PRESSURE',
      'android.permission.health.READ_SLEEP'
    ],
  },
  plugins: [
    [
      '@kingstinct/react-native-healthkit',
      {
        NSHealthShareUsageDescription:
          'CardioTwin reads the health signals you choose so it can prepare a daily summary for your digital twin.',
        NSHealthUpdateUsageDescription:
          'CardioTwin does not currently write health data, but HealthKit requires this description for the native capability.',
        background: false,
      },
    ],
    'react-native-health-connect',
    [
      'expo-build-properties',
      {
        android: {
          compileSdkVersion: 36,
          targetSdkVersion: 36,
          minSdkVersion: 26,
          usesCleartextTraffic: allowDevHttp,
        },
        ios: {
          deploymentTarget: '16.4',
        },
      },
    ],
  ],
  extra: {
    defaultApiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://192.168.1.10:8000',
  },
}

export default config
