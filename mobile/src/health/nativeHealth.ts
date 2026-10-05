import { Linking } from 'react-native'
import type { HealthAdapter } from './contracts'

const unsupported: HealthAdapter = {
  source: 'health_connect',
  displayName: 'Health data',
  hrvLabel: 'HRV',
  async checkAvailability() {
    return {
      available: false,
      label: 'Unsupported platform',
      detail: 'CardioTwin wearable sync currently supports iOS HealthKit and Android Health Connect.',
    }
  },
  async requestPermissions() {
    return { requested: false, detail: 'Health data is unavailable on this platform.' }
  },
  async readDailySummary() {
    throw new Error('Health data is unavailable on this platform.')
  },
  async openSettings() {
    await Linking.openSettings()
  },
}

export default unsupported
